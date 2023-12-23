// unit: extension
import * as vscode from 'vscode';
import { HugoServerManager } from './hugoServerManager';
import { HugoServer } from './hugoServer';
import { PageDirectoryService } from './pageDirectoryService';
import { DisplayService } from './displayService';
import { PreviewPanelStateType, PreviewPanelState, PreviewStatus } from './previewPanelState';
import * as previewPanelState from './previewPanelState';
import * as proto from './protocol';
import { sTextTraverse } from './stext';
import { diff_match_patch } from 'diff-match-patch';

export class PreviewPanel {
    private onContentWantedEmitter = new vscode.EventEmitter<void>();
    private onExternalLinkClickedEmitter = new vscode.EventEmitter<vscode.Uri>();
    private onPreviewStatusChangedEmitter = new vscode.EventEmitter<void>();
    private onCreateLivePreviewPartialRequestedEmitter = new vscode.EventEmitter<void>();

    private hugoServerManager: HugoServerManager;
    private disposables: vscode.Disposable[] = [];
    private state: PreviewPanelState = previewPanelState.initialising();
    private origin?: string;
    private hugoServer?: HugoServer;
    private panel: vscode.WebviewPanel;
    private pageDirectoryService?: PageDirectoryService;
    private displayService: DisplayService;

    /**
     * Panel closed.
     */
    readonly onDidDispose: vscode.Event<void>;

    /**
     * Panel is displaying no content at the moment, content wanted.
     * Note: .setSourceUrl might be ignored due to e.g. a server not being available yet.
     * We don't keep track of the URL requested. Whenever we believe that the situation
     * improved, we ask the caller to provide the URL again by firing onContentWanted.
     */
    readonly onContentWanted: vscode.Event<void> = this.onContentWantedEmitter.event;

    /**
     * External link clicked in preview panel.
     */
    readonly onExternalLinkClicked: vscode.Event<vscode.Uri> = this.onExternalLinkClickedEmitter.event;

    constructor(context: vscode.ExtensionContext, hugoServerManager: HugoServerManager,
                usePanel?: vscode.WebviewPanel) {

        this.hugoServerManager = hugoServerManager;

		// TODO: verify if we like options in usePanel
		const extensionUri = context.extensionUri;
		const panel = usePanel || vscode.window.createWebviewPanel(
			'hugoLivePreview.preview',
			'Hugo Live Preview',
			vscode.ViewColumn.Two,
			{enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [
				vscode.Uri.joinPath(extensionUri, 'dist'),
			]},
		);

		const embedderJs = vscode.Uri.joinPath(extensionUri, 'dist/embedder.js');

		panel.webview.html =
`<!doctype html>
<html lang=en><head>
<meta charset=utf-8>
</head>
<body>
<script src="${panel.webview.asWebviewUri(embedderJs)}"></script>
</body>
</html>`;

		panel.webview.onDidReceiveMessage(this.webviewOnMessage.bind(this));
        panel.onDidDispose(() => {
            this.state = previewPanelState.disposed();
            for (const disposable of this.disposables) disposable.dispose();
        });

        this.panel = panel;
        this.onDidDispose = panel.onDidDispose;

        this.displayService = new DisplayService(panel.webview);
        this.displayService.onLoad(this.updateState, this);
    }

    reveal() { this.panel.reveal() }

    showingPreview(): boolean {
        return this.state.type === PreviewPanelStateType.READY &&
            this.state.previewStatus !== PreviewStatus.NO_PREVIEW_AVAILABLE;
    }

    /*
     * showingPreview() result changed
     */
    readonly onPreviewStatusChanged: vscode.Event<void> = this.onPreviewStatusChangedEmitter.event;

    /*
     * User wants to create live preview partial
     */
    readonly onCreateLivePreviewPartialRequested: vscode.Event<void> = this.onCreateLivePreviewPartialRequestedEmitter.event;

    navigateBack() {
        if (this.showingPreview())
            this.panel.webview.postMessage({msg: 'navigateBack'})
    }

    navigateForward() {
        if (this.showingPreview())
            this.panel.webview.postMessage({msg: 'navigateForward'})
    }

