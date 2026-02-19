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
        cases: [], // {id, name, type, parentId, description, notes, attributes: {}, linkedDocumentIds: [], created, modified}
        variableDefinitions: [], // {id, name, type}
        currentDocId: null,
        selectedCaseId: null,
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

function normalizeSegmentMemoCodeId(memo) {
    if (!memo || typeof memo !== 'object') return '';
    if (memo.type !== 'segment') {
        delete memo.codeId;
        return '';
    }
    const raw = memo.codeId;
    if (typeof raw !== 'string') {
        delete memo.codeId;
        return '';
    }
    const normalized = raw.trim();
    if (!normalized) {
        delete memo.codeId;
        return '';
    }
    memo.codeId = normalized;
    return normalized;
}

function pruneInvalidSegmentCodeMemosForProject(project) {
    if (!project || typeof project !== 'object') return false;
    if (!Array.isArray(project.memos) || !Array.isArray(project.segments) || !Array.isArray(project.codes)) return false;

    const segmentById = new Map(project.segments.map(seg => [seg.id, seg]));
    const validCodeIds = new Set(project.codes.map(code => code.id));
    const before = project.memos.length;

    project.memos = project.memos.filter((memo) => {
        const codeId = normalizeSegmentMemoCodeId(memo);
        if (!memo || memo.type !== 'segment') return true;

        const segment = segmentById.get(memo.targetId);
        if (!segment) return false;

        if (!codeId) return true;
        if (!validCodeIds.has(codeId)) return false;
        if (!Array.isArray(segment.codeIds)) return false;
        return segment.codeIds.includes(codeId);
    });

    return project.memos.length !== before;
}

function normalizeCaseAttributes(rawAttributes) {
    const attrs = (rawAttributes && typeof rawAttributes === 'object') ? rawAttributes : {};
    const out = {};
    Object.entries(attrs).forEach(([rawKey, rawValue]) => {
        const key = String(rawKey || '').trim();
        if (!key) return;
        out[key] = String(rawValue == null ? '' : rawValue);
    });
    return out;
}

function normalizeCasesForProject(rawCases, validDocIds, buildLocalId) {
    const sourceCases = Array.isArray(rawCases) ? rawCases : [];
    const outCases = [];
    const seenCaseIds = new Set();

    sourceCases.forEach((rawCase) => {
        const normalized = (rawCase && typeof rawCase === 'object') ? rawCase : {};
        let id = String(normalized.id || '').trim();
        if (!id || seenCaseIds.has(id)) id = buildLocalId('case');
        seenCaseIds.add(id);

        const legacyDocIds = Array.isArray(normalized.docIds) ? normalized.docIds : [];
        const linkedDocumentIdsRaw = Array.isArray(normalized.linkedDocumentIds) ? normalized.linkedDocumentIds : legacyDocIds;
        const linkedDocumentIds = Array.from(new Set(linkedDocumentIdsRaw.filter((docId) => validDocIds.has(docId))));
        const created = normalized.created || new Date().toISOString();
        const modified = normalized.modified || created;

        outCases.push({
            id,
            name: String(normalized.name || '').trim() || 'Unnamed Case',
            type: String(normalized.type || '').trim(),
            parentId: normalized.parentId ? String(normalized.parentId) : null,
            description: String(normalized.description || '').trim(),
            notes: String(normalized.notes || ''),
            attributes: normalizeCaseAttributes(normalized.attributes),
            linkedDocumentIds,
            created,
            modified,
            expanded: normalized.expanded !== false
        });
    });

    const validCaseIds = new Set(outCases.map((caseItem) => caseItem.id));
    outCases.forEach((caseItem) => {
        if (!caseItem.parentId || !validCaseIds.has(caseItem.parentId) || caseItem.parentId === caseItem.id) {
            caseItem.parentId = null;
        }
    });

    const isCycleForCase = (caseId, parentId) => {
        if (!parentId) return false;
        const visited = new Set([caseId]);
        let cursor = parentId;
        while (cursor) {
            if (visited.has(cursor)) return true;
            visited.add(cursor);
            const parentCase = outCases.find((caseItem) => caseItem.id === cursor);
            if (!parentCase) return false;
            cursor = parentCase.parentId || null;
        }
        return false;
    };

    outCases.forEach((caseItem) => {
        if (isCycleForCase(caseItem.id, caseItem.parentId)) {
            caseItem.parentId = null;
        }
    });

    return outCases;
}

