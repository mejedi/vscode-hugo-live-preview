// unit: extension
import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'node:child_process';
import { errno } from 'errno';
import { preparePayload } from './payloadLoader';

/**
 * HugoServer represents a running Hugo server. Hugo process is wrapped in VSCode task so that
 * a user can examine the output and we can run problemMatchers on top.
 */
export class HugoServer {
    /**
     * Whether the server has already terminated.
     */
    terminated: boolean = false;

    /**
     * URL(s) to access content. Multilingual sites may expose multiple URLs.
     */
    readonly urls: vscode.Uri[];

    /**
     * Errors, if any, encountered in the last build.
     */
    buildErrors: Error[] = [];

    /**
     * Server terminated.
     */
    readonly onDidTerminate: vscode.Event<any>;

    /**
     * Server finished rebuilding content in response to a file change.
     */
    readonly onDidRebuild: vscode.Event<void>;

    constructor(urls: vscode.Uri[], onDidTerminate: vscode.Event<any>, onDidRebuild: vscode.Event<void>) {
        this.urls = [...urls];
        this.onDidTerminate = onDidTerminate;
        this.onDidRebuild = onDidRebuild;
    }

    /**
     * Whether the URL maps to this server.
     */
    canServeUrl(url: vscode.Uri): boolean {
        return this.urls.some(
            serverUrl => serverUrl.scheme === url.scheme && serverUrl.authority === url.authority
        );
    }

    /**
     * Start server.
     */
    static async start(workspaceRoot: vscode.WorkspaceFolder, embedderOrigin: string): Promise<HugoServer> {

        return new Promise<HugoServer>((resolve, reject) => {

            const e = new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                return new CustomBuildTaskTerminal(workspaceRoot, embedderOrigin, (err: any, server: HugoServer | undefined) => {
                    err === undefined && server !== undefined ? resolve(server) : reject(err);
                });
            });

            const problemMatcher = 'hugoLivePreview.hugoServer';
            const t = new vscode.Task(
                { type: 'hugoLivePreview.hugoServer', embedderOrigin: embedderOrigin },
                workspaceRoot, 'Hugo Server (live preview)', 'hugo', e,
                problemMatcher
            );
            t.isBackground = true;
            t.presentationOptions = {
                reveal: vscode.TaskRevealKind.Never,
                panel: vscode.TaskPanelKind.Dedicated,
                echo: false
            };

            // Gen exception if the task refuses to start.
            const p = vscode.tasks.executeTask(t).then(undefined, reject);

            // Note: if workspace is not trusted, tasks are not allowed to run.
            // However, currently we observe that executeTask doesn't fail right away,
            // and the promise is succesfuly resolved. The task is put on hold and resumes
            // once the trust is granted.
        });
    }
};

enum HugoServerState { INIT, READY, REBUILDING, TERMINATED };

