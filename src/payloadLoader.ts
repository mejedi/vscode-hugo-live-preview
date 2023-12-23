// unit: extension
const payloadBlob: string = require('payload.blob');

export function preparePayload(embedderOrigin: string): string {
    return payloadBlob.replace('${EMBEDDER-ORIGIN}', embedderOrigin);
}