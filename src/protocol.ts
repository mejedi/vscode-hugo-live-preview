/*
 * Messages exchanged between extension, embedder and payload.
 */
import { PreviewPanelState } from "./previewPanelState";
import { SText } from "./stext";

export enum MsgType {
    // ext to embedder
    NAVIGATE_BACK = "navigateBack",
    NAVIGATE_FORWARD = "navigateForward",
    SET_URL = "setUrl",
    REPLACE_URL = "replaceUrl",
    SET_STATE = "setState",
    SET_ALLOWED_CONTENT_ORIGINS = "setAllowedContentOrigins",

    // embedder to ext
    DISCLOSE_WEBVIEW_ORIGIN = "discloseWebviewOrigin",
    RESTART_SERVER = "restartServer",
    CREATE_LIVE_PREVIEW_PARTIAL = "createLivePreviewPartial",

    // payload to ext
    CHECKIN = "checkin",
    NAVIGATE_TO = "navigateTo",
    CLICK = "click",
    UPDATE_INTERSECTIONS = "updateIntersections",
}

/*
 * ext to embedder
 */

export interface NavigateBackMsg {
    readonly msg: MsgType.NAVIGATE_BACK;
}

export interface NavigateForwardMsg {
    readonly msg: MsgType.NAVIGATE_FORWARD;
}

export interface SetUrlMsg {
    readonly msg: MsgType.SET_URL | MsgType.REPLACE_URL;
    readonly url: string;
}

export interface SetStateMsg {
    readonly msg: MsgType.SET_STATE;
    readonly state: PreviewPanelState;
}

export interface SetAllowedContentOriginsMsg {
    readonly msg: MsgType.SET_ALLOWED_CONTENT_ORIGINS;
    readonly origins: string[];
}

/*
 * embedder to ext
 */

export interface DiscloseWebviewOriginMsg {
    readonly msg: MsgType.DISCLOSE_WEBVIEW_ORIGIN;
    readonly origin: string;
}

export interface RestartServerMsg {
    readonly msg: MsgType.RESTART_SERVER;
}

export interface CreateLivePreviewPartialMsg {
    readonly msg: MsgType.CREATE_LIVE_PREVIEW_PARTIAL;
}

/*
 * payload to ext
 */

export interface CheckinMsg {
    readonly msg: MsgType.CHECKIN;
    readonly href: string;
    readonly stext: SText;
}

export interface NavigateToMsg {
    readonly msg: MsgType.NAVIGATE_TO;
    readonly url: string;
}

export interface ClickMsg {
    readonly msg: MsgType.CLICK;
    readonly offset: number;
}

export interface UpdateIntersectionsMsg {
    readonly msg: MsgType.UPDATE_INTERSECTIONS;
    readonly hidden: number[];
    readonly revealed: number[];
}