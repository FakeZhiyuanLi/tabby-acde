// Binary data in the backend's NDJSON events is base64. The runtime's own decoder is hundreds of
// times faster than turning atob()'s string into bytes in JavaScript, which capped SSH output at a
// few MB/s and kept the page busy.
export function bytesFromBase64 (text) {
    const bytes = typeof Uint8Array.fromBase64 === 'function'
        ? Uint8Array.fromBase64(text)
        : Uint8Array.from(atob(text), c => c.charCodeAt(0))
    // Tabby's plugins expect Buffers; wrap the bytes without copying them.
    return globalThis.Buffer ? globalThis.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length) : bytes
}