function normaliseProject(p) {
    const d = makeEmptyProject();
    const src = (p && typeof p === 'object') ? p : {};
    const buildLocalId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const out = Object.assign({}, d, src);

    out.documents = Array.isArray(src.documents) ? src.documents : [];
    out.codes = Array.isArray(src.codes) ? src.codes : [];
    out.segments = Array.isArray(src.segments) ? src.segments : [];
    out.memos = Array.isArray(src.memos) ? src.memos : [];
    out.folders = Array.isArray(src.folders) ? src.folders : [];
    out.cases = Array.isArray(src.cases) ? src.cases : [];
    out.variableDefinitions = Array.isArray(src.variableDefinitions) ? src.variableDefinitions : [];
    out.codeViewPresets = Array.isArray(src.codeViewPresets) ? src.codeViewPresets : [];

    const validCodeIds = new Set(out.codes.map(code => code && code.id).filter(Boolean));
    out.codes.forEach((code) => {
        if (!code || !code.parentId) return;
        if (!validCodeIds.has(code.parentId)) code.parentId = null;
    });

    out.scrollPositions = (src.scrollPositions && typeof src.scrollPositions === 'object') ? src.scrollPositions : {};
    out.zoomLevel = Number.isFinite(src.zoomLevel) ? src.zoomLevel : d.zoomLevel;

    out.segments.forEach(seg => {
        if (!seg || typeof seg !== 'object') return;
        if (!seg.created) seg.created = new Date().toISOString();
        if (!seg.modified) seg.modified = seg.created;
        if (seg && seg.pdfRegion) {
            seg.pdfRegion = normalizePdfRegionShape(seg.pdfRegion);
        }
    });

    out.memos.forEach(memo => {
        if (!memo.created) memo.created = new Date().toISOString();
        if (!memo.edited) memo.edited = memo.created;
        if (typeof memo.tag !== 'string') memo.tag = '';
        normalizeSegmentMemoCodeId(memo);
    });

    // Validate currentDocId exists
    if (out.currentDocId && !out.documents.some(doc => doc.id === out.currentDocId)) {
        out.currentDocId = out.documents[0]?.id || null;
    }

    const validDocIds = new Set(out.documents.map(doc => doc && doc.id).filter(Boolean));
    out.documents.forEach((doc) => {
        if (!doc || typeof doc !== 'object') return;
        if (!doc.metadata || typeof doc.metadata !== 'object') doc.metadata = {};
        if (!Array.isArray(doc.caseIds)) {
            doc.caseIds = [];
            return;
        }
        doc.caseIds = doc.caseIds.filter(caseId => typeof caseId === 'string' && caseId.trim() !== '');
    });
    out.cases = normalizeCasesForProject(out.cases, validDocIds, buildLocalId);
    const validCaseIds = new Set(out.cases.map((caseItem) => caseItem.id));

    // Merge legacy document-side links into canonical case-side links.
    const caseById = new Map(out.cases.map((caseItem) => [caseItem.id, caseItem]));
    out.documents.forEach((doc) => {
        if (!doc || !Array.isArray(doc.caseIds)) return;
        doc.caseIds
            .filter((caseId) => validCaseIds.has(caseId))
            .forEach((caseId) => {
                const caseItem = caseById.get(caseId);
                if (!caseItem) return;
                if (!Array.isArray(caseItem.linkedDocumentIds)) caseItem.linkedDocumentIds = [];
                if (!caseItem.linkedDocumentIds.includes(doc.id)) {
                    caseItem.linkedDocumentIds.push(doc.id);
                }
            });
    });

    // Normalize document-side link list from cases so both views are consistent.
    const docCaseMap = new Map();
    out.documents.forEach((doc) => docCaseMap.set(doc.id, []));
    out.cases.forEach((caseItem) => {
        caseItem.linkedDocumentIds = Array.from(new Set((caseItem.linkedDocumentIds || []).filter((docId) => validDocIds.has(docId))));
        caseItem.linkedDocumentIds.forEach((docId) => {
            if (!docCaseMap.has(docId)) return;
            const list = docCaseMap.get(docId);
            if (!list.includes(caseItem.id)) list.push(caseItem.id);
        });
    });
    out.documents.forEach((doc) => {
        if (!doc) return;
        doc.caseIds = docCaseMap.get(doc.id) || [];
    });

    out.variableDefinitions = out.variableDefinitions
        .map((rawVar) => {
            const normalized = (rawVar && typeof rawVar === 'object') ? rawVar : {};
            const name = String(normalized.name || '').trim();
            if (!name) return null;
            const type = String(normalized.type || 'Text').trim() || 'Text';
            return {
                id: normalized.id || buildLocalId('var'),
                name,
                type
            };
        })
        .filter(Boolean);

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
    if (out.selectedCaseId && !out.cases.some(c => c.id === out.selectedCaseId)) {
        out.selectedCaseId = null;
    }

    // Ensure booleans / timestamps
    out.hasUnsavedChanges = !!out.hasUnsavedChanges;
    out.lastSaveTime = out.lastSaveTime || null;

    pruneInvalidSegmentCodeMemosForProject(out);

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

// Escape for HTML attribute values.
function escapeHtmlAttrValue(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Escape for single-quoted JS string literals embedded in HTML attributes.
function escapeJsForSingleQuotedString(text) {
    return String(text == null ? '' : text)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/</g, '\\x3C');
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

function getSegmentMemos(segmentId, codeId = '') {
    const normalizedCodeId = String(codeId || '').trim();
    const allMemos = getMemosForTarget('segment', segmentId);
    if (!normalizedCodeId) return allMemos;
    return allMemos.filter(memo => String(memo?.codeId || '').trim() === normalizedCodeId);
}

function getSegmentMemoCount(segmentId, codeId = '') {
    const normalizedCodeId = String(codeId || '').trim();
    if (!normalizedCodeId) return getMemoCountForTarget('segment', segmentId);
    return getSegmentMemos(segmentId, normalizedCodeId).length;
}

function pruneInvalidSegmentCodeMemos() {
    return pruneInvalidSegmentCodeMemosForProject(appData);
}

function getDocSegmentCountFast(docId) {
    return indexes.segmentCountByDocId[docId] || 0;
}

function getCodeSegmentCountFast(codeId) {
    return indexes.segmentCountByCodeId[codeId] || 0;
}

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
const codeColors = [
    '#5b8fd9', '#8a64d6', '#d16a8e', '#d38452',
    '#4fae8c', '#88a843', '#4e9eb8', '#c97362',
    '#6d79d8', '#d48a4e', '#3ea8a1', '#b56aa5',
    '#9e9a3f', '#5d93c8', '#c27c54', '#5aa66e'
];
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
                if (typeof code.notes !== 'string') code.notes = '';
                if (!code.shortcut) code.shortcut = '';
                if (!code.lastUsed) code.lastUsed = code.created || new Date().toISOString();
            });

            // Normalize annotation metadata for older projects
            appData.memos.forEach(memo => {
                if (!memo.created) memo.created = new Date().toISOString();
                if (!memo.edited) memo.edited = memo.created;
                if (typeof memo.tag !== 'string') memo.tag = '';
                normalizeSegmentMemoCodeId(memo);
            });
            pruneInvalidSegmentCodeMemos();

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
// In Electron mode, this updates in-memory state only; explicit save writes QDPX files.
function saveData(options = {}) {
    const markUnsaved = (Object.prototype.hasOwnProperty.call(options, 'markUnsaved'))
        ? options.markUnsaved
        : true;
    if (markUnsaved === true) appData.hasUnsavedChanges = true;
    if (markUnsaved === false) appData.hasUnsavedChanges = false;
    if (markUnsaved === true) appDataRevision += 1;

    pruneInvalidSegmentCodeMemos();
    
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
        cases: appData.cases,
        variableDefinitions: appData.variableDefinitions,
        currentDocId: appData.currentDocId,
        selectedCaseId: appData.selectedCaseId,
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
        cases: appData.cases,
        variableDefinitions: appData.variableDefinitions,
        currentDocId: appData.currentDocId,
        selectedCaseId: appData.selectedCaseId,
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
    appData.cases = restored.cases || [];
    appData.variableDefinitions = restored.variableDefinitions || [];
    appData.currentDocId = restored.currentDocId;
    appData.selectedCaseId = restored.selectedCaseId || null;
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
        cases: appData.cases,
        variableDefinitions: appData.variableDefinitions,
        currentDocId: appData.currentDocId,
        selectedCaseId: appData.selectedCaseId,
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
    appData.cases = restored.cases || [];
    appData.variableDefinitions = restored.variableDefinitions || [];
    appData.currentDocId = restored.currentDocId;
    appData.selectedCaseId = restored.selectedCaseId || null;
    appData.filterCodeId = restored.filterCodeId;
    
    saveData();
    renderAll();
    updateHistoryButtons();
}

function updateHistoryButtons() {
    document.getElementById('undoBtn').disabled = history.past.length === 0;
    document.getElementById('redoBtn').disabled = history.future.length === 0;
}
