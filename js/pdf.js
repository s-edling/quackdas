/**
 * Quackdas - PDF Handling Module
 * PDF rendering with selectable text layer for coding
 * 
 * Uses PDF.js (Mozilla) for rendering and text extraction.
 * Text positions are stored at import time so coding works offline.
 */

// PDF.js library reference (loaded from index.html)
let pdfjsLib = null;

// Current PDF rendering state
let currentPdfState = {
    pdfDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
    docId: null,
    loadingTask: null,
    pageRenderTask: null,
    textLayerRenderTask: null,
    renderToken: 0,
    ocrPromise: null,
    pendingRegion: null,
    pendingGoToRegion: null,
    pendingGoToPage: null,
    pendingGoToCharPos: null,
    textSelectionEnabled: false,
    codingMode: 'text',
    viewerFrame: null,
    viewerLoadedDocId: null,
    viewerReadyPromise: null,
    viewerReady: false,
    viewerReadyResolve: null,
    viewerReadyReject: null
};
const PDF_VIEWER_HOST_PATH = 'js/pdfjs/web/quackdas-viewer.html';
const PDF_VIEWER_MESSAGE_NAMESPACE = 'quackdas-pdf-host:v1';
const pdfRegionPreviewCache = new Map();
const pdfRegionPreviewInflight = new Map();
const pdfRegionPreviewQueue = [];
const pdfRegionPreviewQueued = new Map();
const PDF_THUMB_QUEUE_CONCURRENCY = 2;
let pdfRegionPreviewWorkers = 0;
let pdfRegionPreviewPumpTimer = null;
const PDF_THUMB_MANIFEST_LIMIT = 500;
const PDF_THUMB_MANIFEST_PREFIX = 'quackdas-thumb-manifest:';
let pdfThumbManifestKey = null;
let pdfThumbManifestLoaded = false;
let pdfThumbManifestMap = new Map();
let pdfThumbManifestSaveTimer = null;
let pdfSelectionStatusTimer = null;
let pdfSelectionSyncFrame = null;
let pdfInteractionBindingsInstalled = false;
let pdfViewerMessageBindingsInstalled = false;
let pdfViewerRequestCounter = 0;
const pdfViewerPendingRequests = new Map();
const PDF_REGION_SELECTION_READY_TEXT = 'Region selected. Click a code to apply. Press Esc to clear.';
const PDF_TEXT_SELECTION_READY_TEXT = 'Text selected. Click a code to apply.';
const PDF_SELECTION_READY_TEXT = PDF_REGION_SELECTION_READY_TEXT;

function getCurrentPdfZoomPercent() {
    return currentPdfState.scale * 100;
}

function isPdfDocumentActive() {
    if (!currentPdfState.docId) return false;
    return appData.currentDocId === currentPdfState.docId;
}

function updatePdfToolbarState() {
    const pageEl = document.getElementById('pdfCurrentPage');
    const totalEl = document.getElementById('pdfTotalPages');
    const prevBtn = document.getElementById('pdfPrevBtn');
    const nextBtn = document.getElementById('pdfNextBtn');
    const zoomEl = document.getElementById('zoomLevel');

    if (pageEl) pageEl.textContent = String(currentPdfState.currentPage || 1);
    if (totalEl) totalEl.textContent = String(currentPdfState.totalPages || 1);
    if (prevBtn) prevBtn.disabled = currentPdfState.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPdfState.currentPage >= currentPdfState.totalPages;
    if (zoomEl) zoomEl.textContent = Math.round(getCurrentPdfZoomPercent()) + '%';
}

function setPdfSelectionStatus(message, variant = 'selected', autoHideMs = 0) {
    const status = document.getElementById('pdfSelectionStatus');
    if (!status) return;

    if (pdfSelectionStatusTimer) {
        clearTimeout(pdfSelectionStatusTimer);
        pdfSelectionStatusTimer = null;
    }

    status.textContent = message || PDF_SELECTION_READY_TEXT;
    status.classList.toggle('warning', variant === 'warning');
    status.hidden = false;

    if (autoHideMs > 0) {
        pdfSelectionStatusTimer = setTimeout(() => {
            status.hidden = true;
            status.classList.remove('warning');
            status.textContent = PDF_SELECTION_READY_TEXT;
            pdfSelectionStatusTimer = null;
        }, autoHideMs);
    }
}

function cancelPdfRenderTasks() {
    try {
        if (currentPdfState.pageRenderTask && typeof currentPdfState.pageRenderTask.cancel === 'function') {
            currentPdfState.pageRenderTask.cancel();
        }
    } catch (_) {}

    try {
        if (currentPdfState.textLayerRenderTask && typeof currentPdfState.textLayerRenderTask.cancel === 'function') {
            currentPdfState.textLayerRenderTask.cancel();
        }
    } catch (_) {}

    currentPdfState.pageRenderTask = null;
    currentPdfState.textLayerRenderTask = null;
}

function getPdfPageTextOffset(doc, pageNum) {
    if (!doc || !Array.isArray(doc.pdfPages) || pageNum <= 1) return 0;
    let offset = 0;
    for (let i = 0; i < pageNum - 1; i++) {
        const p = doc.pdfPages[i];
        if (!p || !Array.isArray(p.textItems)) continue;
        for (const item of p.textItems) {
            offset += (item.text || '').length;
        }
        offset += 2; // '\n\n' page break marker used at import
    }
    return offset;
}

function normalizePdfSelectionText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePdfSelectionLineWrapHyphenation(value) {
    return String(value || '')
        // Treat PDF/browser line-wrap hyphenation as equivalent to the joined word.
        .replace(/([A-Za-zÅÄÖåäö])[-\u00ad]\s*[\r\n]+\s*([A-Za-zÅÄÖåäö])/g, '$1$2')
        .replace(/([A-Za-zÅÄÖåäö])\s*[\r\n]+\s*([A-Za-zÅÄÖåäö])/g, '$1 $2');
}

function compactPdfSelectionText(value) {
    return normalizePdfSelectionText(value).replace(/\s+/g, '');
}

function refinePdfSelectionRangeWithSelectedText(doc, approxStart, approxEnd, selectedText) {
    if (!doc || typeof doc.content !== 'string') return null;
    if (!Number.isFinite(approxStart) || !Number.isFinite(approxEnd) || !(approxEnd > approxStart)) return null;

    const normalizedSelected = normalizePdfSelectionText(normalizePdfSelectionLineWrapHyphenation(selectedText));
    const compactSelected = compactPdfSelectionText(normalizePdfSelectionLineWrapHyphenation(selectedText));
    const trimmedSelectedLength = String(selectedText || '').trim().length;
    if (!normalizedSelected && !compactSelected) return null;

    const SEARCH_RADIUS = 32;
    const startMin = Math.max(0, approxStart - SEARCH_RADIUS);
    const startMax = Math.min(doc.content.length, approxStart + SEARCH_RADIUS);
    const endMin = Math.max(startMin + 1, approxEnd - SEARCH_RADIUS);
    const endMax = Math.min(doc.content.length, approxEnd + SEARCH_RADIUS);

    let best = null;
    let bestScore = Infinity;

    for (let start = startMin; start <= startMax; start++) {
        for (let end = Math.max(start + 1, endMin); end <= endMax; end++) {
            const candidateText = doc.content.slice(start, end);
            const normalizedCandidate = normalizePdfSelectionText(normalizePdfSelectionLineWrapHyphenation(candidateText));
            const compactCandidate = compactPdfSelectionText(normalizePdfSelectionLineWrapHyphenation(candidateText));

            const normalizedMatch = normalizedSelected && normalizedCandidate === normalizedSelected;
            const compactMatch = compactSelected && compactCandidate === compactSelected;
            if (!normalizedMatch && !compactMatch) continue;

            const rawTrimPenalty = (candidateText.length - candidateText.trim().length) * 4;
            const lengthPenalty = Math.abs(candidateText.trim().length - trimmedSelectedLength) * 0.5;
            const score = Math.abs(start - approxStart) + Math.abs(end - approxEnd) + rawTrimPenalty + lengthPenalty;
            if (score < bestScore) {
                bestScore = score;
                best = {
                    startIndex: start,
                    endIndex: end,
                    text: candidateText
                };
            }
        }
    }

    return best;
}

function isMappedPdfSelectionConsistent(doc, startPos, endPos, selectedText) {
    if (!doc || typeof doc.content !== 'string') return false;
    if (!Number.isFinite(startPos) || !Number.isFinite(endPos) || endPos <= startPos) return false;

    const mapped = normalizePdfSelectionText(normalizePdfSelectionLineWrapHyphenation(doc.content.slice(startPos, endPos)));
    const selected = normalizePdfSelectionText(normalizePdfSelectionLineWrapHyphenation(selectedText));
    if (!mapped || !selected) return false;

    if (mapped === selected) return true;
    if (mapped.includes(selected) || selected.includes(mapped)) return true;

    const mappedCompact = compactPdfSelectionText(mapped);
    const selectedCompact = compactPdfSelectionText(selected);
    if (!mappedCompact || !selectedCompact) return false;
    if (mappedCompact === selectedCompact) return true;
    if (mappedCompact.includes(selectedCompact) || selectedCompact.includes(mappedCompact)) return true;
    return false;
}