    setSourceUrl(url: vscode.Uri | undefined) {
        if (this.state.type !== PreviewPanelStateType.READY) return;
        const pageDir = this.pageDirectoryService;
        const relPath = url && vscode.workspace.asRelativePath(url);
        if (url === undefined || pageDir === undefined) {
            return this.setState(previewPanelState.readyNoPreviewAvailable(this.displayService.display, relPath));
        }
        const contentUrl = pageDir.urlBySourceFile(url);
        if (contentUrl === undefined) {
            return this.setState(previewPanelState.readyNoPreviewAvailable(this.displayService.display, relPath));
        }
        const displayUrl = this.displayService.display?.url;
        if (displayUrl === undefined || pageDir.sourceFileByUrl(displayUrl)?.toString() !== url.toString()) {
            this.displayService.setUrl(contentUrl);
        }
        return this.setState(previewPanelState.readyShowingPreview());
    }

    /**
     * Currently displaying content URL or undefined if no content is currently displayed (no preview available plaque and other error screens).
     */
    contentUrl(): vscode.Uri | undefined {
        if (!this.showingPreview() || this.displayService.display === undefined) return undefined;
        return this.displayService.display.url;
    }

    /**
     * Source URL of the currently displaying content. (Different from setSourceUrl last call argument.)
     */
    sourceUrl(): vscode.Uri | undefined {
        const url = this.contentUrl();
        const pageDir = this.pageDirectoryService;
        if (pageDir === undefined || url === undefined) return undefined;
        return pageDir.sourceFileByUrl(url);
    }

    private webviewOnMessage(message: proto.DiscloseWebviewOriginMsg | proto.NavigateToMsg | proto.RestartServerMsg | proto.CreateLivePreviewPartialMsg | proto.UpdateIntersectionsMsg | proto.ClickMsg) {
        if (message.msg !== proto.MsgType.UPDATE_INTERSECTIONS) console.log(message);
        if (message.msg === proto.MsgType.DISCLOSE_WEBVIEW_ORIGIN) {
            if (this.state.type === PreviewPanelStateType.INITIALISING) {
                this.origin = message.origin;
                this.provisionServer();
            }
        }
        if (message.msg === proto.MsgType.NAVIGATE_TO) {
            if (!this.showingPreview()) return;

            const url = vscode.Uri.parse('' + message.url);
            if (this.hugoServer?.canServeUrl(url)) {
                // Cross-origin navigation in multilingual site.
                this.displayService.setUrl(url);
            } else {
                this.onExternalLinkClickedEmitter.fire(url);
            }
        }
        if (message.msg === proto.MsgType.RESTART_SERVER) {
            if (this.state.type !== PreviewPanelStateType.SERVER_FAILED) return;

            for (const disposable of this.disposables) disposable.dispose();
            this.disposables = [];
            this.hugoServer = undefined;
            this.pageDirectoryService = undefined;
            this.displayService.display = undefined;
            this.displayService.checkinTimedout = undefined;

            this.provisionServer();
        }
        if (message.msg === proto.MsgType.CREATE_LIVE_PREVIEW_PARTIAL) {
            this.onCreateLivePreviewPartialRequestedEmitter.fire();
        }
        if (message.msg === proto.MsgType.CLICK) {
            this.handleClick(+message.offset);
        }
    }

    private async provisionServer() {
        if (this.origin === undefined) {
            console.error('internal error: Webview origin not yet known');
            return;
        }

        this.setState(previewPanelState.serverStarting());
        try {
            const server = await this.hugoServerManager.requestServer(this.origin);
            if (this.state.type !== PreviewPanelStateType.SERVER_STARTING) return;

            this.panel.webview.postMessage({msg: 'setAllowedContentOrigins', origins: server.urls.map(url => `${url.scheme}://${url.authority}`)});

            this.hugoServer = server;
            server.onDidTerminate(this.serverFailed, this, this.disposables);
            server.onDidRebuild(() => {
                this.displayService.checkinTimedout = undefined;
                this.updateState();
            }, undefined, this.disposables);

            const pageDirectoryService = new PageDirectoryService(server);
            this.pageDirectoryService = pageDirectoryService;
            this.disposables.push(pageDirectoryService);

            pageDirectoryService.onDidUpdate(this.updateState, this);

            this.setState(previewPanelState.readyNoPreviewAvailable());

        } catch (err) {
            this.serverFailed(err as Error);
        }
    }

