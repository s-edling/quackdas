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
    pendingGoToCharPos: null
};
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
const PDF_SELECTION_READY_TEXT = 'Region selected. Click a code to apply. Press Esc to clear.';

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

async function ensurePdfPageCharRanges(doc) {
    if (!doc) return null;
    const contentLength = String(doc.content || '').length;
    if (
        Array.isArray(doc._pdfPageCharRanges) &&
        doc._pdfPageCharRanges.length > 0 &&
        doc._pdfPageCharRangesContentLength === contentLength
    ) {
        return doc._pdfPageCharRanges;
    }

    let ranges = buildPageCharRangesFromStoredOffsets(doc);
    if (!ranges) {
        ranges = await buildPageCharRangesFromLivePdf(doc);
    }
    if (!ranges) {
        ranges = buildPageCharRangesFromLegacyItems(doc);
    }
    if (!ranges) return null;

    doc._pdfPageCharRanges = ranges;
    doc._pdfPageCharRangesContentLength = contentLength;
    return ranges;
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

function renderOcrTextLayer(textLayer, pageInfo, viewport) {
    textLayer.innerHTML = '';
    const items = Array.isArray(pageInfo?.textItems) ? pageInfo.textItems : [];
    for (const item of items) {
        const span = document.createElement('span');
        span.className = 'pdf-text-item';
        span.textContent = item.text || '';
        span.dataset.start = String(item.start);
        span.dataset.end = String(item.end);
        span.style.left = ((item.xNorm || 0) * viewport.width) + 'px';
        span.style.top = ((item.yNorm || 0) * viewport.height) + 'px';
        span.style.width = Math.max(1, (item.wNorm || 0) * viewport.width) + 'px';
        span.style.height = Math.max(1, (item.hNorm || 0) * viewport.height) + 'px';
        span.style.fontSize = Math.max(10, (item.hNorm || 0) * viewport.height * 0.9) + 'px';
        textLayer.appendChild(span);
    }
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

function renderPdfRegionOverlays(doc, pageNum, viewport) {
    const regionLayer = document.getElementById('pdfRegionLayer');
    if (!regionLayer) return;
    regionLayer.innerHTML = '';
    regionLayer.style.width = viewport.width + 'px';
    regionLayer.style.height = viewport.height + 'px';

    const segments = getSegmentsForDoc(doc.id).filter(seg => seg.pdfRegion && seg.pdfRegion.pageNum === pageNum);
    for (const seg of segments) {
        const code = appData.codes.find(c => seg.codeIds?.includes(c.id));
        const color = code?.color || '#7c9885';
        const region = seg.pdfRegion;
        const box = document.createElement('div');
        box.className = 'pdf-coded-region';
        box.dataset.segmentId = seg.id;
        box.style.left = (region.xNorm * viewport.width) + 'px';
        box.style.top = (region.yNorm * viewport.height) + 'px';
        box.style.width = Math.max(4, region.wNorm * viewport.width) + 'px';
        box.style.height = Math.max(4, region.hNorm * viewport.height) + 'px';
        box.style.borderColor = color;
        box.style.backgroundColor = color + '33';
        box.title = seg.text || `PDF region (page ${pageNum})`;
        box.oncontextmenu = (event) => showSegmentContextMenu(seg.id, event);
        regionLayer.appendChild(box);
    }

    if (currentPdfState.pendingRegion && currentPdfState.pendingRegion.pageNum === pageNum) {
        const p = currentPdfState.pendingRegion;
        const pending = document.createElement('div');
        pending.className = 'pdf-region-selection-box';
        pending.style.left = (p.xNorm * viewport.width) + 'px';
        pending.style.top = (p.yNorm * viewport.height) + 'px';
        pending.style.width = Math.max(4, p.wNorm * viewport.width) + 'px';
        pending.style.height = Math.max(4, p.hNorm * viewport.height) + 'px';
        regionLayer.appendChild(pending);
    }
}

function setupPdfRegionInteraction(doc, pageNum, viewport) {
    const regionLayer = document.getElementById('pdfRegionLayer');
    if (!regionLayer) return;

    regionLayer.onmousedown = (event) => {
        if (event.button !== 0) return;
        if (event.target && event.target !== regionLayer) return;
        event.preventDefault();
        event.stopPropagation();

        const rect = regionLayer.getBoundingClientRect();
        const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
        const startX = clamp(event.clientX - rect.left, 0, rect.width);
        const startY = clamp(event.clientY - rect.top, 0, rect.height);

        const box = document.createElement('div');
        box.className = 'pdf-region-selection-box';
        box.style.left = startX + 'px';
        box.style.top = startY + 'px';
        box.style.width = '0px';
        box.style.height = '0px';
        regionLayer.appendChild(box);

        const move = (e) => {
            const x = clamp(e.clientX - rect.left, 0, rect.width);
            const y = clamp(e.clientY - rect.top, 0, rect.height);
            const left = Math.min(startX, x);
            const top = Math.min(startY, y);
            const width = Math.abs(x - startX);
            const height = Math.abs(y - startY);
            box.style.left = left + 'px';
            box.style.top = top + 'px';
            box.style.width = width + 'px';
            box.style.height = height + 'px';
        };

        const up = (e) => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);

            const x = clamp(e.clientX - rect.left, 0, rect.width);
            const y = clamp(e.clientY - rect.top, 0, rect.height);
            const left = Math.min(startX, x);
            const top = Math.min(startY, y);
            const width = Math.abs(x - startX);
            const height = Math.abs(y - startY);

            if (box.parentElement) box.parentElement.removeChild(box);
            if (width < 6 || height < 6) {
                clearPendingPdfRegionSelection();
                return;
            }

            const region = {
                pageNum,
                xNorm: roundRegion(left / rect.width),
                yNorm: roundRegion(top / rect.height),
                wNorm: roundRegion(width / rect.width),
                hNorm: roundRegion(height / rect.height)
            };

            currentPdfState.pendingRegion = region;
            appData.selectedText = {
                kind: 'pdfRegion',
                text: `[PDF region: page ${pageNum}]`,
                pdfRegion: region
            };
            setPdfSelectionStatus(PDF_SELECTION_READY_TEXT, 'selected');
            renderPdfRegionOverlays(doc, pageNum, viewport);
        };

        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };
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
        let bestHint = '';
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
                        bestHint = ocrResult?.hint || '';
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
            saveData();
            if (wordCount > 0) {
                return { ok: true, error: '' };
            }
            const emptyReason = bestError || 'OCR completed, but no readable text was detected.';
            const emptyHint = bestHint || 'If this is an image-heavy scan, try a clearer source PDF or manual region coding.';
            return { ok: false, error: emptyReason + (emptyHint ? ` ${emptyHint}` : '') };
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

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
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
    const renderToken = currentPdfState.renderToken;
    currentPdfState.docId = doc.id;

    // Build container HTML before async PDF load so layout is stable.
    container.innerHTML = `
        <div class="pdf-viewer">
            <div class="pdf-container" id="pdfContainer">
                <div class="pdf-page-wrapper" id="pdfPageWrapper">
                    <canvas id="pdfCanvas"></canvas>
                    <div class="pdf-text-layer" id="pdfTextLayer"></div>
                    <div class="pdf-region-layer" id="pdfRegionLayer"></div>
                </div>
            </div>
        </div>
    `;
    const pdfContainer = container.querySelector('#pdfContainer');
    if (pdfContainer && typeof showContextMenu === 'function') {
        pdfContainer.oncontextmenu = (event) => {
            if (event.target && event.target.closest('.pdf-coded-region')) return;
            event.preventDefault();
            event.stopPropagation();
            const items = [];
            if (typeof extractPdfTextAsDocument === 'function') {
                items.push({ label: 'Extract text as document', onClick: () => extractPdfTextAsDocument(doc.id) });
            }
            if (items.length > 0) showContextMenu(items, event.clientX, event.clientY);
        };
    }

    // Load PDF from stored base64 data
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

    if (isLikelyImageOnlyPdf(doc, pdfDoc.numPages)) {
        const ocrResult = await ensureOcrForImageOnlyPdf(doc, renderToken, container.querySelector('.pdf-viewer'));
        if ((!ocrResult || !ocrResult.ok) && !doc._ocrReady) {
            const ocrNotice = document.createElement('div');
            ocrNotice.className = 'pdf-error';
            ocrNotice.id = 'pdfOcrUnavailable';
            const reason = (ocrResult && ocrResult.error) ? ocrResult.error : 'OCR fallback failed on this machine.';
            const p1 = document.createElement('p');
            p1.textContent = 'This appears to be a scanned PDF without a text layer.';
            const p2 = document.createElement('p');
            p2.textContent = reason;
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
            container.querySelector('.pdf-viewer')?.appendChild(ocrNotice);
        } else {
            const staleNotice = document.getElementById('pdfOcrUnavailable');
            if (staleNotice) staleNotice.remove();
        }
    }

    // Render first page.
    await renderPdfPage(1, doc, renderToken);

    // If navigation was requested before the PDF renderer was ready, apply it now.
    // Do this before first-page retry, otherwise retry can race and jump back to page 1.
    let appliedPendingNavigation = false;
    if (currentPdfState.pendingGoToCharPos && currentPdfState.pendingGoToCharPos.docId === doc.id) {
        const pending = currentPdfState.pendingGoToCharPos;
        currentPdfState.pendingGoToCharPos = null;
        appliedPendingNavigation = true;
        pdfGoToPosition(doc, pending.charPos);
    }
    if (currentPdfState.pendingGoToRegion && currentPdfState.pendingGoToRegion.docId === doc.id) {
        const pending = currentPdfState.pendingGoToRegion;
        currentPdfState.pendingGoToRegion = null;
        appliedPendingNavigation = true;
        pdfGoToRegion(doc, pending.region, pending.segmentId);
    }

    // Some PDFs intermittently show a blank initial canvas on first paint in Electron;
    // schedule one immediate retry to stabilize first-page rendering when no explicit navigation is pending.
    if (!appliedPendingNavigation) {
        setTimeout(() => {
            if (renderToken !== currentPdfState.renderToken) return;
            if (currentPdfState.docId !== doc.id) return;
            if (currentPdfState.currentPage !== 1) return;
            renderPdfPage(1, doc, renderToken).catch(() => {});
        }, 0);
    }
}

