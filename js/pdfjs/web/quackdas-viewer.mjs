import * as pdfjsLib from '../pdf.mjs';

globalThis.pdfjsLib = pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../pdf.worker.mjs', import.meta.url).toString();

await import('./pdf_viewer.mjs');

const { EventBus, PDFLinkService, PDFSinglePageViewer } = globalThis.pdfjsViewer;

const viewerContainer = document.getElementById('viewerContainer');
const viewerElement = document.getElementById('viewer');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorIndicator = document.getElementById('errorIndicator');
const HOST_MESSAGE_NAMESPACE = 'quackdas-pdf-host:v1';
const MIN_RELATIVE_SCALE = 0.5;
const MAX_RELATIVE_SCALE = 3;
const FIT_WIDTH_GUTTER_PX = 0;
const SCALE_CALIBRATION_TOLERANCE = 0.003;

const state = {
    eventBus: new EventBus(),
    linkService: new PDFLinkService(),
    viewer: null,
    loadingTask: null,
    pdfDocument: null,
    currentDocId: null,
    currentPageNumber: 1,
    currentScale: 1,
    appliedScale: 1,
    currentMode: 'region',
    currentSegments: [],
    currentPendingRegion: null,
    currentPageInfo: null,
    currentFlashSegmentId: null,
    selectionFrame: null,
    drawingState: null,
    currentOcrSelection: null,
    ocrSelectionDrag: null,
    pageWidthCache: new Map(),
    suppressScaleEvent: false,
    lastFitCalibrationKey: '',
    sessionId: null
};

state.viewer = new PDFSinglePageViewer({
    container: viewerContainer,
    viewer: viewerElement,
    eventBus: state.eventBus,
    linkService: state.linkService,
    textLayerMode: 1,
    removePageBorders: true,
    imageResourcesPath: './images/'
});
state.linkService.setViewer(state.viewer);

function postToParent(message) {
    if (window.parent === window) return;
    try {
        window.parent.postMessage(Object.assign({
            namespace: HOST_MESSAGE_NAMESPACE
        }, message), '*');
    } catch (error) {
        console.warn('Quackdas PDF host parent message failed', error);
    }
}

function emitToParent(type, detail = {}) {
    postToParent({
        kind: 'event',
        type,
        sessionId: state.sessionId,
        payload: Object.assign({ docId: state.currentDocId }, detail)
    });
}