function clampPdfNumber(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function normalizePdfSelectionRect(rect) {
    if (!Array.isArray(rect) || rect.length < 4) return null;
    const x1 = Number(rect[0]);
    const y1 = Number(rect[1]);
    const x2 = Number(rect[2]);
    const y2 = Number(rect[3]);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    return [
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.max(x1, x2),
        Math.max(y1, y2)
    ];
}

function pointInsidePdfRect(point, rect, tolerance = 0) {
    if (!point || !rect) return false;
    return point[0] >= (rect[0] - tolerance) &&
        point[0] <= (rect[2] + tolerance) &&
        point[1] >= (rect[1] - tolerance) &&
        point[1] <= (rect[3] + tolerance);
}

function pdfRectsIntersect(a, b, tolerance = 0) {
    if (!a || !b) return false;
    return !(
        b[0] > a[2] + tolerance ||
        b[2] < a[0] - tolerance ||
        b[1] > a[3] + tolerance ||
        b[3] < a[1] - tolerance
    );
}

function buildPdfSelectionModelCacheKey(doc, pageInfo) {
    const items = Array.isArray(pageInfo?.textItems) ? pageInfo.textItems : [];
    const firstItem = items[0] || {};
    const lastItem = items[items.length - 1] || {};
    return [
        String(doc?.content || '').length,
        Number(pageInfo?.pageNum || 0),
        items.length,
        Number(firstItem?.start || 0),
        Number(lastItem?.end || 0),
        Number(pageInfo?.width || 0),
        Number(pageInfo?.height || 0),
        pageInfo?.ocr ? 'ocr' : 'pdf'
    ].join(':');
}

function getPdfSelectionModelStore(doc) {
    if (!doc || typeof doc !== 'object') return null;
    const contentLength = String(doc.content || '').length;
    if (!doc._pdfSelectionModels || doc._pdfSelectionModelsContentLength !== contentLength) {
        doc._pdfSelectionModels = {};
        doc._pdfSelectionModelsContentLength = contentLength;
    }
    return doc._pdfSelectionModels;
}

function parsePdfDecorationColor(value) {
    const hex = String(value || '').trim().replace(/^#/, '');
    if (!hex) return null;

    const normalized = hex.length === 3
        ? hex.split('').map((char) => char + char).join('')
        : hex;
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;

    return {
        r: Number.parseInt(normalized.slice(0, 2), 16),
        g: Number.parseInt(normalized.slice(2, 4), 16),
        b: Number.parseInt(normalized.slice(4, 6), 16)
    };
}

function formatPdfDecorationColor(rgb, alpha = 1) {
    if (!rgb) return `rgba(124, 152, 133, ${alpha})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function darkenPdfDecorationColor(rgb, factor = 0.72) {
    if (!rgb) return null;
    return {
        r: Math.max(0, Math.round(rgb.r * factor)),
        g: Math.max(0, Math.round(rgb.g * factor)),
        b: Math.max(0, Math.round(rgb.b * factor))
    };
}

function buildPdfSegmentDecorationStyle(segment, codeById) {
    const codes = Array.isArray(segment?.codeIds)
        ? segment.codeIds
            .map((codeId) => codeById.get(codeId))
            .filter(Boolean)
        : [];
    const primaryColor = parsePdfDecorationColor(codes[0]?.color || '#7c9885');
    const codeLabel = codes.map((code) => code.name).filter(Boolean).join(', ');

    return {
        color: formatPdfDecorationColor(primaryColor, 1),
        fillColor: formatPdfDecorationColor(primaryColor, 0.22),
        underlineColor: formatPdfDecorationColor(darkenPdfDecorationColor(primaryColor), 0.96),
        title: [codeLabel, segment?.text].filter(Boolean).join(' • ')
    };
}

function buildPdfSelectionGeometryFromTextItem(item, pageInfo) {
    const pageWidth = Math.max(1, Number(pageInfo?.width) || 1);
    const pageHeight = Math.max(1, Number(pageInfo?.height) || 1);

    if (
        Number.isFinite(Number(item?.xNorm)) &&
        Number.isFinite(Number(item?.yNorm)) &&
        Number.isFinite(Number(item?.wNorm)) &&
        Number.isFinite(Number(item?.hNorm))
    ) {
        const left = clampPdfNumber(item.xNorm, 0, 1) * pageWidth;
        const top = clampPdfNumber(item.yNorm, 0, 1) * pageHeight;
        const width = Math.max(1, clampPdfNumber(item.wNorm, 0, 1) * pageWidth);
        const height = Math.max(1, clampPdfNumber(item.hNorm, 0, 1) * pageHeight);
        return {
            originX: left,
            originY: top + (height * 0.82),
            ux: 1,
            uy: 0,
            vx: 0,
            vy: 1,
            width,
            height
        };
    }

    const transform = Array.isArray(item?.transform) ? item.transform.map((value) => Number(value) || 0) : null;
    if (!transform || transform.length < 6) return null;

    let ux = Number(transform[0]) || 0;
    let uy = -(Number(transform[1]) || 0);
    let unitLength = Math.hypot(ux, uy);
    if (!(unitLength > 0)) {
        ux = 1;
        uy = 0;
        unitLength = 1;
    }
    ux /= unitLength;
    uy /= unitLength;

    const vx = -uy;
    const vy = ux;
    const height = Math.max(
        1,
        Math.abs(Number(item?.height) || 0),
        Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0),
        unitLength
    );
    const width = Math.max(
        1,
        Math.abs(Number(item?.width) || 0),
        String(item?.text || item?.str || '').length
    );

    return {
        originX: Number(transform[4]) || 0,
        originY: pageHeight - (Number(transform[5]) || 0),
        ux,
        uy,
        vx,
        vy,
        width,
        height
    };
}

function buildPdfSelectionCharRect(geometry, pageInfo, charIndex, charCount) {
    if (!geometry || !(charCount > 0)) return null;
    const pageWidth = Math.max(1, Number(pageInfo?.width) || 1);
    const pageHeight = Math.max(1, Number(pageInfo?.height) || 1);
    const advance = geometry.width / Math.max(1, charCount);
    const startAdvance = advance * charIndex;
    const endAdvance = advance * (charIndex + 1);
    const startX = geometry.originX + (geometry.ux * startAdvance);
    const startY = geometry.originY + (geometry.uy * startAdvance);
    const endX = geometry.originX + (geometry.ux * endAdvance);
    const endY = geometry.originY + (geometry.uy * endAdvance);
    const ascent = geometry.height * 0.82;
    const descent = Math.max(1, geometry.height - ascent);
    const points = [
        [startX - (geometry.vx * ascent), startY - (geometry.vy * ascent)],
        [endX - (geometry.vx * ascent), endY - (geometry.vy * ascent)],
        [startX + (geometry.vx * descent), startY + (geometry.vy * descent)],
        [endX + (geometry.vx * descent), endY + (geometry.vy * descent)]
    ];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    });

    minX = clampPdfNumber(minX / pageWidth, 0, 1);
    minY = clampPdfNumber(minY / pageHeight, 0, 1);
    maxX = clampPdfNumber(maxX / pageWidth, 0, 1);
    maxY = clampPdfNumber(maxY / pageHeight, 0, 1);

    return {
        rect: [minX, minY, maxX, maxY],
        center: [
            clampPdfNumber((minX + maxX) / 2, 0, 1),
            clampPdfNumber((minY + maxY) / 2, 0, 1)
        ]
    };
}

function resolvePdfSelectionItemsForPage(doc, pageInfo) {
    const rawItems = Array.isArray(pageInfo?.textItems) ? pageInfo.textItems : [];
    if (rawItems.length === 0) return [];

    const content = String(doc?.content || '');
    const storedRanges = buildPageCharRangesFromStoredOffsets(doc);
    const legacyRanges = storedRanges || buildPageCharRangesFromLegacyItems(doc);
    const pageNum = Number.parseInt(pageInfo?.pageNum, 10) || 1;
    const pageRange = Array.isArray(legacyRanges)
        ? (legacyRanges.find((range) => Number(range?.pageNum) === pageNum) || null)
        : null;
    const pageStart = Math.max(0, Number(pageRange?.start) || 0);
    const pageEnd = Math.max(pageStart, Number(pageRange?.end) || content.length);

    let cursor = pageStart;
    const resolved = [];

    for (const item of rawItems) {
        if (!item) continue;

        const text = String(item.text || item.str || '');
        if (!text) continue;

        let start = Number(item.start);
        let end = Number(item.end);

        if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) {
            let resolvedStart = Math.max(pageStart, cursor);
            if (content) {
                const foundAt = content.indexOf(text, cursor);
                const maxSearchEnd = Math.min(content.length, Math.max(pageEnd, cursor + 160));
                if (foundAt >= cursor && foundAt <= maxSearchEnd) {
                    resolvedStart = foundAt;
                }
            }

            start = resolvedStart;
            end = Math.min(content.length, start + text.length);
        }

        if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) continue;

        resolved.push(Object.assign({}, item, {
            start,
            end
        }));
        cursor = Math.max(cursor, end);
    }

    return resolved;
}

function buildPdfSelectionPageModelFromPageInfo(doc, pageInfo) {
    if (!doc || !pageInfo || !Array.isArray(pageInfo.textItems) || pageInfo.textItems.length === 0) return null;

    const chars = [];
    const items = resolvePdfSelectionItemsForPage(doc, pageInfo);

    if (items.length === 0) return null;

    for (const item of items) {
        const geometry = buildPdfSelectionGeometryFromTextItem(item, pageInfo);
        if (!geometry) continue;

        const itemStart = Number(item.start);
        const itemEnd = Number(item.end);
        const maxChars = Math.max(0, itemEnd - itemStart);
        const sourceText = String(item.text || item.str || doc.content.slice(itemStart, itemEnd) || '');
        const charCount = Math.min(sourceText.length, maxChars);
        if (!(charCount > 0)) continue;

        for (let i = 0; i < charCount; i++) {
            const rectInfo = buildPdfSelectionCharRect(geometry, pageInfo, i, charCount);
            if (!rectInfo) continue;
            const start = itemStart + i;
            chars.push({
                start,
                end: start + 1,
                rect: rectInfo.rect,
                center: rectInfo.center
            });
        }
    }

    if (chars.length === 0) return null;

    chars.sort((a, b) => a.start - b.start);
    return {
        pageNum: Number.parseInt(pageInfo.pageNum, 10) || 1,
        width: Math.max(1, Number(pageInfo.width) || 1),
        height: Math.max(1, Number(pageInfo.height) || 1),
        start: chars[0].start,
        end: chars[chars.length - 1].end,
        chars
    };
}

function getPdfSelectionPageModel(doc, pageNum) {
    if (!doc || !Array.isArray(doc.pdfPages)) return null;
    const pageInfo = doc.pdfPages.find((page) => (Number.parseInt(page?.pageNum, 10) || 1) === pageNum);
    if (!pageInfo) return null;

    const store = getPdfSelectionModelStore(doc);
    if (!store) return buildPdfSelectionPageModelFromPageInfo(doc, pageInfo);

    const cacheKey = buildPdfSelectionModelCacheKey(doc, pageInfo);
    const cached = store[pageNum];
    if (cached && cached.cacheKey === cacheKey) return cached.model;

    const model = buildPdfSelectionPageModelFromPageInfo(doc, pageInfo);
    store[pageNum] = { cacheKey, model };
    return model;
}

function getNormalizedSelectionRectsForPdfTextLayer(range, textLayer) {
    if (!range || !textLayer) return [];
    const layerRect = textLayer.getBoundingClientRect();
    if (!(layerRect.width > 0) || !(layerRect.height > 0)) return [];

    return Array.from(range.getClientRects())
        .map((clientRect) => normalizePdfSelectionRect([
            (clientRect.left - layerRect.left) / layerRect.width,
            (clientRect.top - layerRect.top) / layerRect.height,
            (clientRect.right - layerRect.left) / layerRect.width,
            (clientRect.bottom - layerRect.top) / layerRect.height
        ]))
        .filter(Boolean);
}

function getPdfSelectionRangeFromNormalizedRects(pageModel, rects, doc) {
    if (!pageModel || !Array.isArray(pageModel.chars) || pageModel.chars.length === 0) return null;
    if (!Array.isArray(rects) || rects.length === 0) return null;

    const hits = pageModel.chars.filter((char) => scorePdfSelectionCharHit(char, rects) >= 0.45);

    if (hits.length === 0) return null;
    hits.sort((a, b) => a.start - b.start);
    const startIndex = hits[0].start;
    const endIndex = hits[hits.length - 1].end;
    if (!(endIndex > startIndex)) return null;

    return {
        startIndex,
        endIndex,
        text: doc && typeof doc.content === 'string'
            ? doc.content.slice(startIndex, endIndex)
            : ''
    };
}

function scorePdfSelectionCharHit(char, rects) {
    if (!char?.rect || !char?.center || !Array.isArray(rects) || rects.length === 0) return 0;

    let bestScore = 0;
    const charWidth = Math.max(0.0001, (char.rect[2] - char.rect[0]));
    const charHeight = Math.max(0.0001, (char.rect[3] - char.rect[1]));
    const charArea = charWidth * charHeight;

    for (const rect of rects) {
        if (!rect) continue;
        if (pointInsidePdfRect(char.center, rect, 0.0015)) return 1;

        const overlapLeft = Math.max(char.rect[0], rect[0]);
        const overlapTop = Math.max(char.rect[1], rect[1]);
        const overlapRight = Math.min(char.rect[2], rect[2]);
        const overlapBottom = Math.min(char.rect[3], rect[3]);
        if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) continue;

        const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
        bestScore = Math.max(bestScore, overlapArea / charArea);
    }

    return bestScore;
}

function mergePdfTextHighlightRects(rects) {
    const normalizedRects = (Array.isArray(rects) ? rects : [])
        .map((rect) => normalizePdfSelectionRect(rect))
        .filter(Boolean)
        .sort((a, b) => {
            const aCenterY = (a[1] + a[3]) / 2;
            const bCenterY = (b[1] + b[3]) / 2;
            if (Math.abs(aCenterY - bCenterY) > 0.0015) return aCenterY - bCenterY;
            return a[0] - b[0];
        });
    if (normalizedRects.length === 0) return [];

    const merged = [];
    let current = normalizedRects[0].slice();

    for (let i = 1; i < normalizedRects.length; i++) {
        const rect = normalizedRects[i];
        const currentCenterY = (current[1] + current[3]) / 2;
        const rectCenterY = (rect[1] + rect[3]) / 2;
        const currentHeight = Math.max(0.001, current[3] - current[1]);
        const rectHeight = Math.max(0.001, rect[3] - rect[1]);
        const lineTolerance = Math.max(currentHeight, rectHeight) * 0.65;
        const gapTolerance = Math.max(0.003, Math.max(currentHeight, rectHeight) * 0.8);

        if (Math.abs(rectCenterY - currentCenterY) <= lineTolerance && rect[0] <= current[2] + gapTolerance) {
            current[0] = Math.min(current[0], rect[0]);
            current[1] = Math.min(current[1], rect[1]);
            current[2] = Math.max(current[2], rect[2]);
            current[3] = Math.max(current[3], rect[3]);
            continue;
        }

        merged.push(current);
        current = rect.slice();
    }

    merged.push(current);
    return merged;
}

function buildPdfTextHighlightRectsForRange(pageModel, startIndex, endIndex) {
    if (!pageModel || !Array.isArray(pageModel.chars) || pageModel.chars.length === 0) return [];

    const normalizedStart = Math.max(0, Number.parseInt(startIndex, 10) || 0);
    const normalizedEnd = Math.max(normalizedStart, Number.parseInt(endIndex, 10) || normalizedStart);
    if (!(normalizedEnd > normalizedStart)) return [];

    const rects = [];
    for (const char of pageModel.chars) {
        if (!char || !char.rect) continue;
        if (char.end <= normalizedStart) continue;
        if (char.start >= normalizedEnd) break;
        rects.push(char.rect);
    }

    return mergePdfTextHighlightRects(rects);
}

function selectionBelongsToPdfTextLayer(selection, textLayer) {
    if (!selection || !textLayer || !selection.rangeCount) return false;
    for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        let node = range.commonAncestorContainer;
        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        if (node && textLayer.contains(node)) return true;
        try {
            if (typeof range.intersectsNode === 'function' && range.intersectsNode(textLayer)) return true;
        } catch (_) {}
    }
    return false;
}

function clearPdfTextSelectionState(options = {}) {
    if (appData.selectedText && appData.selectedText.kind === 'pdfRegion') return;
    appData.selectedText = null;

    if (options.keepStatus === true) return;
    const status = document.getElementById('pdfSelectionStatus');
    if (!status) return;
    status.hidden = true;
    status.classList.remove('warning');
    status.textContent = PDF_SELECTION_READY_TEXT;
}

function getActivePdfCodingMode() {
    if (currentPdfState.codingMode === 'region') {
        return 'region';
    }
    return currentPdfState.textSelectionEnabled ? 'text' : 'region';
}

function updatePdfCodingModeControls() {
    const controls = document.getElementById('pdfCodingModeControls');
    const regionBtn = document.getElementById('pdfCodingModeRegionBtn');
    if (!controls || !regionBtn) return;

    const isPdfVisible = !!currentPdfState.docId;
    controls.hidden = !isPdfVisible;

    const activeMode = getActivePdfCodingMode();
    regionBtn.classList.toggle('active', activeMode === 'region');
    regionBtn.setAttribute('aria-pressed', activeMode === 'region' ? 'true' : 'false');
    const regionTitle = !currentPdfState.textSelectionEnabled
        ? 'No selectable text is available on this PDF page. Region mode only.'
        : (activeMode === 'region'
            ? 'Switch back to text selection mode'
            : 'Switch to region coding mode');
    regionBtn.title = regionTitle;
    regionBtn.setAttribute('aria-label', regionTitle);
}

function setPdfCodingMode(mode) {
    const normalizedMode = mode === 'text' ? 'text' : 'region';
    currentPdfState.codingMode = normalizedMode;
    if (normalizedMode === 'text') {
        clearPendingPdfRegionSelection();
    } else {
        clearPdfTextSelectionState();
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
        postPdfViewerCommand('clearTextSelection').catch(() => {});
    }
    updatePdfCodingModeControls();
    updatePdfInteractionMode();
}

function togglePdfCodingMode() {
    const activeMode = getActivePdfCodingMode();
    if (activeMode === 'region') {
        if (!currentPdfState.textSelectionEnabled) {
            updatePdfCodingModeControls();
            return;
        }
        setPdfCodingMode('text');
        return;
    }

    setPdfCodingMode('region');
}

function updatePdfInteractionMode() {
    const activeMode = getActivePdfCodingMode();
    postPdfViewerCommand('setMode', { mode: activeMode }).catch(() => {});
    updatePdfCodingModeControls();
}

function clearActivePdfTextSelection() {
    clearPdfTextSelectionState();
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    postPdfViewerCommand('clearTextSelection').catch(() => {});
}

function schedulePdfTextSelectionSync(doc) {
    if (!doc) return;
    const run = () => {
        pdfSelectionSyncFrame = null;
        if (!isPdfDocumentActive()) return;
        if (!doc || appData.currentDocId !== doc.id) return;
        handlePdfTextSelection(doc);
    };

    if (pdfSelectionSyncFrame !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pdfSelectionSyncFrame);
        else clearTimeout(pdfSelectionSyncFrame);
        pdfSelectionSyncFrame = null;
    }

    if (typeof requestAnimationFrame === 'function') {
        pdfSelectionSyncFrame = requestAnimationFrame(run);
    } else {
        pdfSelectionSyncFrame = setTimeout(run, 0);
    }
}

function installPdfInteractionBindings() {
    if (pdfInteractionBindingsInstalled || typeof document === 'undefined') return;

    document.addEventListener('selectionchange', () => {
        if (!isPdfDocumentActive()) return;
        const doc = appData.documents.find((item) => item && item.id === appData.currentDocId);
        if (!doc || doc.type !== 'pdf') return;

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || selection.isCollapsed) return;

        const textLayer = document.getElementById('pdfTextLayer');
        if (!textLayer || !selectionBelongsToPdfTextLayer(selection, textLayer)) return;
        schedulePdfTextSelectionSync(doc);
    });

    pdfInteractionBindingsInstalled = true;
}

function getPdfViewerFrame() {
    if (currentPdfState.viewerFrame && document.body.contains(currentPdfState.viewerFrame)) {
        return currentPdfState.viewerFrame;
    }
    const frame = document.getElementById('pdfViewerFrame');
    if (frame) currentPdfState.viewerFrame = frame;
    return frame || null;
}

function getPdfViewerTargetOrigin(frame = getPdfViewerFrame()) {
    if (!frame) return '*';
    try {
        const frameUrl = new URL(String(frame.getAttribute('src') || ''), window.location.href);
        if (frameUrl.protocol === 'file:') return '*';
        return frameUrl.origin || '*';
    } catch (_) {
        return '*';
    }
}

function isPdfViewerMessagePayload(data) {
    return !!(
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        data.namespace === PDF_VIEWER_MESSAGE_NAMESPACE &&
        (data.kind === 'event' || data.kind === 'response')
    );
}

function clearPdfViewerPendingRequests(errorMessage = 'PDF viewer request cancelled.') {
    const pending = Array.from(pdfViewerPendingRequests.values());
    pdfViewerPendingRequests.clear();
    pending.forEach((entry) => {
        if (entry.timeoutId) clearTimeout(entry.timeoutId);
        try {
            entry.reject(new Error(errorMessage));
        } catch (_) {}
    });
}

function installPdfViewerMessageBindings() {
    if (pdfViewerMessageBindingsInstalled || typeof window === 'undefined') return;
    window.addEventListener('message', (event) => {
        const frame = getPdfViewerFrame();
        if (!frame || event.source !== frame.contentWindow) return;
        if (!isPdfViewerMessagePayload(event.data)) return;

        const message = event.data;
        if (message.kind === 'response') {
            const requestId = String(message.requestId || '');
            if (!requestId || !pdfViewerPendingRequests.has(requestId)) return;
            const pending = pdfViewerPendingRequests.get(requestId);
            pdfViewerPendingRequests.delete(requestId);
            if (pending.timeoutId) clearTimeout(pending.timeoutId);
            if (!message.ok) {
                pending.reject(new Error(String(message.error || 'PDF viewer command failed.')));
                return;
            }
            pending.resolve(message.result || {});
            return;
        }

        const payload = (message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload))
            ? Object.assign({}, message.payload)
            : {};
        payload.type = String(message.type || '');
        if (message.sessionId !== undefined) payload.sessionId = message.sessionId;
        if (payload.type === 'ready') {
            currentPdfState.viewerReady = true;
            if (typeof currentPdfState.viewerReadyResolve === 'function') {
                currentPdfState.viewerReadyResolve();
                currentPdfState.viewerReadyResolve = null;
                currentPdfState.viewerReadyReject = null;
            }
            return;
        }
        handlePdfViewerHostEvent(payload);
    });
    pdfViewerMessageBindingsInstalled = true;
}

function postPdfViewerCommand(command, payload = {}, options = {}) {
    const frame = getPdfViewerFrame();
    const targetWindow = frame?.contentWindow;
    if (!frame || !targetWindow) {
        return Promise.reject(new Error('PDF viewer host is not available.'));
    }

    const requestId = `pdf-host-${++pdfViewerRequestCounter}`;
    const sessionId = Object.prototype.hasOwnProperty.call(options, 'sessionId')
        ? options.sessionId
        : currentPdfState.renderToken;
    const targetOrigin = getPdfViewerTargetOrigin(frame);

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pdfViewerPendingRequests.delete(requestId);
            reject(new Error(`Timed out waiting for PDF viewer command: ${command}`));
        }, 4000);
        pdfViewerPendingRequests.set(requestId, { resolve, reject, sessionId, timeoutId });
        try {
            targetWindow.postMessage({
                namespace: PDF_VIEWER_MESSAGE_NAMESPACE,
                kind: 'request',
                requestId,
                command: String(command || ''),
                sessionId,
                payload: (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {}
            }, targetOrigin);
        } catch (error) {
            pdfViewerPendingRequests.delete(requestId);
            clearTimeout(timeoutId);
            reject(error);
        }
    });
}

async function waitForPdfViewerHost(expectedToken = currentPdfState.renderToken) {
    const readyPromise = currentPdfState.viewerReadyPromise;
    if (!readyPromise) return false;

    try {
        await readyPromise;
    } catch (_) {
        return false;
    }

    if (expectedToken !== currentPdfState.renderToken) return false;
    return !!getPdfViewerFrame()?.contentWindow;
}

function getCurrentPdfDoc() {
    if (!isPdfDocumentActive()) return null;
    return appData.documents.find((doc) => doc && doc.id === currentPdfState.docId) || null;
}

function getPdfPageInfo(doc, pageNum) {
    if (!doc || !Array.isArray(doc.pdfPages)) return null;
    return doc.pdfPages.find((page) => (Number.parseInt(page?.pageNum, 10) || 1) === pageNum) || null;
}

function buildPdfViewerSegmentsForPage(doc, pageNum) {
    if (!doc) return [];

    const pageModel = getPdfSelectionPageModel(doc, pageNum);
    const codeById = new Map((Array.isArray(appData?.codes) ? appData.codes : []).map((code) => [code.id, code]));

    return getSegmentsForDoc(doc.id).flatMap((segment) => {
        if (!segment) return [];

        const decorationStyle = buildPdfSegmentDecorationStyle(segment, codeById);
        if (segment.pdfRegion && Number(segment.pdfRegion.pageNum) === pageNum) {
            return [{
                kind: 'region',
                segmentId: segment.id,
                region: Object.assign({}, segment.pdfRegion),
                color: decorationStyle.color,
                title: decorationStyle.title || `PDF region (page ${pageNum})`
            }];
        }

        if (!pageModel) return [];

        const startIndex = Number(segment.startIndex);
        const endIndex = Number(segment.endIndex);
        if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex) || endIndex <= startIndex) return [];
        if (endIndex <= pageModel.start || startIndex >= pageModel.end) return [];

        const rects = buildPdfTextHighlightRectsForRange(pageModel, startIndex, endIndex);
        if (rects.length === 0) return [];

        return [{
            kind: 'text',
            segmentId: segment.id,
            rects,
            fillColor: decorationStyle.fillColor,
            underlineColor: decorationStyle.underlineColor,
            title: decorationStyle.title
        }];
    });
}

function updatePdfTextSelectionAvailability(doc, pageNum) {
    currentPdfState.textSelectionEnabled = !!(getPdfSelectionPageModel(doc, pageNum)?.chars?.length);
    updatePdfCodingModeControls();
}

async function syncPdfViewerDecorations(doc, pageNum, options = {}) {
    const ready = await waitForPdfViewerHost(options.expectedToken);
    if (!ready || !doc || currentPdfState.docId !== doc.id) return;

    const activeMode = getActivePdfCodingMode();
    const flashSegmentId = options.flashSegmentId || null;
    const sessionId = Object.prototype.hasOwnProperty.call(options, 'expectedToken')
        ? options.expectedToken
        : currentPdfState.renderToken;

    try {
        await postPdfViewerCommand('setMode', {
            mode: activeMode
        }, { sessionId });
        await postPdfViewerCommand('setPageDecorations', {
            segments: buildPdfViewerSegmentsForPage(doc, pageNum),
            pendingRegion: currentPdfState.pendingRegion && Number(currentPdfState.pendingRegion.pageNum) === pageNum
                ? Object.assign({}, currentPdfState.pendingRegion)
                : null,
            pageInfo: getPdfPageInfo(doc, pageNum),
            flashSegmentId
        }, { sessionId });

        if (options.focusRegion) {
            await postPdfViewerCommand('focusRegion', {
                region: options.focusRegion,
                segmentId: flashSegmentId
            }, { sessionId });
        }
    } catch (error) {
        console.warn('Failed to sync PDF viewer decorations', error);
    }
}

function translatePdfViewerClientPoint(clientX, clientY) {
    const frameRect = getPdfViewerFrame()?.getBoundingClientRect();
    if (!frameRect) {
        return {
            clientX: Number(clientX) || 0,
            clientY: Number(clientY) || 0
        };
    }

    return {
        clientX: frameRect.left + (Number(clientX) || 0),
        clientY: frameRect.top + (Number(clientY) || 0)
    };
}

function showPdfViewerBackgroundContextMenu(doc, payload) {
}

function showPdfViewerTextContextMenu(segmentId, payload) {
    if (!segmentId || typeof showSegmentContextMenu !== 'function') return;
    const point = translatePdfViewerClientPoint(payload?.clientX, payload?.clientY);
    showSegmentContextMenu(String(segmentId), {
        preventDefault() {},
        stopPropagation() {},
        clientX: point.clientX,
        clientY: point.clientY,
        target: null,
        currentTarget: null
    });
}

function showPdfViewerRegionContextMenu(segmentId, payload) {
    if (!segmentId || typeof showSegmentContextMenu !== 'function') return;
    const point = translatePdfViewerClientPoint(payload?.clientX, payload?.clientY);
    showSegmentContextMenu(String(segmentId), {
        preventDefault() {},
        stopPropagation() {},
        clientX: point.clientX,
        clientY: point.clientY,
        target: null,
        currentTarget: null
    });
}

function handlePdfTextSelectionPayload(doc, payload) {
    if (!doc || !payload) return;
    if (getActivePdfCodingMode() !== 'text') return;

    const directStartIndex = Number(payload.startIndex);
    const directEndIndex = Number(payload.endIndex);
    const reason = String(payload.reason || '').trim();
    const text = String(payload.text || '').trim();
    const pageNum = Math.max(1, Number.parseInt(payload.pageNumber, 10) || currentPdfState.currentPage || 1);
    const rects = Array.isArray(payload.rects) ? payload.rects.map(normalizePdfSelectionRect).filter(Boolean) : [];
    const pageModel = getPdfSelectionPageModel(doc, pageNum);

    if (!text || rects.length === 0) {
        if (Number.isFinite(directStartIndex) && Number.isFinite(directEndIndex) && directEndIndex > directStartIndex) {
            clearPendingPdfRegionSelection();
            appData.selectedText = {
                text: typeof doc.content === 'string' ? doc.content.slice(directStartIndex, directEndIndex) : '',
                startIndex: directStartIndex,
                endIndex: directEndIndex
            };
            setPdfSelectionStatus(PDF_TEXT_SELECTION_READY_TEXT, 'selected');
            return;
        }
        if (reason === 'explicit-clear' || reason === 'pagechange' || reason === 'mode-change') {
            clearPdfTextSelectionState();
        }
        return;
    }

    if (!pageModel) {
        clearPdfTextSelectionState();
        return;
    }

    const geometrySelection = getPdfSelectionRangeFromNormalizedRects(pageModel, rects, doc);
    const refinedGeometrySelection = geometrySelection
        ? (refinePdfSelectionRangeWithSelectedText(doc, geometrySelection.startIndex, geometrySelection.endIndex, text) || geometrySelection)
        : null;
    if (
        refinedGeometrySelection &&
        refinedGeometrySelection.endIndex > refinedGeometrySelection.startIndex &&
        isMappedPdfSelectionConsistent(doc, refinedGeometrySelection.startIndex, refinedGeometrySelection.endIndex, text)
    ) {
        clearPendingPdfRegionSelection();
        appData.selectedText = {
            text: refinedGeometrySelection.text,
            startIndex: refinedGeometrySelection.startIndex,
            endIndex: refinedGeometrySelection.endIndex
        };
        setPdfSelectionStatus(PDF_TEXT_SELECTION_READY_TEXT, 'selected');
        return;
    }
    clearPdfTextSelectionState();
}

function handlePdfViewerHostEvent(payload) {
    if (!payload || !isPdfDocumentActive()) return;
    if (payload.sessionId !== undefined && Number(payload.sessionId) !== currentPdfState.renderToken) return;
    if (payload.docId && payload.docId !== currentPdfState.docId) return;

    const doc = getCurrentPdfDoc();
    if (!doc || doc.type !== 'pdf') return;

    switch (payload.type) {
        case 'documentloaded':
            currentPdfState.totalPages = Math.max(1, Number.parseInt(payload.totalPages, 10) || currentPdfState.totalPages || 1);
            currentPdfState.currentPage = Math.max(1, Number.parseInt(payload.pageNumber, 10) || currentPdfState.currentPage || 1);
            updatePdfTextSelectionAvailability(doc, currentPdfState.currentPage);
            updatePdfToolbarState();
            syncPdfViewerDecorations(doc, currentPdfState.currentPage).catch(() => {});
            break;
        case 'pagechanging':
            currentPdfState.currentPage = Math.max(1, Number.parseInt(payload.pageNumber, 10) || currentPdfState.currentPage || 1);
            updatePdfTextSelectionAvailability(doc, currentPdfState.currentPage);
            updatePdfToolbarState();
            syncPdfViewerDecorations(doc, currentPdfState.currentPage).catch(() => {});
            break;
        case 'scalechanging':
            if (Number.isFinite(Number(payload.scale))) {
                currentPdfState.scale = Math.max(0.5, Math.min(3, Number(payload.scale)));
                updatePdfToolbarState();
            }
            break;
        case 'textselectionchange':
            handlePdfTextSelectionPayload(doc, payload);
            break;
        case 'regionselected':
            if (payload.empty || !payload.region) {
                clearPendingPdfRegionSelection();
                return;
            }
            currentPdfState.pendingRegion = Object.assign({}, payload.region, {
                pageNum: Math.max(1, Number.parseInt(payload.pageNumber, 10) || currentPdfState.currentPage || 1)
            });
            clearPdfTextSelectionState({ keepStatus: true });
            appData.selectedText = {
                kind: 'pdfRegion',
                text: `[PDF region: page ${currentPdfState.pendingRegion.pageNum}]`,
                pdfRegion: Object.assign({}, currentPdfState.pendingRegion)
            };
            setPdfSelectionStatus(PDF_REGION_SELECTION_READY_TEXT, 'selected');
            syncPdfViewerDecorations(doc, currentPdfState.pendingRegion.pageNum).catch(() => {});
            break;
        case 'backgroundcontextmenu':
            showPdfViewerBackgroundContextMenu(doc, payload);
            break;
        case 'textsegmentcontextmenu':
            showPdfViewerTextContextMenu(payload.segmentId, payload);
            break;
        case 'regioncontextmenu':
            showPdfViewerRegionContextMenu(payload.segmentId, payload);
            break;
        case 'codingshortcut': {
            const shortcutKey = String(payload.key || '');
            const hasStoredPdfTextSelection = !!(
                appData.selectedText &&
                appData.selectedText.kind !== 'pdfRegion' &&
                Number.isFinite(Number(appData.selectedText.startIndex)) &&
                Number.isFinite(Number(appData.selectedText.endIndex)) &&
                Number(appData.selectedText.endIndex) > Number(appData.selectedText.startIndex)
            );
            const hasPdfRegionSelection = !!(
                appData.selectedText &&
                appData.selectedText.kind === 'pdfRegion' &&
                appData.selectedText.pdfRegion
            );
            if ((hasStoredPdfTextSelection || hasPdfRegionSelection) && shortcutKey >= '1' && shortcutKey <= '9') {
                const code = appData.codes.find((item) => item.shortcut === shortcutKey);
                if (code && typeof quickApplyCode === 'function') {
                    quickApplyCode(code.id);
                }
            }
            break;
        }
        case 'documenterror':
            setPdfSelectionStatus(payload.message || 'Unable to display this PDF.', 'warning', 2600);
            break;
        default:
            break;
    }
}

function buildPageCharRangesFromStoredOffsets(doc) {
    if (!doc || !Array.isArray(doc.pdfPages) || doc.pdfPages.length === 0) return null;
    const ranges = [];
    for (const pageInfo of doc.pdfPages) {
        if (!pageInfo || !Array.isArray(pageInfo.textItems) || pageInfo.textItems.length === 0) continue;
        let start = Infinity;
        let end = -Infinity;
        for (const item of pageInfo.textItems) {
            const s = Number(item?.start);
            const e = Number(item?.end);
            if (Number.isFinite(s) && s < start) start = s;
            if (Number.isFinite(e) && e > end) end = e;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        const pageNum = Number.parseInt(pageInfo.pageNum, 10) || 1;
        ranges.push({ pageNum, start, end: Math.max(start, end) });
    }
    if (ranges.length === 0) return null;
    ranges.sort((a, b) => a.pageNum - b.pageNum);
    return ranges;
}

function buildPageCharRangesFromLegacyItems(doc) {
    if (!doc || !Array.isArray(doc.pdfPages) || doc.pdfPages.length === 0) return null;
    const ranges = [];
    let cursor = 0;
    for (const pageInfo of doc.pdfPages) {
        const pageNum = Number.parseInt(pageInfo?.pageNum, 10) || 1;
        const start = cursor;
        let pageLength = 0;
        if (Array.isArray(pageInfo?.textItems)) {
            for (const item of pageInfo.textItems) {
                pageLength += String(item?.text || '').length;
            }
        }
        cursor += pageLength;
        ranges.push({ pageNum, start, end: Math.max(start, cursor) });
        cursor += 2; // '\n\n' page break marker
    }
    return ranges;
}

async function buildPageCharRangesFromLivePdf(doc) {
    if (!doc || !currentPdfState.pdfDoc || currentPdfState.docId !== doc.id) return null;
    const pdfDoc = currentPdfState.pdfDoc;
    const ranges = [];
    let cursor = 0;

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const items = Array.isArray(textContent?.items) ? textContent.items : [];
        const start = cursor;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const text = String(item?.str || '');
            if (text) cursor += text.length;

            if (item?.hasEOL) {
                cursor += 1;
            } else if (i < items.length - 1) {
                const nextItem = items[i + 1];
                const nextText = String(nextItem?.str || '');
                if (text && nextText && !text.endsWith(' ') && !nextText.startsWith(' ')) {
                    const itemX = Number(item?.transform?.[4]) || 0;
                    const itemW = Number(item?.width) || 0;
                    const nextX = Number(nextItem?.transform?.[4]) || 0;
                    const gap = nextX - (itemX + itemW);
                    if (gap > 2) cursor += 1;
                }
            }
        }

        ranges.push({ pageNum, start, end: Math.max(start, cursor) });
        if (pageNum < pdfDoc.numPages) cursor += 2;
    }

    return ranges;
}

async function buildPageCharRangesFromBinaryPdf(doc) {
    if (!doc || !doc.pdfData) return null;
    if (!(await isPdfSupported())) return null;

    const arrayBuffer = base64ToArrayBuffer(doc.pdfData);
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice() });
    let tempPdfDoc = null;
    const ranges = [];
    let cursor = 0;

    try {
        tempPdfDoc = await loadingTask.promise;
        for (let pageNum = 1; pageNum <= tempPdfDoc.numPages; pageNum++) {
            const page = await tempPdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();
            const items = Array.isArray(textContent?.items) ? textContent.items : [];
            const start = cursor;

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const text = String(item?.str || '');
                if (text) cursor += text.length;

                if (item?.hasEOL) {
                    cursor += 1;
                } else if (i < items.length - 1) {
                    const nextItem = items[i + 1];
                    const nextText = String(nextItem?.str || '');
                    if (text && nextText && !text.endsWith(' ') && !nextText.startsWith(' ')) {
                        const itemX = Number(item?.transform?.[4]) || 0;
                        const itemW = Number(item?.width) || 0;
                        const nextX = Number(nextItem?.transform?.[4]) || 0;
                        const gap = nextX - (itemX + itemW);
                        if (gap > 2) cursor += 1;
                    }
                }
            }

            ranges.push({ pageNum, start, end: Math.max(start, cursor) });
            if (pageNum < tempPdfDoc.numPages) cursor += 2;
        }
        return ranges;
    } catch (_) {
        return null;
    } finally {
        try { if (loadingTask && typeof loadingTask.destroy === 'function') loadingTask.destroy(); } catch (_) {}
        try { if (tempPdfDoc) await tempPdfDoc.destroy(); } catch (_) {}
    }
}

function invalidatePdfDerivedCaches(doc) {
    if (!doc || typeof doc !== 'object') return;
    delete doc._pdfSelectionModels;
    delete doc._pdfSelectionModelsContentLength;
    delete doc._pdfPageCharRanges;
    delete doc._pdfPageCharRangesContentLength;
    delete doc._pdfPageCharRangesMode;
}

async function ensurePdfPageData(doc, pdfDoc) {
    if (!doc || !pdfDoc) return false;
    if (Array.isArray(doc.pdfPages) && doc.pdfPages.length === pdfDoc.numPages) {
        return true;
    }

    const pages = [];
    let extractedText = '';
    let hasAnyText = false;

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });
        const pageTextItems = [];
        const items = Array.isArray(textContent?.items) ? textContent.items : [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const text = String(item?.str || '');
            if (text) {
                hasAnyText = true;
                pageTextItems.push({
                    text,
                    transform: item.transform,
                    width: item.width,
                    height: item.height
                });
                extractedText += text;
            }

            if (item?.hasEOL) {
                extractedText += '\n';
            } else if (i < items.length - 1) {
                const nextItem = items[i + 1];
                const nextText = String(nextItem?.str || '');
                if (text && nextText && !text.endsWith(' ') && !nextText.startsWith(' ')) {
                    const gap = nextItem.transform
                        ? nextItem.transform[4] - ((item.transform?.[4] || 0) + (item.width || 0))
                        : 0;
                    if (gap > 2) {
                        extractedText += ' ';
                    }
                }
            }
        }

        pages.push({
            pageNum,
            width: viewport.width,
            height: viewport.height,
            textItems: pageTextItems
        });

        if (pageNum < pdfDoc.numPages) {
            extractedText += '\n\n';
        }
    }

    doc.pdfPages = pages;
    if (!String(doc.content || '').trim() && hasAnyText) {
        doc.content = extractedText;
    }
    invalidatePdfDerivedCaches(doc);
    return true;
}

function resolvePdfPageNumForCharPos(ranges, charPos, fallbackPage = 1) {
    if (!Array.isArray(ranges) || ranges.length === 0) return fallbackPage;
    const target = Math.max(0, Number.parseInt(charPos, 10) || 0);
    let selected = ranges[0];

    for (const range of ranges) {
        if (!range) continue;
        if (target < range.start) break;
        selected = range;
        if (target <= range.end) break;
    }

    return Number.parseInt(selected?.pageNum, 10) || fallbackPage;
}

async function ensurePdfPageCharRanges(doc, options = {}) {
    if (!doc) return null;
    const allowLive = options.allowLive !== false;
    const allowBinaryLoad = !!options.allowBinaryLoad;
    const contentLength = String(doc.content || '').length;
    const cacheMode = (allowLive ? 'live' : 'no-live') + (allowBinaryLoad ? '+bin' : '');
    if (
        Array.isArray(doc._pdfPageCharRanges) &&
        doc._pdfPageCharRanges.length > 0 &&
        doc._pdfPageCharRangesContentLength === contentLength &&
        doc._pdfPageCharRangesMode === cacheMode
    ) {
        return doc._pdfPageCharRanges;
    }

    let ranges = buildPageCharRangesFromStoredOffsets(doc);
    if (!ranges && allowLive) {
        ranges = await buildPageCharRangesFromLivePdf(doc);
    }
    if (!ranges && allowBinaryLoad) {
        ranges = await buildPageCharRangesFromBinaryPdf(doc);
    }
    if (!ranges) {
        ranges = buildPageCharRangesFromLegacyItems(doc);
    }
    if (!ranges) return null;

    doc._pdfPageCharRanges = ranges;
    doc._pdfPageCharRangesContentLength = contentLength;
    doc._pdfPageCharRangesMode = cacheMode;
    return ranges;
}

async function pdfResolvePageForCharPos(doc, charPos, options = {}) {
    if (!doc) return 1;
    const normalizedPos = Math.max(0, Number.parseInt(charPos, 10) || 0);
    const ranges = await ensurePdfPageCharRanges(doc, options);
    if (!ranges || ranges.length === 0) return 1;
    const fallbackPage = Array.isArray(doc.pdfPages) && doc.pdfPages.length > 0
        ? (Number.parseInt(doc.pdfPages[doc.pdfPages.length - 1]?.pageNum, 10) || 1)
        : 1;
    return resolvePdfPageNumForCharPos(ranges, normalizedPos, fallbackPage);
}

function isLikelyImageOnlyPdf(doc, totalPages) {
    if (!doc || !Array.isArray(doc.pdfPages) || doc.pdfPages.length !== totalPages) return false;
    return doc.pdfPages.every(p => !p.textItems || p.textItems.length === 0);
}

function normaliseOcrWords(words, imageWidth, imageHeight) {
    const safeW = Math.max(1, imageWidth || 1);
    const safeH = Math.max(1, imageHeight || 1);
    return (Array.isArray(words) ? words : [])
        .filter(w => w && w.text)
        .map(w => ({
            text: String(w.text),
            xNorm: Math.max(0, Number(w.left || 0) / safeW),
            yNorm: Math.max(0, Number(w.top || 0) / safeH),
            wNorm: Math.max(0, Number(w.width || 0) / safeW),
            hNorm: Math.max(0, Number(w.height || 0) / safeH),
            lineNum: Number.isFinite(w.lineNum) ? w.lineNum : 0
        }));
}

function buildDocumentTextFromOcrPages(ocrPages) {
    const pages = [];
    let fullText = '';

    for (const srcPage of ocrPages) {
        const page = {
            pageNum: srcPage.pageNum,
            width: srcPage.width,
            height: srcPage.height,
            ocr: true,
            textItems: []
        };

        let lastLine = null;
        const words = Array.isArray(srcPage.words) ? srcPage.words : [];
        for (const word of words) {
            const txt = String(word.text || '').trim();
            if (!txt) continue;

            if (page.textItems.length > 0) {
                if (word.lineNum && lastLine !== null && word.lineNum !== lastLine) {
                    fullText += '\n';
                } else {
                    fullText += ' ';
                }
            }

            const start = fullText.length;
            fullText += txt;
            const end = fullText.length;
            lastLine = word.lineNum || lastLine;

            page.textItems.push({
                text: txt,
                start,
                end,
                xNorm: word.xNorm,
                yNorm: word.yNorm,
                wNorm: word.wNorm,
                hNorm: word.hNorm
            });
        }

        pages.push(page);
        if (srcPage.pageNum < ocrPages.length) fullText += '\n\n';
    }

    return { pages, fullText };
}

function roundRegion(value) {
    return Math.round(value * 10000) / 10000;
}

function regionsEqual(a, b, tolerance = 0.0015) {
    if (!a || !b) return false;
    if (a.pageNum !== b.pageNum) return false;
    return Math.abs((a.xNorm || 0) - (b.xNorm || 0)) <= tolerance &&
        Math.abs((a.yNorm || 0) - (b.yNorm || 0)) <= tolerance &&
        Math.abs((a.wNorm || 0) - (b.wNorm || 0)) <= tolerance &&
        Math.abs((a.hNorm || 0) - (b.hNorm || 0)) <= tolerance;
}

function clearPendingPdfRegionSelection() {
    currentPdfState.pendingRegion = null;
    if (appData.selectedText && appData.selectedText.kind === 'pdfRegion') {
        appData.selectedText = null;
    }
    if (pdfSelectionStatusTimer) {
        clearTimeout(pdfSelectionStatusTimer);
        pdfSelectionStatusTimer = null;
    }
    const status = document.getElementById('pdfSelectionStatus');
    if (status) {
        status.hidden = true;
        status.classList.remove('warning');
        status.textContent = PDF_SELECTION_READY_TEXT;
    }
    const pending = document.querySelector('.pdf-region-selection-box');
    if (pending && pending.parentElement) pending.parentElement.removeChild(pending);

    const doc = getCurrentPdfDoc();
    if (doc) {
        syncPdfViewerDecorations(doc, currentPdfState.currentPage).catch(() => {});
    }
}

function getCurrentThumbManifestKey() {
    const projectId = String(appData?.projectName || 'untitled-project').trim().toLowerCase();
    return PDF_THUMB_MANIFEST_PREFIX + projectId;
}

function ensureThumbManifestLoaded() {
    try {
        const key = getCurrentThumbManifestKey();
        if (pdfThumbManifestLoaded && pdfThumbManifestKey === key) return;
        pdfThumbManifestLoaded = true;
        pdfThumbManifestKey = key;
        pdfThumbManifestMap = new Map();
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        Object.keys(parsed).forEach((k) => {
            const ts = Number(parsed[k]);
            if (Number.isFinite(ts)) pdfThumbManifestMap.set(k, ts);
        });
    } catch (_) {
        pdfThumbManifestMap = new Map();
    }
}

function scheduleThumbManifestSave() {
    if (pdfThumbManifestSaveTimer) clearTimeout(pdfThumbManifestSaveTimer);
    pdfThumbManifestSaveTimer = setTimeout(() => {
        pdfThumbManifestSaveTimer = null;
        try {
            ensureThumbManifestLoaded();
            if (!pdfThumbManifestKey) return;
            const out = {};
            Array.from(pdfThumbManifestMap.entries()).forEach(([k, ts]) => {
                out[k] = ts;
            });
            localStorage.setItem(pdfThumbManifestKey, JSON.stringify(out));
        } catch (_) {}
    }, 700);
}

function markThumbInManifest(key) {
    ensureThumbManifestLoaded();
    if (!key) return;
    pdfThumbManifestMap.set(key, Date.now());
    if (pdfThumbManifestMap.size > PDF_THUMB_MANIFEST_LIMIT) {
        const sorted = Array.from(pdfThumbManifestMap.entries()).sort((a, b) => b[1] - a[1]);
        pdfThumbManifestMap = new Map(sorted.slice(0, PDF_THUMB_MANIFEST_LIMIT));
    }
    scheduleThumbManifestSave();
}

function buildPdfRegionThumbKey(doc, region, width = 260) {
    return [
        doc.id,
        region.pageNum,
        roundRegion(region.xNorm || 0),
        roundRegion(region.yNorm || 0),
        roundRegion(region.wNorm || 0),
        roundRegion(region.hNorm || 0),
        width
    ].join(':');
}

async function generatePdfRegionThumbnail(doc, region, width, key) {
    const arrayBuffer = base64ToArrayBuffer(doc.pdfData);
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice() });
    let pdfDoc = null;
    try {
        pdfDoc = await loadingTask.promise;
        const page = await pdfDoc.getPage(region.pageNum);
        const viewport = page.getViewport({ scale: 1.0 });

        const renderCanvas = document.createElement('canvas');
        renderCanvas.width = Math.ceil(viewport.width);
        renderCanvas.height = Math.ceil(viewport.height);
        const renderCtx = renderCanvas.getContext('2d');
        await page.render({ canvasContext: renderCtx, viewport }).promise;

        const sx = Math.max(0, Math.floor((region.xNorm || 0) * renderCanvas.width));
        const sy = Math.max(0, Math.floor((region.yNorm || 0) * renderCanvas.height));
        const sw = Math.max(8, Math.floor((region.wNorm || 0) * renderCanvas.width));
        const sh = Math.max(8, Math.floor((region.hNorm || 0) * renderCanvas.height));

        const padX = Math.floor(sw * 0.18);
        const padY = Math.floor(sh * 0.22);
        const csx = Math.max(0, sx - padX);
        const csy = Math.max(0, sy - padY);
        const csw = Math.min(renderCanvas.width - csx, sw + padX * 2);
        const csh = Math.min(renderCanvas.height - csy, sh + padY * 2);

        const outW = width;
        const scale = outW / Math.max(1, csw);
        const outH = Math.max(40, Math.round(csh * scale));
        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const outCtx = outCanvas.getContext('2d');
        outCtx.fillStyle = '#ffffff';
        outCtx.fillRect(0, 0, outW, outH);
        outCtx.drawImage(renderCanvas, csx, csy, csw, csh, 0, 0, outW, outH);

        const hx = Math.round((sx - csx) * scale);
        const hy = Math.round((sy - csy) * scale);
        const hw = Math.max(2, Math.round(sw * scale));
        const hh = Math.max(2, Math.round(sh * scale));
        outCtx.strokeStyle = '#c17a5c';
        outCtx.lineWidth = 2;
        outCtx.strokeRect(hx, hy, hw, hh);
        outCtx.fillStyle = 'rgba(193, 122, 92, 0.14)';
        outCtx.fillRect(hx, hy, hw, hh);

        const dataUrl = outCanvas.toDataURL('image/png');
        pdfRegionPreviewCache.set(key, dataUrl);
        markThumbInManifest(key);
        if (pdfRegionPreviewCache.size > 260) {
            const firstKey = pdfRegionPreviewCache.keys().next().value;
            if (firstKey) pdfRegionPreviewCache.delete(firstKey);
        }
        return dataUrl;
    } catch (err) {
        console.warn('Failed to build PDF region thumbnail', err);
        return null;
    } finally {
        try {
            if (loadingTask && typeof loadingTask.destroy === 'function') loadingTask.destroy();
        } catch (_) {}
        try {
            if (pdfDoc) await pdfDoc.destroy();
        } catch (_) {}
    }
}

function pumpPdfRegionPreviewQueue() {
    if (pdfRegionPreviewWorkers >= PDF_THUMB_QUEUE_CONCURRENCY) return;
    while (pdfRegionPreviewWorkers < PDF_THUMB_QUEUE_CONCURRENCY && pdfRegionPreviewQueue.length > 0) {
        const task = pdfRegionPreviewQueue.shift();
        if (!task) break;
        pdfRegionPreviewQueued.delete(task.key);
        if (pdfRegionPreviewCache.has(task.key)) {
            task.resolve(pdfRegionPreviewCache.get(task.key));
            continue;
        }
        if (pdfRegionPreviewInflight.has(task.key)) {
            pdfRegionPreviewInflight.get(task.key).then(task.resolve).catch(task.reject);
            continue;
        }

        pdfRegionPreviewWorkers += 1;
        const work = generatePdfRegionThumbnail(task.doc, task.region, task.width, task.key);
        pdfRegionPreviewInflight.set(task.key, work);
        work.then(task.resolve).catch(task.reject).finally(() => {
            pdfRegionPreviewInflight.delete(task.key);
            pdfRegionPreviewWorkers = Math.max(0, pdfRegionPreviewWorkers - 1);
            if (pdfRegionPreviewQueue.length > 0) {
                if (pdfRegionPreviewPumpTimer) clearTimeout(pdfRegionPreviewPumpTimer);
                pdfRegionPreviewPumpTimer = setTimeout(() => {
                    pdfRegionPreviewPumpTimer = null;
                    pumpPdfRegionPreviewQueue();
                }, 0);
            }
        });
    }
}

function queuePdfRegionThumbnail(doc, region, opts = {}) {
    if (!doc || !doc.pdfData || !region || !region.pageNum) return Promise.resolve(null);
    const width = Number.isFinite(opts.width) ? opts.width : 260;
    const priority = Number.isFinite(opts.priority) ? opts.priority : 10;
    const key = buildPdfRegionThumbKey(doc, region, width);
    ensureThumbManifestLoaded();

    if (pdfRegionPreviewCache.has(key)) return Promise.resolve(pdfRegionPreviewCache.get(key));
    if (pdfRegionPreviewInflight.has(key)) return pdfRegionPreviewInflight.get(key);

    return new Promise((resolve, reject) => {
        const existing = pdfRegionPreviewQueued.get(key);
        if (existing) {
            existing.priority = Math.max(existing.priority, priority);
            existing.resolveList.push(resolve);
            existing.rejectList.push(reject);
        } else {
            const queuedTask = {
                key,
                doc,
                region,
                width,
                priority,
                resolveList: [resolve],
                rejectList: [reject]
            };
            pdfRegionPreviewQueued.set(key, queuedTask);
            pdfRegionPreviewQueue.push({
                key,
                doc,
                region,
                width,
                priority,
                resolve: (value) => {
                    const q = pdfRegionPreviewQueued.get(key) || queuedTask;
                    q.resolveList.forEach(fn => fn(value));
                },
                reject: (err) => {
                    const q = pdfRegionPreviewQueued.get(key) || queuedTask;
                    q.rejectList.forEach(fn => fn(err));
                }
            });
            pdfRegionPreviewQueue.sort((a, b) => b.priority - a.priority);
        }
        pumpPdfRegionPreviewQueue();
    });
}

async function getPdfRegionThumbnail(doc, region, opts = {}) {
    if (!doc || !doc.pdfData || !region || !region.pageNum) return null;
    if (!(await isPdfSupported())) return null;

    const width = Number.isFinite(opts.width) ? opts.width : 260;
    const key = buildPdfRegionThumbKey(doc, region, width);

    if (pdfRegionPreviewCache.has(key)) return pdfRegionPreviewCache.get(key);
    if (pdfRegionPreviewInflight.has(key)) return pdfRegionPreviewInflight.get(key);
    return queuePdfRegionThumbnail(doc, region, { width, priority: 120 });
}

async function ensureOcrForImageOnlyPdf(doc, expectedToken, container) {
    if (!window.electronAPI || typeof window.electronAPI.ocrImage !== 'function') {
        return { ok: false, error: 'OCR bridge is unavailable in this build.' };
    }
    if (!currentPdfState.pdfDoc) return { ok: false, error: 'PDF document is not ready for OCR.' };
    if (doc._ocrReady) return { ok: true, error: '' };
    if (currentPdfState.ocrPromise) return currentPdfState.ocrPromise;

    const run = (async () => {
        const pdfDoc = currentPdfState.pdfDoc;
        const total = pdfDoc.numPages;
        const ocrPages = [];
        let bestError = '';
        let wordCount = 0;
        const status = document.createElement('div');
        status.className = 'pdf-error';
        status.id = 'pdfOcrStatus';
        status.textContent = 'Running OCR on scanned PDF (page 1/' + total + ')...';
        if (container) container.appendChild(status);

        try {
            for (let pageNum = 1; pageNum <= total; pageNum++) {
                if (expectedToken !== currentPdfState.renderToken) {
                    return { ok: false, error: 'OCR was cancelled because the document changed.' };
                }
                status.textContent = `Running OCR on scanned PDF (page ${pageNum}/${total})...`;

                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport }).promise;
                const dataUrl = canvas.toDataURL('image/png');

                const ocrResult = await window.electronAPI.ocrImage(dataUrl, { lang: 'swe+eng', psm: 6 });
                if (!ocrResult || !ocrResult.ok) {
                    console.warn('OCR failed for page', pageNum, ocrResult?.error || 'unknown error');
                    if (!bestError) {
                        bestError = ocrResult?.error || 'OCR failed on this machine.';
                    }
                }

                const baseViewport = page.getViewport({ scale: 1.0 });
                const words = normaliseOcrWords(ocrResult?.words || [], canvas.width, canvas.height);
                wordCount += words.length;
                ocrPages.push({
                    pageNum,
                    width: baseViewport.width,
                    height: baseViewport.height,
                    words
                });
            }

            const rebuilt = buildDocumentTextFromOcrPages(ocrPages);
            doc.pdfPages = rebuilt.pages;
            doc.content = rebuilt.fullText;
            doc._ocrReady = wordCount > 0;
            doc._ocrGeneratedAt = new Date().toISOString();
            invalidatePdfDerivedCaches(doc);
            saveData();
            if (wordCount > 0) {
                return { ok: true, error: '' };
            }
            const emptyReason = bestError || 'OCR completed, but no readable text was detected.';
            return { ok: false, error: emptyReason };
        } finally {
            status.remove();
        }
    })();

    currentPdfState.ocrPromise = run;
    try {
        return await run;
    } finally {
        currentPdfState.ocrPromise = null;
    }
}

/**
 * Initialize PDF.js library
 * Called on app startup
 */
async function initPdfJs() {
    // PDF.js 5.x uses globalThis.pdfjsLib
// Wait briefly for module script to populate window/globalThis.pdfjsLib (packaged builds can reorder execution)
if (!globalThis.pdfjsLib && !window.pdfjsLib) {
    const deadline = Date.now() + 2000; // 2s max
    while (Date.now() < deadline && !globalThis.pdfjsLib && !window.pdfjsLib) {
        await new Promise(r => setTimeout(r, 25));
    }
}
    const lib = globalThis.pdfjsLib || window.pdfjsLib;
    if (lib) {
        pdfjsLib = lib;
        // Set worker path
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('js/pdfjs/pdf.worker.mjs', window.location.href).toString();
        return true;
    }
    console.warn('PDF.js not available');
    return false;
}

/**
 * Check if PDF.js is available
 */


/**
 * Ensure PDF.js is initialised before use.
 */
async function ensurePdfJsReady() {
    if (!pdfjsLib) {
        await initPdfJs();
    }
    return !!pdfjsLib;
}

async function isPdfSupported() {
    // Ensure initialisation has been attempted
    if (!pdfjsLib) {
  await initPdfJs();
    }
    return pdfjsLib !== null;
}

/**
 * Import a PDF file and extract its text with positions
 * @param {ArrayBuffer} arrayBuffer - PDF file data
 * @param {string} title - Document title
 * @returns {Promise<object>} - Document object ready for appData
 */
async function importPdf(arrayBuffer, title) {
    if (!(await isPdfSupported())) {
        throw new Error('PDF.js library not loaded. Please ensure pdf.min.js is available.');
    }

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice()});
    const pdfDoc = await loadingTask.promise;
    
    // Extract text from all pages with position information
    const pages = [];
    let fullText = '';
    let textPositions = []; // Array of {pageNum, itemIndex, start, end, transform}
    
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });
        
        const pageTextItems = [];
        
        for (let i = 0; i < textContent.items.length; i++) {
            const item = textContent.items[i];
            if (item.str) {
                const startPos = fullText.length;
                fullText += item.str;
                const endPos = fullText.length;
                
                pageTextItems.push({
                    text: item.str,
                    start: startPos,
                    end: endPos,
                    transform: item.transform,
                    width: item.width,
                    height: item.height,
                    fontName: item.fontName
                });
                
                textPositions.push({
                    pageNum,
                    itemIndex: i,
                    start: startPos,
                    end: endPos,
                    transform: item.transform
                });
            }
            
            // Add space between items if needed (heuristic for word breaks)
            if (item.hasEOL) {
                fullText += '\n';
            } else if (i < textContent.items.length - 1) {
                // Check if next item is on same line and needs a space
                const nextItem = textContent.items[i + 1];
                if (nextItem && nextItem.str && !item.str.endsWith(' ') && !nextItem.str.startsWith(' ')) {
                    // Simple heuristic: add space if items are separate words
                    const gap = nextItem.transform ? 
                        nextItem.transform[4] - (item.transform[4] + item.width) : 0;
                    if (gap > 2) {
                        fullText += ' ';
                    }
                }
            }
        }
        
        pages.push({
            pageNum,
            width: viewport.width,
            height: viewport.height,
            textItems: pageTextItems
        });
        
        // Add page break marker
        if (pageNum < pdfDoc.numPages) {
            fullText += '\n\n';
        }
    }
    
    // Store PDF as base64 for re-rendering
    const pdfBase64 = arrayBufferToBase64(arrayBuffer);
    
    return {
        id: 'doc_' + Date.now(),
        title: title,
        content: fullText, // Plain text for searching and basic display
        type: 'pdf',
        pdfData: pdfBase64, // Original PDF for rendering
        pdfPages: pages, // Page structure with text positions
        pdfTextPositions: textPositions, // For mapping selections back
        metadata: {},
        created: new Date().toISOString(),
        lastAccessed: new Date().toISOString()
    };
}

function removePdfOcrUnavailableNotice(container) {
    const scope = container?.querySelector?.('.pdf-viewer') || container || document;
    const staleNotice = scope?.querySelector?.('#pdfOcrUnavailable') || document.getElementById('pdfOcrUnavailable');
    if (staleNotice) staleNotice.remove();
}

function showPdfOcrUnavailableNotice(container, reason) {
    removePdfOcrUnavailableNotice(container);
    const viewer = container?.querySelector?.('.pdf-viewer');
    if (!viewer) return;
    const ocrNotice = document.createElement('div');
    ocrNotice.className = 'pdf-error';
    ocrNotice.id = 'pdfOcrUnavailable';
    const p1 = document.createElement('p');
    p1.textContent = 'This appears to be a scanned PDF without a text layer.';
    const p2 = document.createElement('p');
    p2.textContent = reason || 'OCR fallback failed on this machine.';
    const helpBtn = document.createElement('button');
    helpBtn.className = 'btn btn-secondary';
    helpBtn.type = 'button';
    helpBtn.style.marginTop = '8px';
    helpBtn.textContent = 'OCR setup help';
    helpBtn.addEventListener('click', () => {
        if (typeof openOcrHelpModal === 'function') openOcrHelpModal();
    });
    ocrNotice.appendChild(p1);
    ocrNotice.appendChild(p2);
    ocrNotice.appendChild(helpBtn);
    viewer.appendChild(ocrNotice);
}

/**
 * Render a PDF document in the content area
 * @param {object} doc - Document object with pdfData
 * @param {HTMLElement} container - Container element for rendering
 */
async function renderPdfDocument(doc, container) {
    if (!(await isPdfSupported())) {
        container.innerHTML = `
            <div class="pdf-error">
                <p>PDF.js library not available.</p>
                <p>Run <code>npm run fetch-pdfjs</code> and restart the app.</p>
            </div>
        `;
        return;
    }
    
    cleanupPdfState();
    installPdfInteractionBindings();
    installPdfViewerMessageBindings();
    const renderToken = currentPdfState.renderToken;
    currentPdfState.docId = doc.id;
    currentPdfState.viewerReady = false;
    currentPdfState.viewerReadyPromise = new Promise((resolve, reject) => {
        currentPdfState.viewerReadyResolve = resolve;
        currentPdfState.viewerReadyReject = reject;
    });

    container.innerHTML = `
        <div class="pdf-viewer">
            <div class="pdf-container pdf-container-host" id="pdfContainer">
                <iframe
                    class="pdf-viewer-frame"
                    id="pdfViewerFrame"
                    title="PDF viewer"
                    src="${PDF_VIEWER_HOST_PATH}"
                    loading="eager"
                    sandbox="allow-scripts allow-same-origin"
                ></iframe>
            </div>
        </div>
    `;
    const pdfContainer = container.querySelector('#pdfContainer');
    const viewerFrame = container.querySelector('#pdfViewerFrame');
    currentPdfState.viewerFrame = viewerFrame;
    currentPdfState.viewerLoadedDocId = null;
    if (viewerFrame) {
        viewerFrame.addEventListener('error', () => {
            if (typeof currentPdfState.viewerReadyReject === 'function') {
                currentPdfState.viewerReadyReject(new Error('PDF viewer host failed to load.'));
                currentPdfState.viewerReadyResolve = null;
                currentPdfState.viewerReadyReject = null;
            }
        }, { once: true });
    } else if (typeof currentPdfState.viewerReadyReject === 'function') {
        currentPdfState.viewerReadyReject(new Error('PDF viewer host not available.'));
        currentPdfState.viewerReadyResolve = null;
        currentPdfState.viewerReadyReject = null;
    }

    if (pdfContainer && typeof showContextMenu === 'function') {
        pdfContainer.oncontextmenu = (event) => {
            if (event.target && event.target.closest('.pdf-coded-region')) return;
            event.preventDefault();
            event.stopPropagation();
        };
    }

    const arrayBuffer = base64ToArrayBuffer(doc.pdfData);
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice() });
    currentPdfState.loadingTask = loadingTask;

    let pdfDoc = null;
    try {
        pdfDoc = await loadingTask.promise;
    } catch (error) {
        if (renderToken !== currentPdfState.renderToken) return;
        throw error;
    }

    if (renderToken !== currentPdfState.renderToken || currentPdfState.docId !== doc.id) {
        try { await pdfDoc.destroy(); } catch (_) {}
        return;
    }

    currentPdfState.loadingTask = null;
    currentPdfState.pdfDoc = pdfDoc;
    currentPdfState.totalPages = pdfDoc.numPages;
    currentPdfState.currentPage = 1;
    updatePdfToolbarState();

    await ensurePdfPageData(doc, pdfDoc);
    if (renderToken !== currentPdfState.renderToken || currentPdfState.docId !== doc.id) return;

    // Choose initial render page. If search/navigation is pending, render that page first
    // to avoid flashing page 1 and then jumping.
    const pendingChar = (
        currentPdfState.pendingGoToCharPos &&
        currentPdfState.pendingGoToCharPos.docId === doc.id &&
        Number.isFinite(Number(currentPdfState.pendingGoToCharPos.charPos))
    ) ? Math.max(0, Number.parseInt(currentPdfState.pendingGoToCharPos.charPos, 10) || 0) : null;
    const pendingCharFlashSegmentId = (
        currentPdfState.pendingGoToCharPos &&
        currentPdfState.pendingGoToCharPos.docId === doc.id &&
        currentPdfState.pendingGoToCharPos.flashSegmentId
    ) ? String(currentPdfState.pendingGoToCharPos.flashSegmentId) : null;
    const pendingPage = (
        currentPdfState.pendingGoToPage &&
        currentPdfState.pendingGoToPage.docId === doc.id &&
        Number.isFinite(Number(currentPdfState.pendingGoToPage.pageNum))
    ) ? Math.max(1, Number.parseInt(currentPdfState.pendingGoToPage.pageNum, 10) || 1) : null;
    const pendingRegion = (
        currentPdfState.pendingGoToRegion &&
        currentPdfState.pendingGoToRegion.docId === doc.id
    ) ? currentPdfState.pendingGoToRegion : null;
    const needsOcr = isLikelyImageOnlyPdf(doc, pdfDoc.numPages);
    const viewerShell = container.querySelector('.pdf-viewer');

    if (needsOcr && pendingChar !== null) {
        const ocrResult = await ensureOcrForImageOnlyPdf(doc, renderToken, viewerShell);
        if ((!ocrResult || !ocrResult.ok) && !doc._ocrReady) {
            showPdfOcrUnavailableNotice(container, (ocrResult && ocrResult.error) ? ocrResult.error : 'OCR fallback failed on this machine.');
        } else {
            removePdfOcrUnavailableNotice(container);
        }
    } else if (needsOcr) {
        Promise.resolve(ensureOcrForImageOnlyPdf(doc, renderToken, viewerShell)).then((ocrResult) => {
            if (renderToken !== currentPdfState.renderToken || currentPdfState.docId !== doc.id) return;
            if ((!ocrResult || !ocrResult.ok) && !doc._ocrReady) {
                showPdfOcrUnavailableNotice(container, (ocrResult && ocrResult.error) ? ocrResult.error : 'OCR fallback failed on this machine.');
                return;
            }
            removePdfOcrUnavailableNotice(container);
            updatePdfTextSelectionAvailability(doc, currentPdfState.currentPage);
            updatePdfToolbarState();
            syncPdfViewerDecorations(doc, currentPdfState.currentPage).catch(() => {});
        }).catch((error) => {
            console.warn('Background OCR failed:', error);
            if (renderToken !== currentPdfState.renderToken || currentPdfState.docId !== doc.id || doc._ocrReady) return;
            showPdfOcrUnavailableNotice(container, error?.message || 'OCR fallback failed on this machine.');
        });
    }

    let initialPageNum = 1;
    let normalizedPendingRegion = null;
    if (pendingPage !== null) {
        initialPageNum = pendingPage;
    } else if (pendingRegion && pendingRegion.region) {
        normalizedPendingRegion = (typeof normalizePdfRegionShape === 'function')
            ? normalizePdfRegionShape(pendingRegion.region)
            : pendingRegion.region;
        initialPageNum = Math.max(1, Number.parseInt(normalizedPendingRegion.pageNum, 10) || 1);
    } else if (pendingChar !== null) {
        initialPageNum = await pdfResolvePageForCharPos(doc, pendingChar, { allowLive: true, allowBinaryLoad: false });
        if (renderToken !== currentPdfState.renderToken || currentPdfState.docId !== doc.id) return;
    }

    const host = await waitForPdfViewerHost(renderToken);
    if (!host) {
        container.innerHTML = `
            <div class="pdf-error">
                <p>PDF viewer host failed to load.</p>
            </div>
        `;
        return;
    }

    await renderPdfPage(initialPageNum, doc, renderToken, {
        reloadHostDocument: true,
        flashSegmentId: pendingCharFlashSegmentId || null
    });
    if (renderToken !== currentPdfState.renderToken || currentPdfState.docId !== doc.id) return;

    if (pendingPage !== null &&
        currentPdfState.pendingGoToPage &&
        currentPdfState.pendingGoToPage.docId === doc.id) {
        currentPdfState.pendingGoToPage = null;
    }

    if (pendingChar !== null &&
        currentPdfState.pendingGoToCharPos &&
        currentPdfState.pendingGoToCharPos.docId === doc.id) {
        currentPdfState.pendingGoToCharPos = null;
    }

    // For region navigation: clear consumed pending and keep highlight behavior.
    if (pendingRegion &&
        currentPdfState.pendingGoToRegion &&
        currentPdfState.pendingGoToRegion.docId === doc.id) {
        currentPdfState.pendingGoToRegion = null;
        const targetPage = Math.max(1, Number.parseInt(normalizedPendingRegion?.pageNum, 10) || 1);
        if (targetPage !== initialPageNum) {
            pdfGoToRegion(doc, normalizedPendingRegion, pendingRegion.segmentId);
        } else {
            syncPdfViewerDecorations(doc, targetPage, {
                expectedToken: renderToken,
                flashSegmentId: pendingRegion.segmentId || null,
                focusRegion: normalizedPendingRegion
            }).catch(() => {});
        }
    }
}

/**
 * Render a specific PDF page
 * @param {number} pageNum - Page number (1-indexed)
 * @param {object} doc - Document object
 */
async function renderPdfPage(pageNum, doc, expectedToken = currentPdfState.renderToken, options = {}) {
    if (!currentPdfState.pdfDoc) return;
    if (expectedToken !== currentPdfState.renderToken) return;

    const ready = await waitForPdfViewerHost(expectedToken);
    if (!ready) return;

    const boundedPage = Math.max(1, Math.min(currentPdfState.totalPages || 1, Number.parseInt(pageNum, 10) || 1));

    if (options.reloadHostDocument === true || currentPdfState.viewerLoadedDocId !== doc.id) {
        await postPdfViewerCommand('loadDocument', {
            docId: doc.id,
            pdfData: doc.pdfData,
            pageNumber: boundedPage,
            scale: currentPdfState.scale,
            mode: getActivePdfCodingMode()
        }, { sessionId: expectedToken });
        currentPdfState.viewerLoadedDocId = doc.id;
    } else {
        await postPdfViewerCommand('setScale', {
            scale: currentPdfState.scale
        }, { sessionId: expectedToken });
        await postPdfViewerCommand('setPageNumber', {
            pageNumber: boundedPage
        }, { sessionId: expectedToken });
        await postPdfViewerCommand('setMode', {
            mode: getActivePdfCodingMode()
        }, { sessionId: expectedToken });
    }

    if (expectedToken !== currentPdfState.renderToken) return;

    currentPdfState.currentPage = boundedPage;
    updatePdfTextSelectionAvailability(doc, boundedPage);
    updatePdfToolbarState();
    await syncPdfViewerDecorations(doc, boundedPage, {
        expectedToken,
        flashSegmentId: options.flashSegmentId || null,
        focusRegion: options.focusRegion || null
    });
}

/**
 * Handle text selection in PDF text layer
 * Maps DOM selection back to document character positions
 */
function handlePdfTextSelection(doc) {
    if (appData.filterCodeId) return;
    if (getActivePdfCodingMode() !== 'text') return;
    
    const selection = window.getSelection();
    const text = selection.toString().trim();
    
    if (!text || !selection.rangeCount) {
        clearPdfTextSelectionState();
        return;
    }
    
    const range = selection.getRangeAt(0);
    
    // Find the text items that contain the selection
    const textLayer = document.getElementById('pdfTextLayer');
    if (!textLayer) return;
    
    // Get start and end positions from data attributes
    let startPos = null;
    let endPos = null;

    const pageModel = getPdfSelectionPageModel(doc, currentPdfState.currentPage);
    const normalizedRects = getNormalizedSelectionRectsForPdfTextLayer(range, textLayer);
    if (pageModel && normalizedRects.length > 0) {
        const geometrySelection = getPdfSelectionRangeFromNormalizedRects(pageModel, normalizedRects, doc);
        const refinedGeometrySelection = geometrySelection
            ? (refinePdfSelectionRangeWithSelectedText(doc, geometrySelection.startIndex, geometrySelection.endIndex, text) || geometrySelection)
            : null;
        if (
            refinedGeometrySelection &&
            refinedGeometrySelection.endIndex > refinedGeometrySelection.startIndex &&
            isMappedPdfSelectionConsistent(doc, refinedGeometrySelection.startIndex, refinedGeometrySelection.endIndex, text)
        ) {
            clearPendingPdfRegionSelection();
            appData.selectedText = {
                text: refinedGeometrySelection.text,
                startIndex: refinedGeometrySelection.startIndex,
                endIndex: refinedGeometrySelection.endIndex
            };
            setPdfSelectionStatus(PDF_TEXT_SELECTION_READY_TEXT, 'selected');
            return;
        }
    }
    
    // Walk through the selection to find character positions
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    
    // Find parent elements with position data
    const findTextItem = (node) => {
        while (node && node !== textLayer) {
            if (node.dataset && node.dataset.start !== undefined) {
                return node;
            }
            node = node.parentElement;
        }
        return null;
    };
    
    const startItem = findTextItem(startContainer.parentElement || startContainer);
    const endItem = findTextItem(endContainer.parentElement || endContainer);
    
    if (startItem && endItem) {
        const startBase = Number.parseInt(startItem.dataset.start, 10);
        const endBase = Number.parseInt(endItem.dataset.start, 10);

        if (Number.isFinite(startBase) && Number.isFinite(endBase)) {
            const startItemEnd = Number.parseInt(startItem.dataset.end, 10);
            const endItemEnd = Number.parseInt(endItem.dataset.end, 10);
            const maxStartOffset = Number.isFinite(startItemEnd)
                ? Math.max(0, startItemEnd - startBase)
                : range.startOffset;
            const maxEndOffset = Number.isFinite(endItemEnd)
                ? Math.max(0, endItemEnd - endBase)
                : range.endOffset;

            const safeStartOffset = Math.max(0, Math.min(range.startOffset, maxStartOffset));
            const safeEndOffset = Math.max(0, Math.min(range.endOffset, maxEndOffset));

            startPos = startBase + safeStartOffset;
            endPos = endBase + safeEndOffset;

            // Ensure valid range
            if (startPos > endPos) {
                [startPos, endPos] = [endPos, startPos];
            }

            // Clamp to document bounds
            startPos = Math.max(0, Math.min(startPos, doc.content.length));
            endPos = Math.max(0, Math.min(endPos, doc.content.length));

            if (
                endPos > startPos &&
                isMappedPdfSelectionConsistent(doc, startPos, endPos, text)
            ) {
                clearPendingPdfRegionSelection();
                appData.selectedText = {
                    text: text,
                    startIndex: startPos,
                    endIndex: endPos
                };
                setPdfSelectionStatus(PDF_TEXT_SELECTION_READY_TEXT, 'selected');
                return;
            }
        }
    }

    // Fallback: if PDF.js text spans don't map cleanly, use DOM text offsets.
    if (typeof getTextPosition === 'function') {
        const position = getTextPosition(textLayer, range, doc.content);
        if (position && position.end > position.start) {
            const pageOffset = getPdfPageTextOffset(doc, currentPdfState.currentPage);
            const startIndex = Math.max(0, Math.min(position.start + pageOffset, doc.content.length));
            const endIndex = Math.max(0, Math.min(position.end + pageOffset, doc.content.length));

            clearPendingPdfRegionSelection();
            appData.selectedText = {
                text: text,
                startIndex: startIndex,
                endIndex: endIndex
            };
            setPdfSelectionStatus(PDF_TEXT_SELECTION_READY_TEXT, 'selected');
            return;
        }
    }

    clearPdfTextSelectionState();
}

/**
 * Navigation functions
 */
function pdfPrevPage() {
    if (currentPdfState.currentPage > 1) {
        const doc = appData.documents.find(d => d.id === currentPdfState.docId);
        if (doc) {
            renderPdfPage(currentPdfState.currentPage - 1, doc);
        }
    }
}

function pdfNextPage() {
    if (currentPdfState.currentPage < currentPdfState.totalPages) {
        const doc = appData.documents.find(d => d.id === currentPdfState.docId);
        if (doc) {
            renderPdfPage(currentPdfState.currentPage + 1, doc);
        }
    }
}

function pdfAdjustZoomByPercent(deltaPercent) {
    const newPercent = Math.max(50, Math.min(300, Math.round(getCurrentPdfZoomPercent() + deltaPercent)));
    currentPdfState.scale = newPercent / 100;
    updatePdfToolbarState();
    const doc = appData.documents.find(d => d.id === currentPdfState.docId);
    if (doc) {
        renderPdfPage(currentPdfState.currentPage, doc);
    }
}

function pdfZoomIn() {
    pdfAdjustZoomByPercent(10);
}

function pdfZoomOut() {
    pdfAdjustZoomByPercent(-10);
}

/**
 * Go to a specific page containing a character position
 */
async function pdfGoToPosition(doc, charPos, options = {}) {
    if (!doc) return;
    const normalizedPos = Math.max(0, Number.parseInt(charPos, 10) || 0);
    const flashSegmentId = options.flashSegmentId ? String(options.flashSegmentId) : null;

    if (!currentPdfState.pdfDoc || currentPdfState.docId !== doc.id) {
        currentPdfState.pendingGoToCharPos = {
            docId: doc.id,
            charPos: normalizedPos,
            flashSegmentId
        };
        return;
    }

    const resolvedPage = await pdfResolvePageForCharPos(doc, normalizedPos, { allowLive: true, allowBinaryLoad: false });
    if (!currentPdfState.pdfDoc || currentPdfState.docId !== doc.id) {
        currentPdfState.pendingGoToCharPos = {
            docId: doc.id,
            charPos: normalizedPos,
            flashSegmentId
        };
        return;
    }
    renderPdfPage(resolvedPage, doc, currentPdfState.renderToken, {
        flashSegmentId
    });
}

function pdfGoToTextSegment(doc, segment) {
    if (!doc || !segment || segment.pdfRegion) return;
    const startIndex = Math.max(0, Number.parseInt(segment.startIndex, 10) || 0);
    pdfGoToPosition(doc, startIndex, {
        flashSegmentId: segment.id || null
    });
}

function pdfGoToPage(doc, pageNum) {
    if (!doc) return;
    const normalizedPage = Math.max(1, Number.parseInt(pageNum, 10) || 1);

    if (!currentPdfState.pdfDoc || currentPdfState.docId !== doc.id) {
        currentPdfState.pendingGoToPage = {
            docId: doc.id,
            pageNum: normalizedPage
        };
        return;
    }

    const upperBound = Math.max(1, Number.parseInt(currentPdfState.totalPages, 10) || normalizedPage);
    const targetPage = Math.max(1, Math.min(upperBound, normalizedPage));
    renderPdfPage(targetPage, doc);
}

function pdfGoToRegion(doc, region, segmentId = null) {
    if (!doc || !region || !region.pageNum) return;
    const normalizedRegion = (typeof normalizePdfRegionShape === 'function')
        ? normalizePdfRegionShape(region)
        : region;

    if (!currentPdfState.pdfDoc || currentPdfState.docId !== doc.id) {
        currentPdfState.pendingGoToRegion = {
            docId: doc.id,
            region: normalizedRegion,
            segmentId: segmentId || null
        };
        return;
    }

    Promise.resolve(renderPdfPage(normalizedRegion.pageNum, doc, currentPdfState.renderToken, {
        flashSegmentId: segmentId || null,
        focusRegion: normalizedRegion
    })).catch(() => {});
}

/**
 * Cleanup when switching documents
 */
function cleanupPdfState(options = {}) {
    const resetAllPending = !!options.resetAllPending;
    const previousRenderToken = currentPdfState.renderToken;
    currentPdfState.renderToken += 1;
    cancelPdfRenderTasks();
    clearPendingPdfRegionSelection();
    clearPdfTextSelectionState();
    currentPdfState.textSelectionEnabled = false;
    updatePdfCodingModeControls();
    const activeDocId = (typeof appData === 'object' && appData) ? appData.currentDocId : null;
    const keepPendingRegion = !resetAllPending && !!(
        currentPdfState.pendingGoToRegion &&
        activeDocId &&
        currentPdfState.pendingGoToRegion.docId === activeDocId
    );
    const keepPendingCharPos = !resetAllPending && !!(
        currentPdfState.pendingGoToCharPos &&
        activeDocId &&
        currentPdfState.pendingGoToCharPos.docId === activeDocId
    );
    const keepPendingPage = !resetAllPending && !!(
        currentPdfState.pendingGoToPage &&
        activeDocId &&
        currentPdfState.pendingGoToPage.docId === activeDocId
    );
    if (!keepPendingRegion) currentPdfState.pendingGoToRegion = null;
    if (!keepPendingCharPos) currentPdfState.pendingGoToCharPos = null;
    if (!keepPendingPage) currentPdfState.pendingGoToPage = null;

    const loadingTask = currentPdfState.loadingTask;
    if (loadingTask && typeof loadingTask.destroy === 'function') {
        try { loadingTask.destroy(); } catch (_) {}
    }
    currentPdfState.loadingTask = null;
    clearPdfViewerPendingRequests('PDF viewer reset.');
    postPdfViewerCommand('destroy', {}, {
        sessionId: previousRenderToken
    }).catch(() => {});
    if (typeof currentPdfState.viewerReadyReject === 'function') {
        currentPdfState.viewerReadyReject(new Error('PDF viewer reset.'));
    }

    const pdfDoc = currentPdfState.pdfDoc;
    if (pdfDoc) {
        try { pdfDoc.cleanup(); } catch (_) {}
        try { pdfDoc.destroy(); } catch (_) {}
    }

    currentPdfState.pdfDoc = null;
    currentPdfState.currentPage = 1;
    currentPdfState.totalPages = 0;
    currentPdfState.docId = null;
    currentPdfState.scale = 1.0;
    currentPdfState.codingMode = 'text';
    currentPdfState.viewerLoadedDocId = null;
    currentPdfState.viewerReady = false;
    currentPdfState.viewerReadyPromise = null;
    currentPdfState.viewerReadyResolve = null;
    currentPdfState.viewerReadyReject = null;
    currentPdfState.viewerFrame = null;
    updatePdfToolbarState();
}

function resetPdfProjectTransientState() {
    cleanupPdfState({ resetAllPending: true });
    pdfRegionPreviewCache.clear();
    pdfRegionPreviewInflight.clear();
    pdfRegionPreviewQueue.length = 0;
    pdfRegionPreviewQueued.clear();
    pdfRegionPreviewWorkers = 0;
    if (pdfRegionPreviewPumpTimer) {
        clearTimeout(pdfRegionPreviewPumpTimer);
        pdfRegionPreviewPumpTimer = null;
    }
    pdfThumbManifestKey = null;
    pdfThumbManifestLoaded = false;
    pdfThumbManifestMap = new Map();
    if (pdfThumbManifestSaveTimer) {
        clearTimeout(pdfThumbManifestSaveTimer);
        pdfThumbManifestSaveTimer = null;
    }
    if (pdfSelectionStatusTimer) {
        clearTimeout(pdfSelectionStatusTimer);
        pdfSelectionStatusTimer = null;
    }
    if (typeof document !== 'undefined') {
        const status = document.getElementById('pdfSelectionStatus');
        if (status) {
            status.hidden = true;
            status.classList.remove('warning');
            status.textContent = PDF_SELECTION_READY_TEXT;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PDF_VIEWER_MESSAGE_NAMESPACE,
        buildPdfSelectionGeometryFromTextItem,
        buildPdfSelectionCharRect,
        buildPdfSelectionPageModelFromPageInfo,
        buildPdfTextHighlightRectsForRange,
        getPdfSelectionRangeFromNormalizedRects,
        refinePdfSelectionRangeWithSelectedText,
        normalizePdfSelectionRect,
        pdfRectsIntersect,
        pointInsidePdfRect,
        isPdfViewerMessagePayload,
        resetPdfProjectTransientState
    };
}