/**
 * Render a specific PDF page
 * @param {number} pageNum - Page number (1-indexed)
 * @param {object} doc - Document object
 */
async function renderPdfPage(pageNum, doc, expectedToken = currentPdfState.renderToken) {
    if (!currentPdfState.pdfDoc) return;
    if (expectedToken !== currentPdfState.renderToken) return;
    
    const pdfDoc = currentPdfState.pdfDoc;
    const page = await pdfDoc.getPage(pageNum);
    if (expectedToken !== currentPdfState.renderToken) return;
    
    const scale = currentPdfState.scale;
    const viewport = page.getViewport({ scale });
    
    // Set up canvas
    const canvas = document.getElementById('pdfCanvas');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Set wrapper size
    const wrapper = document.getElementById('pdfPageWrapper');
    if (!wrapper) return;
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';
    
    cancelPdfRenderTasks();

    // Render PDF page to canvas
    const renderTask = page.render({
        canvasContext: context,
        viewport: viewport
    });
    currentPdfState.pageRenderTask = renderTask;

    try {
        await renderTask.promise;
    } catch (error) {
        if (!error || error.name !== 'RenderingCancelledException') throw error;
        return;
    }
    if (expectedToken !== currentPdfState.renderToken) return;
    
    // Render text layer for selection
    const textLayer = document.getElementById('pdfTextLayer');
    if (!textLayer) return;
    textLayer.innerHTML = '';
    textLayer.style.width = viewport.width + 'px';
    textLayer.style.height = viewport.height + 'px';
    
    const textContent = await page.getTextContent();
    if (expectedToken !== currentPdfState.renderToken) return;
    
    // Get page info from stored data
    const pageInfo = doc.pdfPages?.find(p => p.pageNum === pageNum) || null;
    const hasNativeText = Array.isArray(textContent?.items) && textContent.items.some(item => item && item.str && item.str.length > 0);
    
    if (!hasNativeText && pageInfo?.ocr) {
        renderOcrTextLayer(textLayer, pageInfo, viewport);
    } else {
        // Render text layer using PDF.js helper (much more reliable for selection than manual positioning)
        try {
            const textLayerTask = pdfjsLib.renderTextLayer({
                textContentSource: textContent,
                container: textLayer,
                viewport,
                textDivs: [],
                enhanceTextSelection: true
            });
            currentPdfState.textLayerRenderTask = textLayerTask;

            if (textLayerTask && textLayerTask.promise) {
                await textLayerTask.promise;
            } else if (textLayerTask && typeof textLayerTask.then === 'function') {
                await textLayerTask;
            }
        } catch (e) {
            if (!e || e.name !== 'RenderingCancelledException') {
                console.warn('PDF.js renderTextLayer failed; falling back to manual text positioning', e);
            }
            // Fallback: keep existing (simple) manual positioning for at least some selection
            textContent.items.forEach((item) => {
                if (!item.str) return;
                const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                const div = document.createElement('span');
                div.textContent = item.str;
                div.className = 'pdf-text-item';
                const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
                div.style.left = tx[4] + 'px';
                div.style.top = (viewport.height - tx[5]) + 'px';
                div.style.fontSize = fontSize + 'px';
                div.style.transformOrigin = '0% 0%';
                const angle = Math.atan2(tx[1], tx[0]);
                if (angle !== 0) div.style.transform = `rotate(${angle}rad)`;
                textLayer.appendChild(div);
            });
        }
    }

    if (expectedToken !== currentPdfState.renderToken) return;

    // Annotate text layer spans with absolute document indices for robust coding selection.
    if (pageInfo && Array.isArray(pageInfo.textItems)) {
        const textSpans = Array.from(textLayer.querySelectorAll('span'));
        let itemIndex = 0;
        for (const span of textSpans) {
            const txt = span.textContent || '';
            if (!txt.length) continue;
            const mapped = pageInfo.textItems[itemIndex];
            if (!mapped) break;
            span.dataset.start = String(mapped.start);
            span.dataset.end = String(mapped.end);
            itemIndex += 1;
        }
    }

    // Region-based PDF coding overlays and interaction
    renderPdfRegionOverlays(doc, pageNum, viewport);
    setupPdfRegionInteraction(doc, pageNum, viewport);
    
    // Update UI
    currentPdfState.currentPage = pageNum;
    updatePdfToolbarState();
}