    private serverFailed(err: Error) {
        this.panel.webview.postMessage({msg: 'setAllowedContentOrigins', origins: []});
        this.setState(previewPanelState.serverFailed(err));
    }

    private updateState() {
        if (this.hugoServer === undefined || this.pageDirectoryService == undefined) return;

        const validStates = [
            PreviewPanelStateType.BUILD_FAILED, PreviewPanelStateType.SITE_MISCONFIGURED, PreviewPanelStateType.READY
        ];
        if (!validStates.includes(this.state.type)) return;

        // slug edited? fix URL if needed
        if (this.displayService.display !== undefined) {
            const displayUrl = this.displayService.display.url;
            const sourceUrl = this.pageDirectoryService.sourceFileByUrl(displayUrl);
            if (sourceUrl !== undefined) {
                const displayUrl2 = this.pageDirectoryService.urlBySourceFile(sourceUrl, displayUrl);
                if (displayUrl2 !== undefined && displayUrl2.toString() !== displayUrl.toString()) {
                    this.displayService.replaceUrl(displayUrl2);
                }
            }
        }

        if (this.hugoServer.buildErrors.length !== 0) {
            this.setState(previewPanelState.buildFailed());
        } else if (this.displayService.checkinTimedout || this.pageDirectoryService.pageDirectoryNotAvailable) {
            this.setState(previewPanelState.siteMisconfigured(this.displayService, this.pageDirectoryService));
        } else if (this.state.type !== PreviewPanelStateType.READY) {
            this.setState(previewPanelState.readyNoPreviewAvailable());
        } else {
            this.updateTitle();
        }

        if (this.state.type === PreviewPanelStateType.READY &&
            this.state.previewStatus !== PreviewStatus.SHOWING_PREVIEW
        ) {
            this.onContentWantedEmitter.fire();
        }
    }

    private setState(state: PreviewPanelState) {
        const wasShowingPreview = this.showingPreview();
        this.state = state;
        this.updateTitle();
        this.panel.webview.postMessage({msg:'setState', state: this.state});
        if (wasShowingPreview !== this.showingPreview()) this.onPreviewStatusChangedEmitter.fire();
    }

    private updateTitle() {
        if (this.showingPreview() && this.displayService.display !== undefined) {
            this.panel.title = this.displayService.display.url.path;
        } else {
            this.panel.title = 'Hugo Live Preview';
        }
    }

    private async handleClick(offset: number) {
        const sourceUrl = this.sourceUrl();
        const display = this.displayService.display;

        if (sourceUrl === undefined || display === undefined) return;

        const doc = await vscode.workspace.openTextDocument(sourceUrl);
        const docText = doc.getText();
        const previewTextChunks: string[] = [];
        sTextTraverse(display.content, (node) => {
            if (typeof node === 'string') previewTextChunks.push(node.replace('’',"'"));
        });
        const previewText = previewTextChunks.join('');
        const de = new diff_match_patch();
        const diff = de.diff_main(docText, previewText);
        de.diff_cleanupSemantic(diff);

        let docOffset = 0;
        let previewOffset = 0;
        for (const hunk of diff) {
            if (hunk[0] == 0 || hunk[0] == 1) {
                if (previewOffset + hunk[1].length >= offset) {
                    if (hunk[0] == 0) docOffset += offset - previewOffset;
                    break;
                }
                previewOffset += hunk[1].length;
            }
            if (hunk[0] == 0 || hunk[0] == -1) {
                docOffset += hunk[1].length;
            }
        }

        const docPos = doc.positionAt(docOffset);
        const editor = await vscode.window.showTextDocument(doc);
        editor.selections = [new vscode.Selection(docPos, docPos)];
        editor.revealRange(new vscode.Range(docPos, docPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
}