function sendResponse(requestId, ok, result = {}, error = '') {
    if (!requestId) return;
    postToParent({
        kind: 'response',
        requestId,
        ok: !!ok,
        result: ok ? result : undefined,
        error: ok ? undefined : String(error || 'Unknown PDF host error.')
    });
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseRequestMessage(data) {
    if (!isPlainObject(data)) return null;
    if (data.namespace !== HOST_MESSAGE_NAMESPACE || data.kind !== 'request') return null;
    const command = String(data.command || '').trim();
    const requestId = String(data.requestId || '').trim();
    if (!command || !requestId) return null;
    return {
        requestId,
        command,
        sessionId: data.sessionId,
        payload: isPlainObject(data.payload) ? data.payload : {}
    };
}

function showLoading(message = 'Loading PDF…') {
    if (!loadingIndicator) return;
    loadingIndicator.textContent = message;
    loadingIndicator.hidden = false;
}

function hideLoading() {
    if (loadingIndicator) loadingIndicator.hidden = true;
}

function showError(message) {
    hideLoading();
    if (!errorIndicator) return;
    errorIndicator.textContent = message || 'Unable to display this PDF.';
    errorIndicator.hidden = false;
}

function clearError() {
    if (errorIndicator) {
        errorIndicator.hidden = true;
        errorIndicator.textContent = '';
    }
}

function isBenignPdfLoadCancellation(error) {
    const message = String(error?.message || error || '').toLowerCase();
    if (!message) return false;
    return (
        message.includes('worker was destroyed') ||
        message.includes('transport destroyed') ||
        message.includes('loading aborted') ||
        message.includes('abortexception')
    );
}

function base64ToUint8Array(base64) {
    const binary = atob(String(base64 || ''));
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function getCurrentPageView() {
    if (!state.viewer || !state.currentPageNumber) return null;
    return state.viewer.getPageView(state.currentPageNumber - 1) || null;
}

function clampRelativeScale(value) {
    return Math.max(MIN_RELATIVE_SCALE, Math.min(MAX_RELATIVE_SCALE, Number(value) || 1));
}

function getViewerWidthForFit() {
    return Math.max(1, viewerContainer.clientWidth - (FIT_WIDTH_GUTTER_PX * 2));
}

function waitForLayoutFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function getPageWidthAtScaleOne(pageNumber = state.currentPageNumber) {
    const normalizedPageNumber = Math.max(1, Number(pageNumber) || 1);
    if (state.pageWidthCache.has(normalizedPageNumber)) {
        return state.pageWidthCache.get(normalizedPageNumber);
    }
    if (!state.pdfDocument) return 1;
    const page = await state.pdfDocument.getPage(normalizedPageNumber);
    const width = page.getViewport({ scale: 1 }).width || 1;
    state.pageWidthCache.set(normalizedPageNumber, width);
    return width;
}

async function getFitWidthBaseScale(pageNumber = state.currentPageNumber) {
    const pageWidth = await getPageWidthAtScaleOne(pageNumber);
    return Math.max(0.1, getViewerWidthForFit() / Math.max(1, pageWidth));
}

async function applyRelativeScale(relativeScale = state.currentScale, options = {}) {
    if (!state.pdfDocument) return;
    const normalizedRelativeScale = clampRelativeScale(relativeScale);
    const targetPageNumber = Math.max(1, Number(options.pageNumber) || state.currentPageNumber || 1);
    const baseScale = await getFitWidthBaseScale(targetPageNumber);
    let effectiveScale = Math.max(0.1, baseScale * normalizedRelativeScale);

    state.currentScale = normalizedRelativeScale;
    state.appliedScale = effectiveScale;
    state.suppressScaleEvent = true;
    state.viewer.currentScale = effectiveScale;

    await waitForLayoutFrame();

    if (targetPageNumber === state.currentPageNumber) {
        const pageDiv = getCurrentPageDiv();
        const renderedWidth = pageDiv?.getBoundingClientRect?.().width || 0;
        const targetWidth = getViewerWidthForFit() * normalizedRelativeScale;
        if (renderedWidth > 0 && targetWidth > 0) {
            const correctionRatio = targetWidth / renderedWidth;
            if (Math.abs(1 - correctionRatio) > SCALE_CALIBRATION_TOLERANCE) {
                effectiveScale = Math.max(0.1, effectiveScale * correctionRatio);
                state.appliedScale = effectiveScale;
                state.suppressScaleEvent = true;
                state.viewer.currentScale = effectiveScale;
                await waitForLayoutFrame();
            }
        }
    }

    if (options.emit !== false) {
        emitToParent('scalechanging', {
            scale: state.currentScale,
            effectiveScale: state.appliedScale
        });
    }
}

function queueFitWidthCalibration(pageNumber = state.currentPageNumber) {
    if (!state.pdfDocument) return;
    const normalizedPageNumber = Math.max(1, Number(pageNumber) || state.currentPageNumber || 1);
    const calibrationKey = [
        normalizedPageNumber,
        viewerContainer.clientWidth || 0,
        viewerContainer.clientHeight || 0,
        state.currentScale.toFixed(4)
    ].join(':');
    if (state.lastFitCalibrationKey === calibrationKey) return;
    state.lastFitCalibrationKey = calibrationKey;
    Promise.resolve(applyRelativeScale(state.currentScale, {
        pageNumber: normalizedPageNumber,
        emit: false
    })).catch(() => {});
}

function getCurrentPageDiv() {
    return getCurrentPageView()?.div || null;
}

function getCurrentPageLayer() {
    const pageDiv = getCurrentPageDiv();
    if (!pageDiv) return null;

    let layer = pageDiv.querySelector('.quackdas-page-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'quackdas-page-layer';
        layer.addEventListener('pointerdown', handleRegionPointerDown);
        layer.addEventListener('contextmenu', handleLayerContextMenu);
        pageDiv.appendChild(layer);
    }
    layer.classList.toggle('region-mode', state.currentMode === 'region');
    return layer;
}

function getCurrentOcrLayer() {
    const pageDiv = getCurrentPageDiv();
    if (!pageDiv) return null;

    let layer = pageDiv.querySelector('.quackdas-ocr-text-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'quackdas-ocr-text-layer';
        layer.addEventListener('pointerdown', handleOcrPointerDown);
        pageDiv.appendChild(layer);
    }
    layer.classList.toggle('selectable', state.currentMode === 'text');
    return layer;
}

function clearDrawingSelectionBox() {
    const box = document.querySelector('.quackdas-pending-region.drawing');
    if (box) box.remove();
    state.drawingState = null;
}

function clearNativeSelection() {
    const selection = document.getSelection();
    if (selection) selection.removeAllRanges();
}

function clearOcrSelection(emitEmpty = false, reason = 'explicit-clear') {
    state.currentOcrSelection = null;
    state.ocrSelectionDrag = null;
    requestAnimationFrame(syncCurrentPagePresentation);
    if (emitEmpty) {
        emitToParent('textselectionchange', {
            pageNumber: state.currentPageNumber,
            empty: true,
            reason
        });
    }
}

function clearCurrentTextSelection(emitEmpty = false, reason = 'explicit-clear') {
    clearNativeSelection();
    clearOcrSelection(emitEmpty, reason);
}

function normalizeRect(rect) {
    if (!Array.isArray(rect) || rect.length < 4) return null;
    const values = rect.map((value) => Number(value));
    if (!values.every(Number.isFinite)) return null;
    return [
        Math.min(values[0], values[2]),
        Math.min(values[1], values[3]),
        Math.max(values[0], values[2]),
        Math.max(values[1], values[3])
    ];
}

function roundRegion(value) {
    return Math.round(Number(value || 0) * 10000) / 10000;
}

function normalizeEventPoint(event, rect) {
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    return { x, y };
}

function getNormalizedPagePoint(event, pageDiv = getCurrentPageDiv()) {
    const rect = pageDiv?.getBoundingClientRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    return [
        Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    ];
}

function selectionBelongsToNode(selection, container) {
    if (!selection || !container || !selection.rangeCount) return false;
    for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        let node = range.commonAncestorContainer;
        if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
        if (node && container.contains(node)) return true;
        try {
            if (typeof range.intersectsNode === 'function' && range.intersectsNode(container)) {
                return true;
            }
        } catch (_) {}
    }
    return false;
}

function getNormalizedSelectionRects(range, container) {
    const bounds = container?.getBoundingClientRect();
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return [];

    return Array.from(range.getClientRects())
        .map((clientRect) => normalizeRect([
            (clientRect.left - bounds.left) / bounds.width,
            (clientRect.top - bounds.top) / bounds.height,
            (clientRect.right - bounds.left) / bounds.width,
            (clientRect.bottom - bounds.top) / bounds.height
        ]))
        .filter(Boolean);
}

function getCurrentOcrItems() {
    const items = Array.isArray(state.currentPageInfo?.textItems) ? state.currentPageInfo.textItems : [];
    return items
        .filter((item) => (
            item &&
            Number.isFinite(Number(item.start)) &&
            Number.isFinite(Number(item.end)) &&
            Number(item.end) > Number(item.start) &&
            Number.isFinite(Number(item.xNorm)) &&
            Number.isFinite(Number(item.yNorm)) &&
            Number.isFinite(Number(item.wNorm)) &&
            Number.isFinite(Number(item.hNorm))
        ))
        .slice()
        .sort((a, b) => Number(a.start) - Number(b.start));
}

function getOcrItemRect(item) {
    if (!item) return null;
    return normalizeRect([
        Number(item.xNorm) || 0,
        Number(item.yNorm) || 0,
        (Number(item.xNorm) || 0) + Math.max(0, Number(item.wNorm) || 0),
        (Number(item.yNorm) || 0) + Math.max(0, Number(item.hNorm) || 0)
    ]);
}

function mergeOcrSelectionRects(rects) {
    const normalizedRects = (Array.isArray(rects) ? rects : [])
        .map((rect) => normalizeRect(rect))
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
        const lineTolerance = Math.max(currentHeight, rectHeight) * 0.7;
        const gapTolerance = Math.max(0.003, Math.max(currentHeight, rectHeight) * 0.9);

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

function findOcrItemAtPoint(point) {
    if (!Array.isArray(point) || point.length < 2) return null;

    const items = getCurrentOcrItems();
    if (items.length === 0) return null;

    const containing = items.find((item) => {
        const rect = getOcrItemRect(item);
        if (!rect) return false;
        return point[0] >= rect[0] - 0.004 &&
            point[0] <= rect[2] + 0.004 &&
            point[1] >= rect[1] - 0.004 &&
            point[1] <= rect[3] + 0.004;
    });
    if (containing) return containing;

    let best = null;
    let bestDistance = Infinity;
    for (const item of items) {
        const rect = getOcrItemRect(item);
        if (!rect) continue;
        const centerX = (rect[0] + rect[2]) / 2;
        const centerY = (rect[1] + rect[3]) / 2;
        const distance = Math.hypot(point[0] - centerX, point[1] - centerY);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = item;
        }
    }

    return bestDistance <= 0.08 ? best : null;
}

function buildOcrSelectionPayload(anchorItem, headItem) {
    if (!anchorItem || !headItem) return null;

    const startIndex = Math.min(Number(anchorItem.start) || 0, Number(headItem.start) || 0);
    const endIndex = Math.max(Number(anchorItem.end) || startIndex, Number(headItem.end) || startIndex);
    if (!(endIndex > startIndex)) return null;

    const selectedItems = getCurrentOcrItems().filter((item) => (
        Number(item.end) > startIndex &&
        Number(item.start) < endIndex
    ));
    if (selectedItems.length === 0) return null;

    return {
        pageNumber: state.currentPageNumber,
        startIndex,
        endIndex,
        rects: mergeOcrSelectionRects(selectedItems.map(getOcrItemRect))
    };
}

function setOcrSelection(payload, emit = true) {
    if (!payload || !Array.isArray(payload.rects) || payload.rects.length === 0) {
        clearOcrSelection(emit);
        return;
    }

    state.currentOcrSelection = payload;
    requestAnimationFrame(syncCurrentPagePresentation);
    if (emit) {
        emitToParent('textselectionchange', Object.assign({
            pageNumber: state.currentPageNumber
        }, payload));
    }
}

function handleOcrPointerDown(event) {
    if (state.currentMode !== 'text') return;
    if (!state.currentPageInfo?.ocr) return;
    if (event.button !== 0) return;

    const point = getNormalizedPagePoint(event);
    const anchorItem = findOcrItemAtPoint(point);
    if (!anchorItem) {
        clearCurrentTextSelection(true, 'explicit-clear');
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    clearNativeSelection();

    state.ocrSelectionDrag = {
        pointerId: event.pointerId,
        anchorItem
    };
    const payload = buildOcrSelectionPayload(anchorItem, anchorItem);
    if (payload) setOcrSelection(payload, true);
}

function updateOcrSelectionFromPointer(event, emit = true) {
    if (!state.ocrSelectionDrag?.anchorItem) return;
    const point = getNormalizedPagePoint(event);
    const headItem = findOcrItemAtPoint(point) || state.ocrSelectionDrag.anchorItem;
    const payload = buildOcrSelectionPayload(state.ocrSelectionDrag.anchorItem, headItem);
    if (!payload) return;
    setOcrSelection(payload, emit);
}

function updateModeClasses() {
    const layer = getCurrentPageLayer();
    if (layer) layer.classList.toggle('region-mode', state.currentMode === 'region');

    const ocrLayer = getCurrentOcrLayer();
    const hasOcrText = !!(
        state.currentPageInfo?.ocr &&
        Array.isArray(state.currentPageInfo.textItems) &&
        state.currentPageInfo.textItems.length > 0
    );
    if (ocrLayer) {
        ocrLayer.classList.toggle('selectable', state.currentMode === 'text' && hasOcrText);
        ocrLayer.style.display = hasOcrText ? 'block' : 'none';
    }

    viewerElement.classList.toggle('noUserSelect', state.currentMode === 'region');
}

function renderOcrTextLayer() {
    const ocrLayer = getCurrentOcrLayer();
    if (!ocrLayer) return;

    const pageDiv = getCurrentPageDiv();
    const pageHeight = Math.max(1, pageDiv?.clientHeight || 1);

    const pageInfo = state.currentPageInfo;
    if (!pageInfo?.ocr || !Array.isArray(pageInfo.textItems) || pageInfo.textItems.length === 0) {
        ocrLayer.textContent = '';
        return;
    }

    ocrLayer.textContent = '';
    for (const item of pageInfo.textItems) {
        const span = document.createElement('span');
        span.textContent = String(item.text || '');
        span.style.left = `${(Number(item.xNorm) || 0) * 100}%`;
        span.style.top = `${(Number(item.yNorm) || 0) * 100}%`;
        span.style.width = `${Math.max(0, Number(item.wNorm) || 0) * 100}%`;
        span.style.height = `${Math.max(0, Number(item.hNorm) || 0) * 100}%`;
        span.style.fontSize = `${Math.max(10, (Math.max(0, Number(item.hNorm) || 0) * pageHeight * 0.9))}px`;
        ocrLayer.appendChild(span);
    }
}

function renderRegions() {
    const layer = getCurrentPageLayer();
    if (!layer) return;

    layer.textContent = '';

    const pageNum = state.currentPageNumber;
    const segments = Array.isArray(state.currentSegments) ? state.currentSegments : [];
    for (const segment of segments) {
        if (!segment) continue;

        if (segment.kind === 'text' && Array.isArray(segment.rects) && segment.rects.length > 0) {
            segment.rects.forEach((rect) => {
                if (!Array.isArray(rect) || rect.length < 4) return;
                const mark = document.createElement('div');
                mark.className = 'quackdas-coded-text-mark';
                mark.dataset.segmentId = String(segment.segmentId || '');
                mark.dataset.segmentKind = 'text';
                mark.style.left = `${(Number(rect[0]) || 0) * 100}%`;
                mark.style.top = `${(Number(rect[1]) || 0) * 100}%`;
                mark.style.width = `${Math.max(0, (Number(rect[2]) || 0) - (Number(rect[0]) || 0)) * 100}%`;
                mark.style.height = `${Math.max(0, (Number(rect[3]) || 0) - (Number(rect[1]) || 0)) * 100}%`;
                if (segment.fillColor) mark.style.background = segment.fillColor;
                if (segment.underlineColor) {
                    mark.style.boxShadow = `inset 0 -2px 0 0 ${segment.underlineColor}`;
                }
                if (segment.title) mark.title = segment.title;
                layer.appendChild(mark);
            });
            continue;
        }

        if (!segment.region || Number(segment.region.pageNum) !== pageNum) continue;

        const box = document.createElement('div');
        box.className = 'quackdas-coded-region';
        box.dataset.segmentId = String(segment.segmentId || '');
        box.style.left = `${(Number(segment.region.xNorm) || 0) * 100}%`;
        box.style.top = `${(Number(segment.region.yNorm) || 0) * 100}%`;
        box.style.width = `${Math.max(0, Number(segment.region.wNorm) || 0) * 100}%`;
        box.style.height = `${Math.max(0, Number(segment.region.hNorm) || 0) * 100}%`;
        if (segment.color) {
            box.style.borderColor = segment.color;
            box.style.backgroundColor = `${segment.color}33`;
        }
        if (segment.title) box.title = segment.title;
        box.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            emitToParent('regioncontextmenu', {
                segmentId: segment.segmentId,
                clientX: event.clientX,
                clientY: event.clientY
            });
        });
        layer.appendChild(box);
    }

    const pending = state.currentPendingRegion;
    if (pending && Number(pending.pageNum) === pageNum) {
        const box = document.createElement('div');
        box.className = 'quackdas-pending-region';
        box.style.left = `${(Number(pending.xNorm) || 0) * 100}%`;
        box.style.top = `${(Number(pending.yNorm) || 0) * 100}%`;
        box.style.width = `${Math.max(0, Number(pending.wNorm) || 0) * 100}%`;
        box.style.height = `${Math.max(0, Number(pending.hNorm) || 0) * 100}%`;
        layer.appendChild(box);
    }

    if (state.currentMode === 'text' && state.currentPageInfo?.ocr && state.currentOcrSelection?.pageNumber === pageNum) {
        for (const rect of state.currentOcrSelection.rects || []) {
            if (!Array.isArray(rect) || rect.length < 4) continue;
            const mark = document.createElement('div');
            mark.className = 'quackdas-ocr-active-selection';
            mark.style.left = `${(Number(rect[0]) || 0) * 100}%`;
            mark.style.top = `${(Number(rect[1]) || 0) * 100}%`;
            mark.style.width = `${Math.max(0, (Number(rect[2]) || 0) - (Number(rect[0]) || 0)) * 100}%`;
            mark.style.height = `${Math.max(0, (Number(rect[3]) || 0) - (Number(rect[1]) || 0)) * 100}%`;
            layer.appendChild(mark);
        }
    }

    if (state.currentFlashSegmentId) {
        const flashEl = layer.querySelector(`[data-segment-id="${CSS.escape(String(state.currentFlashSegmentId))}"]`);
        if (flashEl) {
            flashEl.classList.add('flash');
            flashEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        }
        state.currentFlashSegmentId = null;
    }

    updateModeClasses();
}

