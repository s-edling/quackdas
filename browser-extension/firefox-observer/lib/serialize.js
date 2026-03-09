(function(global) {
    function createUuid() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        const bytes = new Uint8Array(16);
        global.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    function formatLocalTimestamp(iso) {
        const date = new Date(iso);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    }

    function buildObservationPayload(entry, options) {
        const includeImage = !(options && options.includeImage === false);
        const includeHtml = !(options && options.includeHtml === false);
        const preserveExistingAssets = !!(options && options.preserveExistingAssets);
        const uuid = entry.uuid || createUuid();
        const imageBase64 = includeImage && entry.imageDataUrl
            ? String(entry.imageBase64 || '').trim() || dataUrlToBase64(entry.imageDataUrl)
            : '';
        const payload = {
            uuid,
            fieldsite: entry.fieldsite,
            url: entry.url,
            pageTitle: entry.pageTitle,
            timestamp: entry.timestamp,
            note: entry.note || '',
            sessionDate: entry.sessionDate
        };
        if (includeHtml) payload.html = entry.html || '';
        if (imageBase64) payload.imageBase64 = imageBase64;
        if (entry.sessionHeading) payload.sessionHeading = true;
        if (entry.sessionStartedAt) payload.sessionStartedAt = entry.sessionStartedAt;
        if (preserveExistingAssets) payload.preserveExistingAssets = true;
        return {
            uuid,
            payload,
            timestampLabel: formatLocalTimestamp(entry.timestamp)
        };
    }

    function dataUrlToBase64(dataUrl) {
        const match = String(dataUrl || '').match(/^data:.*?;base64,(.+)$/);
        return match ? match[1] : '';
    }

    global.ObserverSerialize = {
        createUuid,
        formatLocalTimestamp,
        buildObservationPayload
    };
})(this);
