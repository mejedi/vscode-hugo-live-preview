// Structured text
export type SText = string | Array<SText>;

// text undergoes transformation when becoming an SText
export function stringToSText(str: string): string {
    return str.trim();
}

// domToSText() extracts text content while preserving structure.
// Text nodes are exported as strings.
// Elements are exported as arrays of (exported) child nodes.
// Drops subtrees that don't contribute any text content.
// returns [textStructureInNestedArrays, listOfSourceDOMNodes].
// Every item in textStructureInNestedArrays (string or array)
// has implicit id (incrementing counter in preorder tree traversal).
// To obtain the matching source DOM node, refer to
// listOfSourceDOMNodes[implicitID].
export function domToSText(root: Node): [SText, Array<Node>] {
    const nodes: Array<Node> = [];
    const wk = function(node: Node): null | SText {
        switch (node.nodeType) {
        case Node.ELEMENT_NODE:
            // Note: unlike .innerText, we include hidden elements.
            // This is useful for e.g. tabbed code views showing listings
            // in multiple languages.
            if (["SCRIPT", "STYLE"].includes(node.nodeName)) return null;
            nodes.push(node);
            const cc = Array.prototype.map.call(node.childNodes, wk).filter(e => e) as Array<SText>;
            // TODO IMG.alt, IMG.src (fake nodes referring to IMG itself)
            if (cc.length === 0) {
                nodes.pop();
                return null;
            }
            return cc;
        case Node.TEXT_NODE:
            const t = stringToSText(node.textContent as string);
            if (t === "") return null;
            nodes.push(node);
            return t;
        default:
            return null;
        }
    }
    return [wk(root) || [], nodes];
}

// sTextTraverse() walks SText tree in preorder and invokes
// cb for each node, passing node ID in the second
// parameter.
export function sTextTraverse(stext: SText, cb: (node: SText, id: number) => void): void {
    let i = 0;
    const wk = (node: SText) => {
        cb(node, i++);
        if (Array.isArray(node)) {
            node.forEach(wk);
        }
    };
    wk(stext);
}