function findTextSegmentIdAtClientPoint(clientX, clientY) {
    const pageDiv = getCurrentPageDiv();
    if (!pageDiv) return '';

    const pageRect = pageDiv.getBoundingClientRect();
    if (!(pageRect.width > 0) || !(pageRect.height > 0)) return '';

    const xNorm = (clientX - pageRect.left) / pageRect.width;
    const yNorm = (clientY - pageRect.top) / pageRect.height;
    if (!(xNorm >= 0 && xNorm <= 1 && yNorm >= 0 && yNorm <= 1)) return '';

    const textSegments = (Array.isArray(state.currentSegments) ? state.currentSegments : []).filter((segment) => (
        segment &&
        segment.kind === 'text' &&
        Array.isArray(segment.rects) &&
        segment.rects.length > 0 &&
        segment.segmentId
    ));

    for (const segment of textSegments) {
        if (segment.rects.some((rect) => (
            Array.isArray(rect) &&
            rect.length >= 4 &&
            xNorm >= Number(rect[0]) &&
            xNorm <= Number(rect[2]) &&
            yNorm >= Number(rect[1]) &&
            yNorm <= Number(rect[3])
        ))) {
            return String(segment.segmentId);
        }
    }

    return '';
}

function syncCurrentPagePresentation() {
    renderRegions();
    renderOcrTextLayer();
    updateModeClasses();
}

