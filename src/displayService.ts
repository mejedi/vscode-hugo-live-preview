// unit: extension
import * as vscode from 'vscode';
import { SText } from './stext';
import * as proto from './protocol';

/**
 * Content currently displayed in preview pane.
 */
export interface Display {
    /**
     * Page url.
     */
    readonly url: vscode.Uri;

    /**
     * Extracted textual content.
     */
    readonly content: SText;
}

/**
 * DisplayService manages preview in contentIframe. It works by exchanging messages with the webview.
 */
export class DisplayService {

    private readonly onLoadEmitter = new vscode.EventEmitter<void>();
    private readonly webview: vscode.Webview;
    private reqTimer?: NodeJS.Timeout;

    constructor(webview: vscode.Webview) {
        this.webview = webview;
        webview.onDidReceiveMessage(this.webviewOnMessage, this);
    }

    /**
     * Open requested page. Loading the same page again won't be optimized.
     */
    setUrl(url: vscode.Uri) {
        this.doOpen(proto.MsgType.SET_URL, url);
    }

    /**
     * Like open, but replaces current history entry instead of pushing a new one.
     */
    replaceUrl(url: vscode.Uri) {
        this.doOpen(proto.MsgType.REPLACE_URL, url);
    }

    /**
     * Content currently displayed in preview pane.
     */
    display?: Display;

    /**
     * Fired whenever a page loads, either in response to .set/replaceUrl() or a user following links in the preview.
     */
    readonly onLoad: vscode.Event<void> = this.onLoadEmitter.event;

    /**
     * A page didn't send checkin message in time which might be a symptom of payload missing.
     */
    checkinTimedout?: boolean = false;

    private webviewOnMessage(e: any) {
        if (e.msg === proto.MsgType.CHECKIN) {
            const message: proto.CheckinMsg = e;
            this.display = { url: vscode.Uri.parse('' + message.href), content: isValidSText(message.stext) ? message.stext : [] };
            this.checkinTimedout = false;
            clearTimeout(this.reqTimer);
            this.reqTimer = undefined;
            this.onLoadEmitter.fire();
        }
    }

    private doOpen(msg: proto.MsgType.SET_URL | proto.MsgType.REPLACE_URL, url: vscode.Uri) {
        const message: proto.SetUrlMsg = { msg, url: url.toString() };
        this.webview.postMessage(message);
        if (this.reqTimer) clearTimeout(this.reqTimer);
        this.reqTimer = setTimeout(() => {
            this.checkinTimedout = true;
            this.onLoadEmitter.fire();
        }, 1000);
    }
}

function isValidSText(stext: SText): boolean {
    return Array.isArray(stext) ? stext.every(isValidSText) : typeof stext === 'string';
}