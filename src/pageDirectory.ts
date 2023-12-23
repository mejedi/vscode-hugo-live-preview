// unit: extension
import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'http';

export class PageDirectoryParseError extends Error {}

export interface PageInfo {
    /**
     * The URL to access content.
     */
    readonly url: vscode.Uri;

    /**
     * Full source file path.
     */
    readonly source?: vscode.Uri;

    /**
     * Content language.
     */
    readonly lang: string;

    /**
     * Alternative page URLs.
     */
    readonly aliases: readonly vscode.Uri[];
}

/**
 * Parse Hugo page directory embedded in HTML.
 * The data is wrapped in <script type="application/json">...</script> tag.
 * We expect to find an array under "pageDirectory" key in the root JSON object.
 */
export function parsePageDirectory(htmlData: string): PageInfo[] {
    const beginScriptRe = /<script[^<>]*>/gi;
    const endScriptRe = /<\/script/gi;
    for (let match of htmlData.matchAll(beginScriptRe)) {
        if (!/application\/json/i.test(match[0])) continue;
        const payloadOffset = (match.index as number) + match[0].length;
        endScriptRe.lastIndex = payloadOffset;
        const match2 = endScriptRe.exec(htmlData);
        if (match2 === null) continue;
        try {
            const res = importPageDirectory(JSON.parse(htmlData.slice(payloadOffset, match2.index)));
            if (res !== undefined) return res;
        } catch {
        }
    }
    throw new PageDirectoryParseError("Page directory malformed or missing");
}

/**
 * {"pageDirectory":[...]}
 */
function importPageDirectory(data: any): PageInfo[] | undefined {
    if (typeof data !== 'object') return;
    const pageGroups = data.pageDirectory;
    if (!Array.isArray(pageGroups) || pageGroups.length === 0) return;
    const res = pageGroups.map(importPageDirectoryGroup);
    if (res.some(importedGroup => importedGroup === undefined)) return;
    return res.flat(1) as PageInfo[];
}

/**
 * { "lang": "en", "base": "http://localhost:1313/", "pages": [ {"rel": "/foo"}, {"rel": "/bar", "file": "content/en/bar/index.md"}, ... ] }
 */
function importPageDirectoryGroup(group: any): PageInfo[] | undefined {
    if (typeof group !== 'object') return;
    const lang = group.lang;
    if (typeof lang !== 'string') return;
    const base = group.base;
    if (typeof base !== 'string') return;
    const baseUrl = vscode.Uri.parse(base);
    const pages = group.pages;
    if (!Array.isArray(pages)) return;
    const res: (PageInfo | undefined)[] = pages.map((page: any): PageInfo | undefined => {
        if (typeof page !== 'object') return;
        const rel = page.rel;
        if (typeof rel !== 'string') return;
        const file = page.file;
        if (typeof file !== 'string' && file !== undefined) return;
        const aliasesRel = page.aliases === undefined ? [] : page.aliases;
        if (!Array.isArray(aliasesRel) || aliasesRel.some(alias => typeof alias !== 'string')) return;
        const aliases = aliasesRel.map(alias => baseUrl.with({path: alias}));
        return {url: baseUrl.with({path: rel}), source: (file && vscode.Uri.file(file)) as vscode.Uri | undefined, lang, aliases};
    });
    return res.some((info: PageInfo | undefined) => info === undefined) ? undefined : res as PageInfo[];
}

/**
 * Retrieve Hugo page directory from the specified URL.
 */
export async function fetchPageDirectory(url: vscode.Uri): Promise<PageInfo[]> {
    const protocol = (() => {
        switch (url.scheme) {
        case 'http': return http;
        case 'https': return https;
        default: throw new Error(`Unsupported protocol ${url.scheme}`);
        }
    }) ();
    return new Promise<PageInfo[]>((resolve, reject) => {
        protocol.get(url.toString(), (res) => {
            const { statusCode } = res;
            if (statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP request failed (Status ${statusCode})`));
            }
            res.setEncoding('utf8');
            const chunks: string[] = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                try {
                    resolve(parsePageDirectory(chunks.join('')));
                } catch(e) {
                    reject(e);
                }
            });
        }).on('error', e => reject(e));
    });
}