function scheduleSelectionSync() {
    if (state.selectionFrame !== null) {
        cancelAnimationFrame(state.selectionFrame);
    }
    state.selectionFrame = requestAnimationFrame(() => {
        state.selectionFrame = null;
        syncTextSelection();
    });
}

function syncTextSelection() {
    if (state.currentMode !== 'text') return;

    if (state.currentPageInfo?.ocr) {
        if (state.currentOcrSelection) {
            emitToParent('textselectionchange', Object.assign({
                pageNumber: state.currentPageNumber
            }, state.currentOcrSelection));
        } else {
            emitToParent('textselectionchange', {
                pageNumber: state.currentPageNumber,
                empty: true,
                reason: 'collapse'
            });
        }
        return;
    }

    const selection = document.getSelection();
    const pageDiv = getCurrentPageDiv();
    if (!selection || !pageDiv || selection.isCollapsed || !selection.rangeCount) {
        emitToParent('textselectionchange', {
            pageNumber: state.currentPageNumber,
            empty: true,
            reason: 'collapse'
        });
        return;
    }

    const nativeTextLayer = pageDiv.querySelector('.textLayer');
    const ocrLayer = pageDiv.querySelector('.quackdas-ocr-text-layer');
    const selectionContainer = selectionBelongsToNode(selection, nativeTextLayer)
        ? nativeTextLayer
        : (selectionBelongsToNode(selection, ocrLayer) ? ocrLayer : null);

    if (!selectionContainer) {
        return;
    }

    const text = selection.toString().trim();
    if (!text) {
        emitToParent('textselectionchange', {
            pageNumber: state.currentPageNumber,
            empty: true,
            reason: 'collapse'
        });
        return;
    }

    const range = selection.getRangeAt(0);
    const rects = getNormalizedSelectionRects(range, pageDiv);
    emitToParent('textselectionchange', {
        pageNumber: state.currentPageNumber,
        text,
        rects
    });
}

