# vscode-hugo-live-preview

Hugo preview panel for VSCode. Inspired by the convenience of built-in Markdown preview in VSCode.

*THIS IS AN EARLY SNAPSHOT. PLEASE SHARE FEEDBACK.*

## Features available so far

1. A preview panel following the currently active text editor (no scroll sync yet).
2. Click anywhere in the preview to automatically position the caret in the source file.

## Installation, usage

Prebuilt binaries are available from [Releases](https://github.com/mejedi/vscode-hugo-live-preview/releases). Follow [Install from a VSIX](https://code.visualstudio.com/docs/editor/extension-marketplace#_install-from-a-vsix) to install VSCode extension from the provided file.

Once installed, please invoke `'Open Hugo Live preview'` from the Command Palette to open a preview panel. Hugo server is launched automatically.

## Site adaptation

The extensions wants to inject a script into your Hugo site. If the script is missing, the following message is displayed.

> Please modify your Hugo project to enable live preview

>  We need a little help here to make our features work. A ready-made partial template is available for your convenience. Please ensure that every page invokes the provided partial as early as possible. Refer to your theme's documentation for details.

> [ Create Partial ]

## Internals

The project consists of the following structural parts:
 * **extension** — the logic running in VSCode process,
 * **embedder** — a VSCode webview with an iframe showing Hugo website, and
 * **payload** — a script injected into Hugo website.

_Payload_ extracts text from a displayed page.

On click _extension_ matches the extracted text with Markdown source code and positions the caret accordingly. Matching is done using standard `diff` algorithm.

This simple approach works well surprisingly often. I actively use this extension and I find it very helpful.


## Contributions and feedback are welcome!

The code is distributed under MIT license. The author might not have enough time to actively work on this extension in the coming months as this work prevents other efforts from progressing, such as actually writing something for his personal Hugo blog.

*Dubai — Moscow — Berlin 2023*
