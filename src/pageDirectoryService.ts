// unit: extension
import * as vscode from 'vscode';
import { HugoServer } from './hugoServer';
import { fetchPageDirectory, PageDirectoryParseError, PageInfo } from './pageDirectory';

/**
 * PageDirectoryService caches and automatically refreshes page directory on rebuilds.
 */
export class PageDirectoryService {

    private onDidUpdateEmitter = new vscode.EventEmitter<void>();
    private hugoServer: HugoServer;
    private reg: vscode.Disposable;
    private pendingRequest?: Promise<PageInfo[]>;
    private pageInfoByUrl = new Map<string, PageInfo>;
    private pageInfoBySourceFile = new Map<string, PageInfo>;

    constructor(server: HugoServer) {
        this.hugoServer = server;
        this.reg = server.onDidRebuild(this.updateDirectory, this);
        this.updateDirectory();
    }

    dispose() {
        this.reg.dispose();
    }

    /**
     * Fires whenever the data is updated.
     */
    readonly onDidUpdate: vscode.Event<void> = this.onDidUpdateEmitter.event;

    /**
     * Determine the source file path given content URL.
     * Old outdated URLs continue to resolve. This is useful when history is navigated back.
     */
    sourceFileByUrl(url: vscode.Uri): vscode.Uri | undefined {
        const page = this.pageInfoByUrl.get(url.toString());
        if (page?.source !== undefined
            && this.pageInfoBySourceFile.get(page.source.toString()) !== undefined
        ) {
            return page.source;
        }
    }

    /**
     * Return a content URL given the source file path.
     * Page might have multiple URLs (aliases). The function returns the primary URL,
     * unless maybeAlias is supplied, indicating the alias we wish to get back.
     */
    urlBySourceFile(source: vscode.Uri, maybeAlias?: vscode.Uri): vscode.Uri | undefined {
        const page = this.pageInfoBySourceFile.get(source.toString());
        if (page === undefined) return;
        if (maybeAlias !== undefined
            && page.aliases.some(alias => alias.toString() === maybeAlias.toString())
        ) {
            return maybeAlias;
        }
        return page.url;
    }

    /**
     * TRUE if the site doesn't expose page directory.
     */
    pageDirectoryNotAvailable?: boolean;

    private async updateDirectory(): Promise<void> {
        if (this.hugoServer.terminated || this.hugoServer.buildErrors.length !== 0) return;

        const pendingRequest = fetchPageDirectory(this.hugoServer.urls[0]);
        this.pendingRequest = pendingRequest;
        try {
            const pages = await pendingRequest;
            if (this.pendingRequest === pendingRequest) {
                this.pageInfoBySourceFile.clear();
                // intentionally skipping this.pageInfoByUrl.clear();
                // when a slug is edited, we fix the outdated url by going back to source file

                for (const page of pages) {
                    if (page.source !== undefined) {
                        this.pageInfoBySourceFile.set(page.source.toString(), page);
                    }
                    this.linkPageInfo(page.url, page);
                    for (const alias of page.aliases) {
                        this.linkPageInfo(alias, page);
                    }
                }

                this.pageDirectoryNotAvailable = false;
            }
        } catch (err) {
            if (this.pendingRequest === pendingRequest && err instanceof PageDirectoryParseError) {
                this.pageDirectoryNotAvailable = true;
            } else {
                console.error(err);
            }
        }

        this.pendingRequest = undefined;
        this.onDidUpdateEmitter.fire();
    }

    private linkPageInfo(url: vscode.Uri, page: PageInfo) {
        if (this.hugoServer.canServeUrl(url)) {
            this.pageInfoByUrl.set(url.toString(), page);
        }
    }
}