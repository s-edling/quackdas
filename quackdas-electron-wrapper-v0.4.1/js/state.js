/**
 * Quackdas - State Management
 * Core data structures, save/load, undo/redo
 */

// Data structure factory
function makeEmptyProject(overrides = {}) {
    const base = {
        projectName: 'untitled-project',
        documents: [],
        codes: [],
        segments: [], // {docId, text, codeIds: [], startIndex, endIndex}
        memos: [], // {id, type, targetId, content, created}
        folders: [], // {id, name, parentId, created, expanded, description}
        currentDocId: null,
        selectedText: null,
        filterCodeId: null,
        codeViewPresets: [],
        selectedDocIds: [],
        lastSelectedDocId: null,
        scrollPositions: {}, // {docId: scrollTop}
        zoomLevel: 100,
        hasUnsavedChanges: false,
        lastSaveTime: null,
        theme: 'light'
    };
    return Object.assign(base, overrides || {});
}

function normaliseProject(p) {
    const d = makeEmptyProject();
    const src = (p && typeof p === 'object') ? p : {};

    const out = Object.assign({}, d, src);

    out.documents = Array.isArray(src.documents) ? src.documents : [];
    out.codes = Array.isArray(src.codes) ? src.codes : [];
    out.segments = Array.isArray(src.segments) ? src.segments : [];
    out.memos = Array.isArray(src.memos) ? src.memos : [];
    out.folders = Array.isArray(src.folders) ? src.folders : [];
    out.codeViewPresets = Array.isArray(src.codeViewPresets) ? src.codeViewPresets : [];

    out.scrollPositions = (src.scrollPositions && typeof src.scrollPositions === 'object') ? src.scrollPositions : {};
    out.zoomLevel = Number.isFinite(src.zoomLevel) ? src.zoomLevel : d.zoomLevel;

    out.segments.forEach(seg => {
        if (seg && seg.pdfRegion) {
            seg.pdfRegion = normalizePdfRegionShape(seg.pdfRegion);
        }
    });

    out.memos.forEach(memo => {
        if (!memo.created) memo.created = new Date().toISOString();
        if (!memo.edited) memo.edited = memo.created;
        if (typeof memo.tag !== 'string') memo.tag = '';
    });

    // Validate currentDocId exists
    if (out.currentDocId && !out.documents.some(doc => doc.id === out.currentDocId)) {
        out.currentDocId = out.documents[0]?.id || null;
    }

    out.selectedDocIds = Array.isArray(src.selectedDocIds)
        ? src.selectedDocIds.filter(id => out.documents.some(doc => doc.id === id))
        : (out.currentDocId ? [out.currentDocId] : []);
    out.lastSelectedDocId = (src.lastSelectedDocId && out.documents.some(doc => doc.id === src.lastSelectedDocId))
        ? src.lastSelectedDocId
        : (out.selectedDocIds[out.selectedDocIds.length - 1] || null);

    // Validate filterCodeId exists
    if (out.filterCodeId && !out.codes.some(c => c.id === out.filterCodeId)) {
        out.filterCodeId = null;
    }

    // Ensure booleans / timestamps
    out.hasUnsavedChanges = !!out.hasUnsavedChanges;
    out.lastSaveTime = out.lastSaveTime || null;

    return out;
}

function normalizePdfRegionShape(region) {
    if (!region || typeof region !== 'object') return region;
    const toNumber = (v, fallback = 0) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    const toNorm = (v, fallback = 0) => {
        let n = toNumber(v, fallback);
        if (n > 1 && n <= 100) n = n / 100; // tolerate percent-style legacy values
        return Math.max(0, Math.min(1, n));
    };

    const xNorm = toNorm(region.xNorm, toNumber(region.x, 0));
    const yNorm = toNorm(region.yNorm, toNumber(region.y, 0));
    const wNorm = toNorm(region.wNorm, toNumber(region.width, 0));
    const hNorm = toNorm(region.hNorm, toNumber(region.height, 0));
    const pageNum = Math.max(1, parseInt(region.pageNum, 10) || 1);

    return {
        pageNum,
        xNorm,
        yNorm,
        wNorm,
        hNorm,
        // keep compatibility aliases
        x: xNorm,
        y: yNorm,
        width: wNorm,
        height: hNorm
    };
}

