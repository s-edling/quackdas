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
    scale: 1.5,
    docId: null,
    loadingTask: null,
    pageRenderTask: null,
    textLayerRenderTask: null,
    renderToken: 0
};

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
        console.log('PDF.js initialized');
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
                </div>
            </div>
        </div>
    `;

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

    // Render first page
    await renderPdfPage(1, doc, renderToken);
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

    // Set up text selection handler
    textLayer.onmouseup = () => handlePdfTextSelection(doc);
    
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
function pdfGoToPosition(doc, charPos) {
    if (!doc.pdfPages) return;
    
    let pageNum = 1;
    let cumulative = 0;
    
    for (const pageInfo of doc.pdfPages) {
        let pageLength = 0;
        if (pageInfo.textItems) {
            pageInfo.textItems.forEach(item => {
                pageLength += item.text.length;
            });
        }
        
        if (cumulative + pageLength >= charPos) {
            pageNum = pageInfo.pageNum;
            break;
        }
        
        cumulative += pageLength + 2; // +2 for page break
    }
    
    renderPdfPage(pageNum, doc);
}

/**
 * Cleanup when switching documents
 */
function cleanupPdfState() {
    currentPdfState.renderToken += 1;
    cancelPdfRenderTasks();

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
    updatePdfToolbarState();
}
