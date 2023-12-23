// unit: embedder
/// <reference lib="dom" />

import * as proto from './protocol';
import * as previewPanelState from './previewPanelState';
import { PreviewPanelState, PreviewPanelStateType } from './previewPanelState';

const tellExtension = (() => {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    return function<T>(msg: T) {
        vscode.postMessage(msg);
    }
})();

let allowedContentOrigins: string[];
let contentIframe: HTMLIFrameElement | undefined;
let emergencyIframe: HTMLIFrameElement | undefined;

tellExtension<proto.DiscloseWebviewOriginMsg>({ msg: proto.MsgType.DISCLOSE_WEBVIEW_ORIGIN, origin });

import UI from './embedder.svelte';

const ui = new UI({
	target: document.body,
	props: {
        state: previewPanelState.serverStarting(),
        doRestartServer: () => tellExtension<proto.RestartServerMsg>({ msg: proto.MsgType.RESTART_SERVER }),
        doCreateLivePreviewPartial: () => tellExtension<proto.CreateLivePreviewPartialMsg>({ msg: proto.MsgType.CREATE_LIVE_PREVIEW_PARTIAL })
	}
});

window.addEventListener('message', event=>{
    if (event.origin === origin) {
        const message = event.data as proto.NavigateBackMsg | proto.NavigateForwardMsg | proto.SetUrlMsg | proto.SetStateMsg | proto.SetAllowedContentOriginsMsg;
        if (message.msg == proto.MsgType.NAVIGATE_BACK) history.back();
        if (message.msg == proto.MsgType.NAVIGATE_FORWARD) history.forward();
        if (message.msg == proto.MsgType.SET_URL) {
            if (contentIframe === undefined) {
                contentIframe = document.createElement('iframe');
                contentIframe.setAttribute('src', message.url);
                ui.contentIframe = contentIframe;
            } else {
                contentIframe.setAttribute('src', message.url);
            }
        }
        if (message.msg == proto.MsgType.REPLACE_URL && contentIframe !== undefined) {
            contentIframe.contentWindow?.location?.replace(message.url);
        }
        if (message.msg == proto.MsgType.SET_STATE) {
            const state = message.state;
            if (state.type == PreviewPanelStateType.BUILD_FAILED && contentIframe === undefined && emergencyIframe === undefined) {
                // No contentIframe yet, need to open *any* URL to witness error diagnostics.
                // Note: going with distinct iframe to avoid polluting history.
                emergencyIframe = document.createElement('iframe');
                emergencyIframe.setAttribute('src', allowedContentOrigins[0]);
                ui.contentIframe = emergencyIframe;
            }
            ui.state = event.data.state;
        }
        if (message.msg == proto.MsgType.SET_ALLOWED_CONTENT_ORIGINS) {

            allowedContentOrigins = message.origins;

            // Nuke iframes. Resets history which could contain invalid entries since server URL(s) migh have changed.
            contentIframe = undefined;
            emergencyIframe = undefined;
            ui.contentIframe = undefined;
        }
    } else if (shouldForwardMessage(event)) {
        tellExtension(event.data);
    }
});

function shouldForwardMessage(event: any): boolean {
    if (event.source !== contentIframe?.contentWindow) return false;
    if (!allowedContentOrigins.includes(event.origin)) return false;
    const payloadToExtMsgTypes = [
        proto.MsgType.CHECKIN,
        proto.MsgType.UPDATE_INTERSECTIONS,
        proto.MsgType.NAVIGATE_TO,
        proto.MsgType.CLICK,
    ];
    return payloadToExtMsgTypes.includes(event.data.msg);
}