// Global state
let appData = makeEmptyProject();
let appDataRevision = 0;

// Precomputed indexes for O(1) lookups (rebuilt on state changes)
let indexes = {
    segmentsByDocId: {},      // docId -> [segment, ...]
    segmentsByCodeId: {},     // codeId -> [segment, ...]
    memosByTarget: {},        // "type:targetId" -> [memo, ...]
    segmentCountByDocId: {},  // docId -> count
    segmentCountByCodeId: {}, // codeId -> count
    memoCountByTarget: {}     // "type:targetId" -> count
};

function rebuildIndexes() {
    indexes.segmentsByDocId = {};
    indexes.segmentsByCodeId = {};
    indexes.memosByTarget = {};
    indexes.segmentCountByDocId = {};
    indexes.segmentCountByCodeId = {};
    indexes.memoCountByTarget = {};
    
    // Index segments by document
    appData.segments.forEach(seg => {
        if (!indexes.segmentsByDocId[seg.docId]) {
            indexes.segmentsByDocId[seg.docId] = [];
        }
        indexes.segmentsByDocId[seg.docId].push(seg);
        
        // Index segments by each code they have
        seg.codeIds.forEach(codeId => {
            if (!indexes.segmentsByCodeId[codeId]) {
                indexes.segmentsByCodeId[codeId] = [];
            }
            indexes.segmentsByCodeId[codeId].push(seg);
        });
    });
    
    // Precompute segment counts
    Object.keys(indexes.segmentsByDocId).forEach(docId => {
        indexes.segmentCountByDocId[docId] = indexes.segmentsByDocId[docId].length;
    });
    Object.keys(indexes.segmentsByCodeId).forEach(codeId => {
        indexes.segmentCountByCodeId[codeId] = indexes.segmentsByCodeId[codeId].length;
    });
    
    // Index memos by target
    appData.memos.forEach(memo => {
        const key = memo.type + ':' + memo.targetId;
        if (!indexes.memosByTarget[key]) {
            indexes.memosByTarget[key] = [];
        }
        indexes.memosByTarget[key].push(memo);
    });
    
    // Precompute memo counts
    Object.keys(indexes.memosByTarget).forEach(key => {
        indexes.memoCountByTarget[key] = indexes.memosByTarget[key].length;
    });
}

// Helper functions to access indexes
function getSegmentsForDoc(docId) {
    return indexes.segmentsByDocId[docId] || [];
}

function getSegmentsForCode(codeId) {
    return indexes.segmentsByCodeId[codeId] || [];
}

function getMemosForTarget(type, targetId) {
    return indexes.memosByTarget[type + ':' + targetId] || [];
}

function getMemoCountForTarget(type, targetId) {
    return indexes.memoCountByTarget[type + ':' + targetId] || 0;
}

function getDocSegmentCountFast(docId) {
    return indexes.segmentCountByDocId[docId] || 0;
}

function getCodeSegmentCountFast(codeId) {
    return indexes.segmentCountByCodeId[codeId] || 0;
}

// File System Access API handle for overwriting saves (not persisted)
let projectFileHandle = null;

// Undo/Redo history
let history = {
    past: [],
    future: [],
    maxLength: 50
};

const PROJECT_CACHE_KEY = 'quackdas-data';
const DOC_ACCESS_META_KEY = 'quackdas-doc-access';
let docAccessSaveTimer = null;

// Code colors
const codeColors = ['#7c9885', '#b67d8f', '#8b8daa', '#c8956f', '#8aa4b5', '#a68d7c', '#9a8d9e', '#7d9e9c'];
let colorIndex = 0;