function handleLayerContextMenu(event) {
    if (event.target?.closest('.quackdas-coded-region')) return;
    event.preventDefault();
    event.stopPropagation();
    emitToParent('backgroundcontextmenu', {
        clientX: event.clientX,
        clientY: event.clientY
    });
}

function handleRegionPointerDown(event) {
    const layer = getCurrentPageLayer();
    if (!layer || state.currentMode !== 'region') return;
    if (event.button !== 0) return;
    if (event.target?.closest('.quackdas-coded-region')) return;

    event.preventDefault();
    event.stopPropagation();
    clearNativeSelection();

    const rect = layer.getBoundingClientRect();
    const start = normalizeEventPoint(event, rect);
    const draft = document.createElement('div');
    draft.className = 'quackdas-pending-region drawing';
    draft.style.left = `${start.x}px`;
    draft.style.top = `${start.y}px`;
    draft.style.width = '0px';
    draft.style.height = '0px';
    layer.appendChild(draft);

    state.drawingState = {
        pointerId: event.pointerId,
        startX: start.x,
        startY: start.y,
        rect
    };

    layer.setPointerCapture(event.pointerId);
}

function updateDrawingRegion(event) {
    const layer = getCurrentPageLayer();
    const draft = layer?.querySelector('.quackdas-pending-region.drawing');
    const drawing = state.drawingState;
    if (!draft || !drawing) return;

    const point = normalizeEventPoint(event, drawing.rect);
    const left = Math.min(drawing.startX, point.x);
    const top = Math.min(drawing.startY, point.y);
    const width = Math.abs(point.x - drawing.startX);
    const height = Math.abs(point.y - drawing.startY);

    draft.style.left = `${left}px`;
    draft.style.top = `${top}px`;
    draft.style.width = `${width}px`;
    draft.style.height = `${height}px`;
}

