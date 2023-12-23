// unit: extension
import * as vscode from 'vscode';

import { HugoServerManager } from './hugoServerManager';
import { PreviewPanel } from './previewPanel';

const livePreviewPartial: string = require('./livePreviewPartial.blob');

/**
 * Based on the currently active tabs and the active tab group, which source file should be previewed?
 */
interface PreviewIntent {
	readonly sourceUrl?: vscode.Uri;
	readonly previewPanelHasFocus: boolean;
}

/*
 * extractPreviewIntent examines tab groups to figure out the source file to be previewed.
 *
 * In general, preview panel follows the active text editor. The challenge is that when
 * preview pane itself gains focus /when user interacts with HTML page/, text editor's tab become
 * inactive and there's no active text editor anymore. Therefore if preview panel gains focus, we preserve
 * sourceUrl from the prior state.
 *
 * NB Don't mix vscode.window.activeTextEditor and vscode.window.tabGroups APIs, they are briefly running out of sync.
 */
function extractPreviewIntent(prevState?: PreviewIntent): PreviewIntent {
	let sourceUrl = prevState?.sourceUrl;
	const hasSourceFileOpenInActiveTab = (tabGroup: vscode.TabGroup) => {
		const tab = tabGroup.activeTab;
		return tab?.input instanceof vscode.TabInputText &&
			(tab.input as vscode.TabInputText).uri.toString() === sourceUrl?.toString();
	};

	// No prior state OR source file previously being previewed has been closed?
	if (prevState === undefined ||
		sourceUrl !== undefined && !vscode.window.tabGroups.all.some(hasSourceFileOpenInActiveTab)
	) {
		// Try to figure out what could be a reasonable source file to preview.

		// Consider tab groups. For the common two-column layout this yields a text editor successfully.
		const candidates = vscode.window.tabGroups.all.filter(group => group.activeTab?.input instanceof vscode.TabInputText);

		if (candidates.length === 1) {
			sourceUrl = (candidates[0].activeTab?.input as vscode.TabInputText).uri;
		} else {
			sourceUrl = undefined;
		}
	}

	const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
	let previewPanelHasFocus = false;
	if (activeTab?.input instanceof vscode.TabInputWebview && (activeTab?.input as vscode.TabInputWebview).viewType.endsWith('hugoLivePreview.preview')) {
		// We've seen .viewType yield e.g. 'mainThreadWebview-hugoLivePreview.preview', hence .endsWith().
		previewPanelHasFocus = true;
	} else if (activeTab?.input instanceof vscode.TabInputText) {
		sourceUrl = (activeTab?.input as vscode.TabInputText).uri;
	} else {
		sourceUrl = undefined;
	}

	return { sourceUrl, previewPanelHasFocus };
}

class HugoLivePreviewExtension implements vscode.WebviewPanelSerializer {
	private extensionContext: vscode.ExtensionContext;
	private hugoServerManager: HugoServerManager;
	private previewPanel: PreviewPanel | undefined;
	private previewIntent: PreviewIntent;

	constructor(context: vscode.ExtensionContext) {
		if (vscode.workspace.workspaceFolders === undefined)
			throw new Error('No workspace');

		this.extensionContext = context;
		this.hugoServerManager = new HugoServerManager(vscode.workspace.workspaceFolders[0]);
		this.previewIntent = extractPreviewIntent();
		vscode.window.tabGroups.onDidChangeTabGroups(this.followPreviewIntentChange, this);
		vscode.window.tabGroups.onDidChangeTabs(this.followPreviewIntentChange, this);
	}

	/**
	 * Open live preview pane if not open yet or activate existing one.
	 */
	open() {
		if (this.previewPanel !== undefined) {
			this.previewPanel.reveal();
			return;
		}
		this.installPanel(new PreviewPanel(this.extensionContext, this.hugoServerManager));
	}

	/**
	 * Go back to previous page in the history.
	 */
	navigateBack() {
		this.previewPanel?.navigateBack();
	}

	/**
	 * Go forward to next page in history.
	 */
	navigateForward() {
		this.previewPanel?.navigateForward();
	}

	/**
	 * Open the matching source file.
	 */
	async showSource() {
		if (this.previewPanel !== undefined) {
			const sourceUrl = this.previewPanel.sourceUrl();
			if (sourceUrl !== undefined) {
				const doc = await vscode.workspace.openTextDocument(sourceUrl);
				vscode.window.showTextDocument(doc);
			}
		}
	}

	/**
	 * Open current page in system browser.
	 */
	openExternal() {
		if (this.previewPanel !== undefined) {
			const url = this.previewPanel.contentUrl();
			if (url !== undefined) {
				vscode.env.openExternal(url);
			}
		}
	}

	/**
	 * Restore preview panel (on VSCode restart)
	 */
	async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
		if (this.previewPanel !== undefined) {
			panel.dispose();
			return;
		}
		this.installPanel(new PreviewPanel(this.extensionContext, this.hugoServerManager, panel));
	}

	async createLivePreviewPartial() {
		const doc = await vscode.workspace.openTextDocument({language: 'html', content: livePreviewPartial});
		vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

	}

	private installPanel(panel: PreviewPanel) {
		this.previewPanel = panel;
		this.previewPanel.onDidDispose(() => {
			this.previewPanel = undefined;
		});
		panel.onExternalLinkClicked(url => vscode.env.openExternal(url));
		panel.onCreateLivePreviewPartialRequested(this.createLivePreviewPartial, this);
		panel.onContentWanted(() => panel.setSourceUrl(this.previewIntent.sourceUrl));
		panel.onPreviewStatusChanged(() => {
			vscode.commands.executeCommand('setContext', 'hugoLivePreview.showingPreview', panel.showingPreview());
		});
		vscode.commands.executeCommand('setContext', 'hugoLivePreview.showingPreview', panel.showingPreview());
	}

	private followPreviewIntentChange() {
		const pi = extractPreviewIntent(this.previewIntent);
		const previewPanelLostFocus = this.previewIntent.previewPanelHasFocus && !pi.previewPanelHasFocus;
		if (this.previewPanel !== undefined) {
			if (pi.sourceUrl?.toString() !== this.previewIntent.sourceUrl?.toString() || previewPanelLostFocus) {
				// On previewPanelLostFocus: preview is not strictly bound to the selected text editor.
				// User can navigate to a different page by following links. However, when text editor
				// re-gains focus (implying previewPanelLostFocus) we reset preview to the 'proper' URL.
				//
				// Note: further layers down the stack ensure that a page is not reloaded if URL doesn't change.
				this.previewPanel.setSourceUrl(pi.sourceUrl);
			}
		}
		this.previewIntent = pi;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const ext = new HugoLivePreviewExtension(context);

	context.subscriptions.push(vscode.commands.registerCommand('hugoLivePreview.open', ext.open.bind(ext)));
	context.subscriptions.push(vscode.commands.registerCommand('hugoLivePreview.navigateBack', ext.navigateBack.bind(ext)));
	context.subscriptions.push(vscode.commands.registerCommand('hugoLivePreview.navigateForward', ext.navigateForward.bind(ext)));
	context.subscriptions.push(vscode.commands.registerCommand('hugoLivePreview.showSource', ext.showSource.bind(ext)));
	context.subscriptions.push(vscode.commands.registerCommand('hugoLivePreview.openExternal', ext.openExternal.bind(ext)));

	vscode.window.registerWebviewPanelSerializer('hugoLivePreview.preview', ext);
}

// This method is called when your extension is deactivated
export function deactivate() {}