function shouldUseLocalProjectCache() {
    // In Electron we use real project files (and backups), not localStorage snapshots.
    // localStorage is kept as a browser-only fallback.
    return !(window && window.electronAPI);
}

// Load data from storage
function loadData() {
    if (!shouldUseLocalProjectCache()) {
        appData = makeEmptyProject();
        rebuildIndexes();
        if (typeof window !== 'undefined' && typeof window.__markSearchIndexDirty === 'function') {
            window.__markSearchIndexDirty();
        }
        return;
    }

    try {
        const saved = localStorage.getItem(PROJECT_CACHE_KEY);
        if (saved) {
            appData = normaliseProject(JSON.parse(saved));
            
            // Add lastAccessed to old documents
            appData.documents.forEach(doc => {
                if (!doc.lastAccessed) doc.lastAccessed = doc.created || new Date().toISOString();
                if (!doc.metadata) doc.metadata = {};
            });
            
            // Add descriptions, shortcuts, and lastUsed to old codes
            appData.codes.forEach(code => {
                if (!code.description) code.description = '';
                if (!code.shortcut) code.shortcut = '';
                if (!code.lastUsed) code.lastUsed = code.created || new Date().toISOString();
            });

            // Normalize annotation metadata for older projects
            appData.memos.forEach(memo => {
                if (!memo.created) memo.created = new Date().toISOString();
                if (!memo.edited) memo.edited = memo.created;
                if (typeof memo.tag !== 'string') memo.tag = '';
            });

            // Overlay lightweight document access metadata (kept separate to avoid full-state writes on doc click).
            try {
                const rawAccess = localStorage.getItem(DOC_ACCESS_META_KEY);
                if (rawAccess) {
                    const accessMap = JSON.parse(rawAccess);
                    appData.documents.forEach(doc => {
                        if (accessMap && typeof accessMap[doc.id] === 'string') {
                            doc.lastAccessed = accessMap[doc.id];
                        }
                    });
                }
            } catch (_) {}
        }
        rebuildIndexes();
        if (typeof window !== 'undefined' && typeof window.__markSearchIndexDirty === 'function') {
            window.__markSearchIndexDirty();
        }
    } catch (e) {
        console.error('Failed to load saved data, starting fresh:', e);
        appData = makeEmptyProject();
        rebuildIndexes();
        if (typeof window !== 'undefined' && typeof window.__markSearchIndexDirty === 'function') {
            window.__markSearchIndexDirty();
        }
        // Clear corrupted data
        try { localStorage.removeItem(PROJECT_CACHE_KEY); } catch {}
    }
}

// Save data to storage
// In browser mode, a localStorage snapshot is used as fallback persistence.
// In Electron mode, this updates in-memory state only; explicit save writes QDPX/JSON files.
function saveData(options = {}) {
    const markUnsaved = (Object.prototype.hasOwnProperty.call(options, 'markUnsaved'))
        ? options.markUnsaved
        : true;
    if (markUnsaved === true) appData.hasUnsavedChanges = true;
    if (markUnsaved === false) appData.hasUnsavedChanges = false;
    if (markUnsaved === true) appDataRevision += 1;
    
    if (shouldUseLocalProjectCache()) {
        // Create a copy without large binary data for localStorage
        const storageData = JSON.parse(JSON.stringify(appData));
        storageData.documents.forEach(doc => {
            if (doc.pdfData) {
                // Keep a flag that this is a PDF, but don't store the binary
                doc._hasPdfData = true;
                delete doc.pdfData;
                // Keep pdfPages for text positions, but remove if too large
                if (doc.pdfPages && JSON.stringify(doc.pdfPages).length > 100000) {
                    doc._hasPdfPages = true;
                    delete doc.pdfPages;
                }
            }
        });
        
        localStorage.setItem(PROJECT_CACHE_KEY, JSON.stringify(storageData));
    }

    rebuildIndexes();
    if (typeof window !== 'undefined' && typeof window.__markSearchIndexDirty === 'function') {
        window.__markSearchIndexDirty();
    }
    if (markUnsaved === true && typeof scheduleProjectBackup === 'function') {
        scheduleProjectBackup('state-change');
    }
    if (typeof updateSaveStatus === 'function') updateSaveStatus();
}

