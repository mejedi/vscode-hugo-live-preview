// unit: payload
/// <reference lib="dom" />

import * as proto from './protocol';

// Patched by the loader
const embedderOrigin = '${EMBEDDER-ORIGIN}';
function tellEmbedder<T>(msg: T): void {
    window.parent !== window && window.parent.postMessage(msg, embedderOrigin);
}

const intersectionObserver = new IntersectionObserver(entries => {
    const hidden: number[] = [];
    const revealed: number[] = [];
    for (const entry of entries) {
        const info = nodeInfo.get(entry.target);
        if (info !== undefined) {
            (entry.isIntersecting ? revealed : hidden).push(info.id);
        }
    }
    tellEmbedder<proto.UpdateIntersectionsMsg>({ msg: proto.MsgType.UPDATE_INTERSECTIONS, hidden, revealed });
});

import {SText, stringToSText, domToSText, sTextTraverse} from './stext';
const nodes: Node[] = [];
const nodeInfo = new Map<Node, {id: number, offset: number, text: string}>();

function onDOMReady(): void {
    const [stext, xnodes] = domToSText(document.body);
    nodes.push(...xnodes);

    let offset = 0;
    sTextTraverse(stext, (node, id) => {
        const info = {id, offset, text: ""};
        if (typeof node === "string") {
            info.text = node;
            offset += node.length;
        }
        nodeInfo.set(nodes[id], info);
    });

    for (let node of nodes) {
        if (node.nodeType === node.ELEMENT_NODE)
            intersectionObserver.observe(node as HTMLElement);
    }

    tellEmbedder<proto.CheckinMsg>({ msg: proto.MsgType.CHECKIN, href: document.location.href, stext });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDOMReady);
} else {
    onDOMReady();
}

function shouldHandleClick(e: Event): boolean {
    if (e.defaultPrevented) return false;
    for (let el = e.target as HTMLElement; el != e.currentTarget; el = el.parentNode as HTMLElement) {
        if (el.nodeName == 'A' && el.hasAttribute('href')) return false;
    }
    return true;
}

document.addEventListener('click', e => {
    if (!shouldHandleClick(e)) return;
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;
    const info = nodeInfo.get(range.startContainer);
    if (info === undefined) return;
    let offset = info.offset;
    const text = range.startContainer.textContent || '';
    if (info.text === stringToSText(text)) {
        // SText transforms text nodes, convert startOffset accordingly
        offset += stringToSText(text.substring(0, range.startOffset)).length;
    }
    tellEmbedder<proto.ClickMsg>({ msg: proto.MsgType.CLICK, offset });
})

function elementFromNode(node: Node): HTMLElement | null {
    let p: Node | null = node;
    while (p.nodeType !== Node.ELEMENT_NODE) {
        p = p.parentNode;
        if (p === null) return null;
    }
    return p as HTMLElement;
}

function canScrollIntoView(el: HTMLElement): boolean {
    // element's offsetParent property will return null whenever it, or any of its parents
    // is hidden via the display style property (false-positive: position: fixed)
    if (el.offsetParent === null) return false;
    if (window.getComputedStyle(el).visibility !== 'visible') return false;
    // TODO verify position and overflow properties of the ancestors.
    // TODO sticky?
    return true;
}

window.addEventListener('message', (event) => {
    if (event.origin !== embedderOrigin) return;
    switch (event.data.msg) {
    case 'scroll-into-view':
        {
            const node = nodes[+event.data.node];
            if (node !== undefined) {
                const el = elementFromNode(node);
                el !== null && el.scrollIntoView();
            }
            break;
        }
    }
});

// intercept navigation to external links
// rationale: many sites refuse to load in iframe ending up with a blank page (and no way to programmatically detect the issue)
// https://developer.mozilla.org/en-US/docs/Web/API/Navigation/navigate_event
// @ts-ignore
window.navigation !== undefined && window.navigation.addEventListener('navigate', (event) => {
    if (window.location.origin !== new URL(event.destination.url).origin) {
        event.preventDefault();
        tellEmbedder<proto.NavigateToMsg>({ msg: proto.MsgType.NAVIGATE_TO, url: event.destination.url });
    }
});