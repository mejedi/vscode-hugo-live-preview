// unit: extension
import * as vscode from 'vscode';
import { HugoServer } from './hugoServer';

/**
 * Manages a set of running Hugo servers.
 * There's typically just a single server running.
 * We need a distinct server per embedder origin but we expect to see the same origin,
 * even when the preview pane is re-opened.
 */
export class HugoServerManager {
    private workspaceRoot: vscode.WorkspaceFolder;

    private serverPromiseByEmbedderOrigin = new Map<string, Promise<HugoServer>>();

    constructor(workspaceRoot: vscode.WorkspaceFolder) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Start a server if needed and return the URI for accessing content.
     * EmbedderOrigin tells the origin of an iframe intending to embed the content.
     */
    async requestServer(embedderOrigin: string): Promise<HugoServer> {
        const serverPromise = this.serverPromiseByEmbedderOrigin.get(embedderOrigin);
        if (serverPromise !== undefined) {
            return serverPromise;
        }

        const newServerPromise = HugoServer.start(this.workspaceRoot, embedderOrigin);

        const unregisterNewServer = () => {
            if (this.serverPromiseByEmbedderOrigin.get(embedderOrigin) === newServerPromise)
                this.serverPromiseByEmbedderOrigin.delete(embedderOrigin);
        };
        newServerPromise.catch(unregisterNewServer);
        this.serverPromiseByEmbedderOrigin.set(embedderOrigin, newServerPromise);

        const newServer = await newServerPromise;
        newServer.onDidTerminate(unregisterNewServer);
        return newServer;
    }
};