function completeDrawingRegion(event) {
    const layer = getCurrentPageLayer();
    const draft = layer?.querySelector('.quackdas-pending-region.drawing');
    const drawing = state.drawingState;
    if (!draft || !drawing) {
        clearDrawingSelectionBox();
        return;
    }

    const point = normalizeEventPoint(event, drawing.rect);
    const left = Math.min(drawing.startX, point.x);
    const top = Math.min(drawing.startY, point.y);
    const width = Math.abs(point.x - drawing.startX);
    const height = Math.abs(point.y - drawing.startY);

    clearDrawingSelectionBox();

    if (width < 6 || height < 6 || !(drawing.rect.width > 0) || !(drawing.rect.height > 0)) {
        emitToParent('regionselected', {
            pageNumber: state.currentPageNumber,
            empty: true
        });
        return;
    }

    const region = {
        pageNum: state.currentPageNumber,
        xNorm: roundRegion(left / drawing.rect.width),
        yNorm: roundRegion(top / drawing.rect.height),
        wNorm: roundRegion(width / drawing.rect.width),
        hNorm: roundRegion(height / drawing.rect.height)
    };

    state.currentPendingRegion = region;
    renderRegions();
    emitToParent('regionselected', {
        pageNumber: state.currentPageNumber,
        region
    });
}

document.addEventListener('selectionchange', scheduleSelectionSync);
document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key < '1' || event.key > '9') return;

    if (state.currentMode === 'text') {
        syncTextSelection();
    }

    emitToParent('codingshortcut', {
        key: event.key
    });
    event.preventDefault();
});
document.addEventListener('pointermove', (event) => {
    if (state.ocrSelectionDrag) {
        event.preventDefault();
        updateOcrSelectionFromPointer(event, true);
        return;
    }
    if (!state.drawingState) return;
    updateDrawingRegion(event);
});
document.addEventListener('pointerup', (event) => {
    if (state.ocrSelectionDrag && event.pointerId === state.ocrSelectionDrag.pointerId) {
        event.preventDefault();
        updateOcrSelectionFromPointer(event, true);
        state.ocrSelectionDrag = null;
        return;
    }
    if (!state.drawingState || event.pointerId !== state.drawingState.pointerId) return;
    completeDrawingRegion(event);
});
document.addEventListener('pointercancel', (event) => {
    if (state.ocrSelectionDrag && event.pointerId === state.ocrSelectionDrag.pointerId) {
        state.ocrSelectionDrag = null;
        return;
    }
    if (!state.drawingState || event.pointerId !== state.drawingState.pointerId) return;
    clearDrawingSelectionBox();
});
viewerContainer.addEventListener('contextmenu', (event) => {
    const textSegmentId = findTextSegmentIdAtClientPoint(event.clientX, event.clientY);
    if (textSegmentId) {
        event.preventDefault();
        event.stopPropagation();
        emitToParent('textsegmentcontextmenu', {
            segmentId: textSegmentId,
            clientX: event.clientX,
            clientY: event.clientY
        });
        return;
    }
    if (event.target?.closest('.quackdas-coded-region')) return;
    if (event.target?.closest('.quackdas-page-layer')) return;
    event.preventDefault();
    event.stopPropagation();
    emitToParent('backgroundcontextmenu', {
        clientX: event.clientX,
        clientY: event.clientY
    });
});

