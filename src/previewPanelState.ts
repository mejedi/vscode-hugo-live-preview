import * as vscode from 'vscode';
import { PageDirectoryService } from './pageDirectoryService';
import { DisplayService, Display } from './displayService';

export enum PreviewPanelStateType {
    INITIALISING = "initialising",
    SERVER_STARTING = "serverStarting",
    SERVER_FAILED = "serverFailed",
    BUILD_FAILED = "buildFailed",
    SITE_MISCONFIGURED = "siteMisconfigured",
    READY = "ready",
    DISPOSED = "disposed"
}

/*
 * PreviewPanel starts in Initialising state. We are waiting for webview to tell us the origin.
 * Panel displays [starting server] screen.
 */
export interface Initialising {
    readonly type: PreviewPanelStateType.INITIALISING;
}
export function initialising(): Initialising {
    return { type: PreviewPanelStateType.INITIALISING };
}

/*
 * Waiting for HugoServerManager to yield a server.
 *  Initialising -> once webview origin is known
 *  ServerFailed -> once user explicitly requests to retry
 * Panel displays [starting server] screen.
 */
export interface ServerStarting {
    readonly type: PreviewPanelStateType.SERVER_STARTING;
}
export function serverStarting(): ServerStarting {
    return { type: PreviewPanelStateType.SERVER_STARTING };
}

/*
 * Server terminated or failed to start.
 *   ServerStarting -> if .hugoServerManager.requestServer fails
 *   (*) ->            triggered by .hugoServer.onDidTerminate
 * Panel displays [server unexpectedly terminated or failed to start], followed by
 * the error details. [Retry] triggers ServerStartingState.
 */
export interface ServerFailed {
    readonly type: PreviewPanelStateType.SERVER_FAILED;
    readonly err: string;
}
export function serverFailed(err: Error): ServerFailed {
    return { type: PreviewPanelStateType.SERVER_FAILED, err: err.message };
}

/* Server failed to build content. Showing Hugo error page as is. */
export interface BuildFailed {
    readonly type: PreviewPanelStateType.BUILD_FAILED;
}
export function buildFailed(): BuildFailed {
    return { type: PreviewPanelStateType.BUILD_FAILED };
}

/*
 * Either page directory is not available or payload script is not injected.
 *
 * Information screen is displayed, walking the user through setting up integration.
 * It starts with status [pageDirectory, payload.js]. It offers a button to create the partial.
 */
export interface SiteMisconfigured {
    readonly type: PreviewPanelStateType.SITE_MISCONFIGURED;
    readonly checkinTimedout?: boolean;
    readonly pageDirectoryNotAvailable?: boolean;
}
export function siteMisconfigured(display: DisplayService, pageDir: PageDirectoryService): SiteMisconfigured {
    return {
        type: PreviewPanelStateType.SITE_MISCONFIGURED,
        checkinTimedout: display.checkinTimedout,
        pageDirectoryNotAvailable: pageDir.pageDirectoryNotAvailable
    };
}

/*
 * Whether we display content or a placeholder.
 *
 * [No preview available for X] could either take the whole panel, or show as a banner.
 * The later is useful when selected source file defines parts of the displayed page but is not the primary markdown file.
 */
export enum PreviewStatus {
    SHOWING_PREVIEW = "showingPreview",
    NO_PREVIEW_AVAILABLE = "noPreviewAvailable",
    NO_PREVIEW_AVAILABLE_BANNER = "noPreviewAvailableBanner"
};

/* Ready to preview content. */
export interface Ready {
    readonly type: PreviewPanelStateType.READY;

    /* Whether we display content or a placeholder. */
    readonly previewStatus: PreviewStatus;

    /* If we aren't SHOWING_PREVIEW, depending on .sourcePath value we either show [no preview available for .sourceUrl] or [please select a file to preview] */
    readonly sourcePath?: string;
}
export function readyShowingPreview(): Ready {
    return { type: PreviewPanelStateType.READY, previewStatus: PreviewStatus.SHOWING_PREVIEW };
}
export function readyNoPreviewAvailable(display?: Display, path?: string): Ready {
    const status = path !== undefined && display !== undefined ?
        PreviewStatus.NO_PREVIEW_AVAILABLE_BANNER : PreviewStatus.NO_PREVIEW_AVAILABLE;
        return { type: PreviewPanelStateType.READY, previewStatus: status, sourcePath: path };
}

/* The panel has been closed. */
export interface Disposed {
    readonly type: PreviewPanelStateType.DISPOSED;
}
export function disposed(): Disposed {
    return { type: PreviewPanelStateType.DISPOSED };
}

export type PreviewPanelState = Initialising | ServerStarting | ServerFailed | BuildFailed | SiteMisconfigured | Ready | Disposed;