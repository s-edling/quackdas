/**
 * Shared base64 helpers for ArrayBuffer <-> base64 conversion.
 * Loaded as a plain script and exposed as globals used across modules.
 */

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }

    const chunkSize = 0x8000;
    const parts = [];
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        parts.push(String.fromCharCode.apply(null, chunk));
    }
    return btoa(parts.join(''));
}

function base64ToArrayBuffer(base64) {
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        const nodeBuffer = Buffer.from(base64, 'base64');
        const out = new Uint8Array(nodeBuffer.byteLength);
        out.set(nodeBuffer);
        return out.buffer;
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