state.eventBus._on('pagechanging', ({ pageNumber }) => {
    state.currentPageNumber = pageNumber;
    state.lastFitCalibrationKey = '';
    clearCurrentTextSelection(false);
    emitToParent('textselectionchange', {
        pageNumber,
        empty: true,
        reason: 'pagechange'
    });
    emitToParent('pagechanging', { pageNumber });
    Promise.resolve(applyRelativeScale(state.currentScale, { pageNumber, emit: false })).catch(() => {});
    requestAnimationFrame(syncCurrentPagePresentation);
});

state.eventBus._on('pagerendered', ({ pageNumber }) => {
    if (pageNumber !== state.currentPageNumber) return;
    queueFitWidthCalibration(pageNumber);
    requestAnimationFrame(syncCurrentPagePresentation);
    emitToParent('pagerendered', { pageNumber });
});

state.eventBus._on('textlayerrendered', ({ pageNumber }) => {
    if (pageNumber !== state.currentPageNumber) return;
    requestAnimationFrame(syncCurrentPagePresentation);
    emitToParent('textlayerrendered', { pageNumber });
});

state.eventBus._on('scalechanging', ({ scale }) => {
    state.appliedScale = Number(scale) || state.appliedScale;
    if (state.suppressScaleEvent) {
        state.suppressScaleEvent = false;
    } else {
        Promise.resolve(getFitWidthBaseScale(state.currentPageNumber)).then((baseScale) => {
            state.currentScale = clampRelativeScale(state.appliedScale / Math.max(0.1, baseScale));
            emitToParent('scalechanging', {
                scale: state.currentScale,
                effectiveScale: state.appliedScale
            });
        }).catch(() => {});
    }
    requestAnimationFrame(syncCurrentPagePresentation);
});

async function destroy() {
    clearDrawingSelectionBox();
    clearCurrentTextSelection(false);

    const loadingTask = state.loadingTask;
    state.loadingTask = null;
    if (loadingTask?.destroy) {
        try { await loadingTask.destroy(); } catch (_) {}
    }

    const pdfDocument = state.pdfDocument;
    state.pdfDocument = null;
    if (pdfDocument) {
        try { pdfDocument.cleanup(); } catch (_) {}
        try { await pdfDocument.destroy(); } catch (_) {}
    }

    state.linkService.setDocument(null);
    state.viewer.setDocument(null);
    state.currentSegments = [];
    state.currentPendingRegion = null;
    state.currentPageInfo = null;
    state.currentFlashSegmentId = null;
    state.currentOcrSelection = null;
    state.ocrSelectionDrag = null;
    state.pageWidthCache = new Map();
    state.appliedScale = 1;
    state.suppressScaleEvent = false;
    state.lastFitCalibrationKey = '';
    viewerElement.textContent = '';
}

async function loadDocument({ docId, pdfData, pageNumber = 1, scale = 1, mode = 'region' }) {
    clearError();
    showLoading();
    await destroy();

    state.currentDocId = String(docId || '');
    state.currentMode = mode === 'text' ? 'text' : 'region';
    state.currentScale = clampRelativeScale(scale);
    state.currentPageNumber = Math.max(1, Number(pageNumber) || 1);
    state.lastFitCalibrationKey = '';

    try {
        const loadingTask = pdfjsLib.getDocument({ data: base64ToUint8Array(pdfData) });
        state.loadingTask = loadingTask;
        const pdfDocument = await loadingTask.promise;
        state.loadingTask = null;
        state.pdfDocument = pdfDocument;

        state.viewer.setDocument(pdfDocument);
        state.linkService.setDocument(pdfDocument);

        await state.viewer.firstPagePromise;
        state.viewer.currentPageNumber = Math.max(1, Math.min(pdfDocument.numPages, state.currentPageNumber));
        state.currentPageNumber = state.viewer.currentPageNumber;
        await applyRelativeScale(state.currentScale, { pageNumber: state.currentPageNumber, emit: false });

        hideLoading();
        emitToParent('documentloaded', {
            pageNumber: state.currentPageNumber,
            totalPages: pdfDocument.numPages
        });
        requestAnimationFrame(syncCurrentPagePresentation);
    } catch (error) {
        if (isBenignPdfLoadCancellation(error)) {
            hideLoading();
            return;
        }
        console.error('Quackdas PDF host load failed', error);
        showError(error?.message || 'Unable to display this PDF.');
        emitToParent('documenterror', {
            message: error?.message || 'Unable to display this PDF.'
        });
        throw error;
    }
}