/**
 * Handle text selection in PDF text layer
 * Maps DOM selection back to document character positions
 */
function handlePdfTextSelection(doc) {
    if (appData.filterCodeId) return;
    
    const selection = window.getSelection();
    const text = selection.toString().trim();
    
    if (!text || !selection.rangeCount) {
        appData.selectedText = null;
        return;
    }
    
    const range = selection.getRangeAt(0);
    
    // Find the text items that contain the selection
    const textLayer = document.getElementById('pdfTextLayer');
    if (!textLayer) return;
    
    // Get start and end positions from data attributes
    let startPos = null;
    let endPos = null;
    
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
        startPos = parseInt(startItem.dataset.start) + range.startOffset;
        endPos = parseInt(endItem.dataset.start) + range.endOffset;
        
        // Ensure valid range
        if (startPos > endPos) {
            [startPos, endPos] = [endPos, startPos];
        }
        
        // Clamp to document bounds
        startPos = Math.max(0, Math.min(startPos, doc.content.length));
        endPos = Math.max(0, Math.min(endPos, doc.content.length));
        
        if (endPos > startPos) {
            appData.selectedText = {
                text: text,
                startIndex: startPos,
                endIndex: endPos
            };
        }
        return;
    }

    // Fallback: if PDF.js text spans don't map cleanly, use DOM text offsets.
    if (typeof getTextPosition === 'function') {
        const position = getTextPosition(textLayer, range, doc.content);
        if (position && position.end > position.start) {
            const pageOffset = getPdfPageTextOffset(doc, currentPdfState.currentPage);
            const startIndex = Math.max(0, Math.min(position.start + pageOffset, doc.content.length));
            const endIndex = Math.max(0, Math.min(position.end + pageOffset, doc.content.length));

            appData.selectedText = {
                text: text,
                startIndex: startIndex,
                endIndex: endIndex
            };
        }
    }
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
async function pdfGoToPosition(doc, charPos) {
    if (!doc) return;
    const normalizedPos = Math.max(0, Number.parseInt(charPos, 10) || 0);

    if (!currentPdfState.pdfDoc || currentPdfState.docId !== doc.id) {
        currentPdfState.pendingGoToCharPos = {
            docId: doc.id,
            charPos: normalizedPos
        };
        return;
    }

    const ranges = await ensurePdfPageCharRanges(doc);
    if (!ranges) return;
    if (!currentPdfState.pdfDoc || currentPdfState.docId !== doc.id) {
        currentPdfState.pendingGoToCharPos = {
            docId: doc.id,
            charPos: normalizedPos
        };
        return;
    }
    const fallbackPage = Array.isArray(doc.pdfPages) && doc.pdfPages.length > 0
        ? (Number.parseInt(doc.pdfPages[doc.pdfPages.length - 1]?.pageNum, 10) || 1)
        : (currentPdfState.totalPages || 1);
    const pageNum = resolvePdfPageNumForCharPos(ranges, normalizedPos, fallbackPage);

    renderPdfPage(pageNum, doc);
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

    Promise.resolve(renderPdfPage(normalizedRegion.pageNum, doc)).then(() => {
        if (!segmentId) return;
        const el = document.querySelector(`.pdf-coded-region[data-segment-id="${segmentId}"]`);
        if (el) {
            el.classList.add('flash');
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            setTimeout(() => el.classList.remove('flash'), 900);
        }
    }).catch(() => {});
}

/**
 * Cleanup when switching documents
 */
function cleanupPdfState() {
    currentPdfState.renderToken += 1;
    cancelPdfRenderTasks();
    clearPendingPdfRegionSelection();
    const activeDocId = (typeof appData === 'object' && appData) ? appData.currentDocId : null;
    const keepPendingRegion = !!(
        currentPdfState.pendingGoToRegion &&
        activeDocId &&
        currentPdfState.pendingGoToRegion.docId === activeDocId
    );
    const keepPendingCharPos = !!(
        currentPdfState.pendingGoToCharPos &&
        activeDocId &&
        currentPdfState.pendingGoToCharPos.docId === activeDocId
    );
    if (!keepPendingRegion) currentPdfState.pendingGoToRegion = null;
    if (!keepPendingCharPos) currentPdfState.pendingGoToCharPos = null;

    const loadingTask = currentPdfState.loadingTask;
    if (loadingTask && typeof loadingTask.destroy === 'function') {
        try { loadingTask.destroy(); } catch (_) {}
    }
    currentPdfState.loadingTask = null;

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
    updatePdfToolbarState();
}