class CustomBuildTaskTerminal implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	private closeEmitter = new vscode.EventEmitter<number>();

    private serverTerminateEmitter = new vscode.EventEmitter<any>();
    private serverRebuildEmitter = new vscode.EventEmitter<void>();

    private workspaceRoot: vscode.WorkspaceFolder;
    private embedderOrigin: string;
    private initCompletionCb: (err: Error | undefined, server: HugoServer | undefined) => void;

    private state = HugoServerState.INIT;
    private collectedErrors: Error[] = [];
    private collectedUrls: vscode.Uri[] = [];
    private hugoProc?: ChildProcess;
    private hugoServer?: HugoServer;

    constructor(workspaceRoot: vscode.WorkspaceFolder, embedderOrigin: string,
                initCompletionCb: (err: Error | undefined, server: HugoServer | undefined) => void
    ) {
        this.workspaceRoot = workspaceRoot;
        this.embedderOrigin = embedderOrigin;
        this.initCompletionCb = initCompletionCb;
    }

	onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	onDidClose: vscode.Event<number> = this.closeEmitter.event;

	open(initialDimensions: vscode.TerminalDimensions | undefined): void {

        const hugoProc = spawn('hugo', ['server', '--buildDrafts'], {
            cwd: this.workspaceRoot.uri.fsPath,
            env:  { ...process.env, 'HUGO_LIVE_PREVIEW_SCRIPT': btoa(preparePayload(this.embedderOrigin)) },
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false
        });
        this.hugoProc = hugoProc;

        hugoProc.on('error', (err: Error|any) => {
            if (err.spawnargs !== undefined && errno[err.errno] !== undefined) {
                err.message = `Failed to launch '${err.path}': ${capitaliseFirstLetter(errno[err.errno].description)}`;
            }
            this.writeEmitter.fire(`${err}\r\n`);
            this.closeEmitter.fire(-1);
            this.tellObserversServerIsGone(err);
        });

        hugoProc.on('exit', (code: number | null, signal: string | null) => {
            const message = (() => {
                if (code !== null) return `Hugo process terminated with exit code: ${code}`;
                else return `Hugo process killed by signal: ${signal}`;
            })();
            this.writeEmitter.fire(`${message}.\r\n`);
            this.closeEmitter.fire(code === null ? -1 : code);
            this.tellObserversServerIsGone(new Error(message));
        });

        const analyse = this.outputAnalyser();
        hugoProc.stdout.on('data', (data: Buffer) => {
            const str = data.toString('utf8');
            this.relayOutput(data.toString('utf8'));
            analyse(str);
        });

        hugoProc.stderr.on('data', (data: Buffer) => {
            this.relayOutput(data.toString('utf8'));
        });
	}

	close(): void {
		this.tellObserversServerIsGone(new Error('VSCode task terminated'));
        this.hugoProc !== undefined && this.hugoProc.kill();
	}

    private tellObserversServerIsGone(err: Error) {
        if (this.hugoServer === undefined) {
            this.initCompletionCb(err, undefined);
        } else {
            this.hugoServer.terminated = true;
            this.serverTerminateEmitter.fire(err);
        }
        this.state = HugoServerState.TERMINATED;
    }

    private relayOutput(str: string) {
        this.writeEmitter.fire(str.replaceAll('\n', '\r\n'));
    }

    private outputAnalyser() {
        return lineSplitter((line: string) => {
            // Error: command error: Unable to locate config file or config directory. Perhaps you need to create a new site.
            // Error: error building site: assemble: ...
            // ERROR Rebuild failed: assemble: ...
            const match = /(?:Error|ERROR)[^:]*:\s+(.*)/.exec(line);
            if (match !== null) {
                this.collectedErrors.push(new Error(match[1]));
            }

            switch (this.state) {
            case HugoServerState.INIT:
                const match = /Web Server is available at (http\S+)/.exec(line);
                if (match !== null) {
                    this.collectedUrls.push(vscode.Uri.parse(match[1]));
                }
                if (/Press Ctrl\+C to stop/.test(line)) {
                    if (this.collectedUrls.length === 0) {
                        const err = new Error("didn't find webserver URL in Hugo output");
                        if (this.hugoProc !== undefined) {
                            this.writeEmitter.fire(`${err}.\r\nTerminating Hugo server.\r\n`)
                            this.hugoProc.kill();
                        }
                        this.initCompletionCb(err, undefined);
                    } else {
                        this.state = HugoServerState.READY;
                        this.hugoServer = new HugoServer(this.collectedUrls, this.serverTerminateEmitter.event, this.serverRebuildEmitter.event);
                        this.hugoServer.buildErrors = [...this.collectedErrors];
                        this.initCompletionCb(undefined, this.hugoServer);
                    }
                }
                break;
            case HugoServerState.READY:
                if (/Change detected, rebuilding site/.test(line)) {
                    this.state = HugoServerState.REBUILDING;
                    this.collectedErrors = [];
                }
                break;
            case HugoServerState.REBUILDING:
                if (/Total in \d+ ms/.test(line)) {
                    this.state = HugoServerState.READY;
                    if (this.hugoServer !== undefined) {
                        this.hugoServer.buildErrors = [...this.collectedErrors];
                    }
                    this.serverRebuildEmitter.fire();
                }
                break;
            }
        });
    }
};

/**
 * A helper that produces a callable that expects strings, accumulates input between the calls
 * and invokes callback with complete lines.
 */
function lineSplitter(cb: (str: string) => void) {
    let leftover = "";
    return function(str: string): void {
        const lines = str.split('\n');
        lines[0] = leftover + lines[0];
        leftover = lines.pop() as string;
        for (let line of lines) cb(line);
    }
}

function capitaliseFirstLetter(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