async function setPageNumber(pageNumber) {
    if (!state.pdfDocument) return;
    const nextPage = Math.max(1, Math.min(state.pdfDocument.numPages, Number(pageNumber) || 1));
    state.viewer.currentPageNumber = nextPage;
    state.currentPageNumber = nextPage;
    await applyRelativeScale(state.currentScale, { pageNumber: nextPage, emit: false });
    requestAnimationFrame(syncCurrentPagePresentation);
}

async function setScale(scale) {
    if (!state.pdfDocument) return;
    await applyRelativeScale(scale, { pageNumber: state.currentPageNumber, emit: false });
    requestAnimationFrame(syncCurrentPagePresentation);
}

async function setMode(mode) {
    state.currentMode = mode === 'text' ? 'text' : 'region';
    if (state.currentMode !== 'text') {
        clearCurrentTextSelection(true, 'mode-change');
    }
    updateModeClasses();
}

async function setPageDecorations({ segments = [], pendingRegion = null, pageInfo = null, flashSegmentId = null } = {}) {
    state.currentSegments = Array.isArray(segments) ? segments : [];
    state.currentPendingRegion = pendingRegion || null;
    state.currentPageInfo = pageInfo || null;
    state.currentFlashSegmentId = flashSegmentId || null;
    requestAnimationFrame(syncCurrentPagePresentation);
}

async function focusRegion(region, segmentId = null) {
    if (!region || !Number(region.pageNum)) return;
    if (Number(region.pageNum) !== state.currentPageNumber) {
        await setPageNumber(Number(region.pageNum));
    }

    const selector = segmentId
        ? `[data-segment-id="${CSS.escape(String(segmentId))}"]`
        : null;
    const target = selector
        ? document.querySelector(selector)
        : null;

    if (target) {
        target.classList.add('flash');
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        return;
    }

    const pageDiv = getCurrentPageDiv();
    if (!pageDiv) return;
    const bounds = pageDiv.getBoundingClientRect();
    if (!(bounds.width > 0) || !(bounds.height > 0)) return;
    const centerX = (Number(region.xNorm) || 0) + ((Number(region.wNorm) || 0) / 2);
    const centerY = (Number(region.yNorm) || 0) + ((Number(region.hNorm) || 0) / 2);
    viewerContainer.scrollTo({
        left: Math.max(0, pageDiv.offsetLeft + (centerX * bounds.width) - (viewerContainer.clientWidth / 2)),
        top: Math.max(0, pageDiv.offsetTop + (centerY * bounds.height) - (viewerContainer.clientHeight / 2)),
        behavior: 'smooth'
    });
}

async function handleParentCommandMessage(message) {
    const { requestId, command, sessionId, payload } = message;
    try {
        if (sessionId !== undefined && sessionId !== null && state.sessionId == null) {
            state.sessionId = sessionId;
        }
        if (command === 'loadDocument') {
            state.sessionId = sessionId ?? state.sessionId;
            await loadDocument(payload);
            sendResponse(requestId, true, {
                pageNumber: state.currentPageNumber,
                totalPages: state.pdfDocument?.numPages || 0
            });
            return;
        }
        if (command === 'destroy') {
            state.sessionId = sessionId ?? state.sessionId;
            await destroy();
            sendResponse(requestId, true, {});
            return;
        }
        if (sessionId !== undefined && sessionId !== null && state.sessionId !== null && sessionId !== state.sessionId) {
            sendResponse(requestId, false, {}, 'Stale PDF viewer session.');
            return;
        }

        switch (command) {
            case 'setPageNumber':
                await setPageNumber(payload.pageNumber);
                sendResponse(requestId, true, { pageNumber: state.currentPageNumber });
                return;
            case 'setScale':
                await setScale(payload.scale);
                sendResponse(requestId, true, { scale: state.currentScale });
                return;
            case 'setMode':
                await setMode(payload.mode);
                sendResponse(requestId, true, { mode: state.currentMode });
                return;
            case 'setPageDecorations':
                await setPageDecorations(payload);
                sendResponse(requestId, true, {});
                return;
            case 'focusRegion':
                await focusRegion(payload.region, payload.segmentId || null);
                sendResponse(requestId, true, {});
                return;
            case 'clearTextSelection':
                clearCurrentTextSelection(true, 'explicit-clear');
                sendResponse(requestId, true, {});
                return;
            default:
                sendResponse(requestId, false, {}, `Unknown PDF host command: ${command}`);
        }
    } catch (error) {
        sendResponse(requestId, false, {}, error?.message || String(error));
    }
}

window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const message = parseRequestMessage(event.data);
    if (!message) return;
    Promise.resolve(handleParentCommandMessage(message)).catch((error) => {
        sendResponse(message.requestId, false, {}, error?.message || String(error));
    });
});

window.addEventListener('resize', () => {
    if (!state.pdfDocument) return;
    state.lastFitCalibrationKey = '';
    Promise.resolve(applyRelativeScale(state.currentScale, {
        pageNumber: state.currentPageNumber,
        emit: false
    })).catch(() => {});
});

emitToParent('ready');
