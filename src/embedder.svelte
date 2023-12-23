<!-- unit: embedder -->
<svelte:options accessors />

<script lang="ts">
    import { PreviewPanelState, PreviewPanelStateType, PreviewStatus } from './previewPanelState';
    import * as previewPanelState from './previewPanelState';

    export let state: PreviewPanelState;
    export let contentIframe: HTMLIFrameElement | undefined = undefined;
    export let doRestartServer: () => any | undefined;
    export let doCreateLivePreviewPartial: () => any | undefined;

    /** @type {import('svelte/action').Action}  */
    function graftContentIframe(node: HTMLElement, contentIframe: HTMLIFrameElement | undefined) {
        // the node has been mounted in the DOM
        let prevContentIframe = contentIframe;
        if (contentIframe !== undefined) node.appendChild(contentIframe);

        return {
            update(contentIframe: HTMLIFrameElement | undefined) {
                if (prevContentIframe !== undefined) prevContentIframe.remove();
                if (contentIframe !== undefined) node.appendChild(contentIframe);
                prevContentIframe = contentIframe;
            },

            destroy() {
                // the node has been removed from the DOM
            }
        };
    }

    function hideContentView(state: PreviewPanelState): boolean {
        if (state.type === PreviewPanelStateType.READY) return state.previewStatus === PreviewStatus.NO_PREVIEW_AVAILABLE;
        return state.type !== PreviewPanelStateType.BUILD_FAILED;
    }

    function bannerShape(state: PreviewPanelState): boolean {
        return state.type === PreviewPanelStateType.READY && state.previewStatus === PreviewStatus.NO_PREVIEW_AVAILABLE_BANNER;
    }

    function pageDirStatus(state: previewPanelState.SiteMisconfigured): string {
        switch (state.pageDirectoryNotAvailable) {
        case undefined:
            return 'pending';
        case false:
            return 'found';
        case true:
            return 'not found';
        }
    }

    function injectedScriptStatus(state: previewPanelState.SiteMisconfigured): string {
        switch (state.checkinTimedout) {
        case undefined:
            return 'pending';
        case false:
            return 'ok';
        case true:
            return 'timeout';
        }
    }

</script>

<div class="frame {hideContentView(state) ? "contentViewHidden" : ""}">

    <div class="contentView" use:graftContentIframe={contentIframe}></div>

    <div class="auxView {bannerShape(state) ? 'banner' : ''}">
{#if state.type === PreviewPanelStateType.SERVER_STARTING }
    <p>Starting sever...</p>
{/if}

{#if state.type === PreviewPanelStateType.SERVER_FAILED }
    <p><b>Server unexpectedly terminated or failed to start</b></p>
    <p>{state.err}.</p>
    <p>
        <button type="button" class="btn btnPrimary" on:click={doRestartServer}>Restart</button>
    </p>
{/if}

{#if state.type === PreviewPanelStateType.SITE_MISCONFIGURED }
    <p><b>Please modify your Hugo project to enable live preview</b></p>
    <p>We need a little help here to make our features work.
    A ready-made <i>partial template</i> is available for your convenience.
    Please ensure that every page invokes the provided partial as early as possible.
    Refer to your theme's documentation for details.</p>
    <p><button type="button" class="btn btnPrimary" on:click={doCreateLivePreviewPartial}>Create Partial</button></p>


    <div class="hero">
        <p><b>What happens once I enable this partial?</b></p>

        <p>Your deployed site is not affected. The partial is only enabled when
        <span class="code">HUGO_LIVE_PREVIEW_SCRIPT</span> variable is set in the environment.</p>
        <p>This extension runs <span class="code">hugo server</span> internally, passing the environment variable.</p>
        <p>JSON listing of pages is embedded in website's home page.
        This data helps matching a source file to the respective page.
        <span class="status">{pageDirStatus(state)}</span></p>
        <p>A JavaScript is injected. It powers advanced features such as syncing editor
        and preview scroll positions. <span class="status">{injectedScriptStatus(state)}</span></p>
    </div>

{/if}

{#if state.type === PreviewPanelStateType.READY && state.previewStatus !== PreviewStatus.SHOWING_PREVIEW}
    {#if state.sourcePath !== undefined}
        <p>No preview available for  <span class="code">{state.sourcePath}</span></p>
    {:else}
        <p>Please select a file to preview.</p>
    {/if}
{/if}
    </div>

</div>

<style>
    .frame {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        right: 0;
        display: flex;
        flex-direction: column-reverse;
        color: var(--vscode-foreground);
    }
    .contentView {
        flex-grow: 1;
        position: relative;
        display: flex;
        flex-direction: row;
    }
    .auxView {
        padding: 0px 20px;
    }
    .auxView.banner {
        border-bottom: solid 1px var(--vscode-widget-border);
    }
    .auxView.banner p {
        margin: 0.65em 0em;
    }
    :global(.contentView iframe) {
        border: 0px;
        width: 100vw; /* OH WHY */
    }
    .contentViewHidden .contentView {
        display: none;
    }
    .contentViewHidden .auxView {
        flex-grow: 1;
    }
    .btn {
        box-sizing: border-box;
        padding: 4px 6px;
        white-space: normal;
        border-radius: 2px;
        text-align: center;
        cursor: pointer;
        border: 1px solid var(--vscode-button-border,transparent);
        line-height: 18px;
        margin-right: 6px;

    }
    .btnPrimary {
        color: var(--vscode-button-foreground);
        background-color: var(--vscode-button-background);
    }
    .btnPrimary:hover {
        background-color: var(--vscode-button-hoverBackground);
    }
    /*
    .btnSecondary {
        color: var(--vscode-button-secondaryForeground);
        background-color: var(--vscode-button-secondaryBackground);
    }
    .btnSecondary:hover {
        background-color: var(--vscode-button-secondaryHoverBackground);
    }
    */
    p, .hero {
        max-width: 600px;
    }
    .hero {
        color: var(--vscode-peekViewTitle-foreground);
        background-color: var(--vscode-peekViewTitle-background);
        padding: 2px 16px;
        border-radius: 8px;
        margin-top: 24px;
    }
    .code {
        font-family: monospace;
    }
    .status {
        color: var(--vscode-profileBadge-foreground);
        background-color: var(--vscode-profileBadge-background);
        font-variant: small-caps;
        padding: 0px 3px 2px 3px;
        border-radius: 2px;
        margin: 4px;
        display: inline-block;
        vertical-align: middle;
    }
</style>