function scheduleDocumentAccessMetaSave() {
    if (!shouldUseLocalProjectCache()) return;
    if (docAccessSaveTimer) clearTimeout(docAccessSaveTimer);
    docAccessSaveTimer = setTimeout(() => {
        docAccessSaveTimer = null;
        flushDocumentAccessMetaSave();
    }, 1500);
}

function flushDocumentAccessMetaSave() {
    if (!shouldUseLocalProjectCache()) return;
    if (docAccessSaveTimer) {
        clearTimeout(docAccessSaveTimer);
        docAccessSaveTimer = null;
    }
    try {
        const accessMap = {};
        appData.documents.forEach(doc => {
            if (doc && doc.id && doc.lastAccessed) {
                accessMap[doc.id] = doc.lastAccessed;
            }
        });
        localStorage.setItem(DOC_ACCESS_META_KEY, JSON.stringify(accessMap));
    } catch (_) {}
}

// Undo/Redo support
// Snapshots exclude document content since it's immutable after import.
// This dramatically reduces memory usage for large projects.
// Trade-off: deleting a document cannot be undone via Ctrl+Z.
function saveHistory() {
    const snapshot = JSON.stringify({
        // Store document metadata only, not content
        documentIds: appData.documents.map(d => d.id),
        codes: appData.codes,
        segments: appData.segments,
        memos: appData.memos,
        folders: appData.folders,
        currentDocId: appData.currentDocId,
        filterCodeId: appData.filterCodeId
    });
    
    history.past.push(snapshot);
    if (history.past.length > history.maxLength) {
        history.past.shift();
    }
    history.future = [];
    updateHistoryButtons();
}

function undo() {
    if (history.past.length === 0) return;
    
    // Save current state to future
    const currentSnapshot = JSON.stringify({
        documentIds: appData.documents.map(d => d.id),
        codes: appData.codes,
        segments: appData.segments,
        memos: appData.memos,
        folders: appData.folders,
        currentDocId: appData.currentDocId,
        filterCodeId: appData.filterCodeId
    });
    history.future.push(currentSnapshot);
    
    // Restore from past
    const previousSnapshot = history.past.pop();
    const restored = JSON.parse(previousSnapshot);
    
    // Documents are not restored (content is immutable, structure changes are rare)
    // Only restore codes, segments, memos, folders
    appData.codes = restored.codes;
    appData.segments = restored.segments;
    appData.memos = restored.memos;
    appData.folders = restored.folders || [];
    appData.currentDocId = restored.currentDocId;
    appData.filterCodeId = restored.filterCodeId;
    
    saveData();
    renderAll();
    updateHistoryButtons();
}

function redo() {
    if (history.future.length === 0) return;
    
    // Save current state to past
    const currentSnapshot = JSON.stringify({
        documentIds: appData.documents.map(d => d.id),
        codes: appData.codes,
        segments: appData.segments,
        memos: appData.memos,
        folders: appData.folders,
        currentDocId: appData.currentDocId,
        filterCodeId: appData.filterCodeId
    });
    history.past.push(currentSnapshot);
    
    // Restore from future
    const nextSnapshot = history.future.pop();
    const restored = JSON.parse(nextSnapshot);
    
    appData.codes = restored.codes;
    appData.segments = restored.segments;
    appData.memos = restored.memos;
    appData.folders = restored.folders || [];
    appData.currentDocId = restored.currentDocId;
    appData.filterCodeId = restored.filterCodeId;
    
    saveData();
    renderAll();
    updateHistoryButtons();
}

function updateHistoryButtons() {
    document.getElementById('undoBtn').disabled = history.past.length === 0;
    document.getElementById('redoBtn').disabled = history.future.length === 0;
}
