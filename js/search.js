/**
 * Quackdas - Search Functions
 * Boolean search with AND/OR/NOT and wildcards
 */

const globalSearchIndex = {
    dirty: true,
    entries: new Map() // key -> { kind, kindLabel, primaryId, docId, title, searchText }
};
let searchResultsDelegationBound = false;
const GLOBAL_SEARCH_SESSION_STORAGE_PREFIX = 'quackdas-global-search-session-v1:';
const MAX_PERSISTED_GLOBAL_RESULTS = 1000;
const SEARCH_OCR_STATUS_REFRESH_MS = 60 * 1000;
const globalSearchOcrStatus = {
    checked: false,
    missing: false,
    checkedAt: 0,
    pending: null
};

function renderSearchOcrStatus() {
    const statusEl = document.getElementById('searchOcrStatus');
    if (!statusEl) return;
    statusEl.hidden = !(globalSearchOcrStatus.checked && globalSearchOcrStatus.missing);
}

async function refreshSearchOcrStatus() {
    renderSearchOcrStatus();
    const now = Date.now();
    if (globalSearchOcrStatus.checked && (now - globalSearchOcrStatus.checkedAt) < SEARCH_OCR_STATUS_REFRESH_MS) return;
    if (!(window.electronAPI && typeof window.electronAPI.ocrGetStatus === 'function')) return;
    if (globalSearchOcrStatus.pending) {
        await globalSearchOcrStatus.pending;
        return;
    }
    globalSearchOcrStatus.pending = (async () => {
        try {
            const status = await window.electronAPI.ocrGetStatus();
            const installed = status?.ok ? !!status.installed : true;
            globalSearchOcrStatus.missing = !installed;
        } catch (_) {
            globalSearchOcrStatus.missing = false;
        } finally {
            globalSearchOcrStatus.checked = true;
            globalSearchOcrStatus.checkedAt = Date.now();
            globalSearchOcrStatus.pending = null;
            renderSearchOcrStatus();
        }
    })();
    await globalSearchOcrStatus.pending;
}

function initSearchResultsDelegatedHandlers() {
    if (searchResultsDelegationBound) return;
    const list = document.getElementById('searchResultsList');
    if (!list) return;
    list.addEventListener('click', (event) => {
        const item = event.target.closest('.search-result-item[data-kind][data-primary-id][data-doc-id][data-query][data-first-match-index]');
        if (!item) return;
        goToSearchResult(
            item.dataset.kind,
            item.dataset.primaryId,
            item.dataset.docId,
            item.dataset.query,
            item.dataset.firstMatchIndex,
            item.dataset.pageNum
        );
    });
    searchResultsDelegationBound = true;
}

function markSearchIndexDirty() {
    globalSearchIndex.dirty = true;
}

if (typeof window !== 'undefined') {
    window.__markSearchIndexDirty = markSearchIndexDirty;
}

function getSearchIndexEntriesSnapshot() {
    const snapshot = new Map();
    const docs = Array.isArray(appData.documents) ? appData.documents : [];
    const codes = Array.isArray(appData.codes) ? appData.codes : [];
    const segments = Array.isArray(appData.segments) ? appData.segments : [];
    const memos = Array.isArray(appData.memos) ? appData.memos : [];
    const docById = new Map(docs.map(doc => [doc?.id, doc]));
    const codeById = new Map(codes.map(code => [code?.id, code]));
    const segmentById = new Map(segments.map(segment => [segment?.id, segment]));

    docs.forEach(doc => {
        snapshot.set(`d:${doc.id}`, {
            kind: 'document',
            kindLabel: 'Document',
            primaryId: doc.id,
            docId: doc.id,
            title: doc.title || 'Untitled document',
            searchText: String(doc.content || '')
        });
    });

    codes.forEach(code => {
        const desc = String(code.description || '').trim();
        if (!desc) return;
        snapshot.set(`c:${code.id}`, {
            kind: 'code',
            kindLabel: 'Code description',
            primaryId: code.id,
            docId: '',
            title: `Code: ${code.name || 'Untitled code'}`,
            searchText: desc
        });
    });

    memos.forEach(memo => {
        const searchable = [memo.content || '', memo.tag || ''].join(' ').trim();
        if (!searchable) return;

        let targetLabel = 'Project';
        let docId = '';
        if (memo.type === 'document') {
            const doc = docById.get(memo.targetId);
            targetLabel = doc ? doc.title : 'Document';
            docId = memo.targetId || '';
        } else if (memo.type === 'code') {
            const code = codeById.get(memo.targetId);
            targetLabel = code ? code.name : 'Code';
        } else if (memo.type === 'segment') {
            const segment = segmentById.get(memo.targetId);
            const doc = segment ? docById.get(segment.docId) : null;
            const memoCodeId = String(memo.codeId || '').trim();
            const linkedCode = memoCodeId ? codeById.get(memoCodeId) : null;
            if (doc && linkedCode) {
                targetLabel = `${doc.title} • ${linkedCode.name}`;
            } else if (doc) {
                targetLabel = doc.title;
            } else if (linkedCode) {
                targetLabel = linkedCode.name;
            } else {
                targetLabel = 'Segment';
            }
            docId = segment?.docId || '';
        }

        snapshot.set(`m:${memo.id}`, {
            kind: 'annotation',
            kindLabel: 'Annotation',
            primaryId: memo.id,
            docId,
            title: `Annotation${memo.tag ? ` [${memo.tag}]` : ''}: ${targetLabel}`,
            searchText: searchable
        });
    });

    return snapshot;
}

function ensureSearchIndexCurrent() {
    if (!globalSearchIndex.dirty) return;
    const snapshot = getSearchIndexEntriesSnapshot();

    // Remove entries that no longer exist
    Array.from(globalSearchIndex.entries.keys()).forEach(key => {
        if (!snapshot.has(key)) {
            globalSearchIndex.entries.delete(key);
        }
    });

    // Add/update changed entries
    snapshot.forEach((next, key) => {
        const prev = globalSearchIndex.entries.get(key);
        if (!prev ||
            prev.searchText !== next.searchText ||
            prev.title !== next.title ||
            prev.docId !== next.docId ||
            prev.kind !== next.kind ||
            prev.kindLabel !== next.kindLabel) {
            globalSearchIndex.entries.set(key, next);
        }
    });

    globalSearchIndex.dirty = false;
}

function tokenizeSearchQuery(query) {
    const src = String(query || '');
    const tokens = [];
    let current = '';
    let inQuotes = false;

    const pushToken = (text, quoted) => {
        const value = String(text || '').trim();
        if (!value) return;
        tokens.push({ text: value, quoted: !!quoted });
    };

    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === '"') {
            if (inQuotes) {
                pushToken(current, true);
                current = '';
                inQuotes = false;
            } else {
                pushToken(current, false);
                current = '';
                inQuotes = true;
            }
            continue;
        }
        if (!inQuotes && /\s/.test(ch)) {
            pushToken(current, false);
            current = '';
            continue;
        }
        current += ch;
    }

    pushToken(current, inQuotes);
    return tokens;
}

function isBooleanOperatorToken(token, operator) {
    if (!token || token.quoted) return false;
    return String(token.text || '').toUpperCase() === operator;
}

function isAnyBooleanOperatorToken(token) {
    return (
        isBooleanOperatorToken(token, 'AND') ||
        isBooleanOperatorToken(token, 'OR') ||
        isBooleanOperatorToken(token, 'NOT')
    );
}

function isSingleLetterGlobalSearchQuery(query) {
    const normalized = String(query || '').trim();
    if (!normalized) return false;
    const valueTokens = tokenizeSearchQuery(normalized).filter(token => !isAnyBooleanOperatorToken(token));
    if (valueTokens.length !== 1) return false;
    const core = String(valueTokens[0].text || '')
        .replace(/\*/g, '')
        .replace(/\s+/g, '')
        .trim();
    return core.length === 1;
}

function showGlobalSearchQueryValidationMessage(message) {
    const list = document.getElementById('searchResultsList');
    if (!list) return;
    list.innerHTML = `<p style="color: var(--text-secondary); text-align: center; padding: 40px;">${escapeHtml(message)}</p>`;
}

function getGlobalSearchSessionStorageKey() {
    const projectName = String(appData?.projectName || 'untitled-project').trim().toLowerCase();
    const docSignature = Array.isArray(appData?.documents)
        ? appData.documents
            .map((doc) => `${String(doc?.id || '')}:${String(doc?.type || 'text')}:${String(doc?.title || '')}`)
            .join('|')
        : '';
    return `${GLOBAL_SEARCH_SESSION_STORAGE_PREFIX}${projectName}:${docSignature.length}`;
}

function sanitizeGlobalSearchResultForPersistence(result) {
    if (!result || typeof result !== 'object') return null;
    const snippets = Array.isArray(result.snippets)
        ? result.snippets.slice(0, 3).map((snippet) => ({
            text: String(snippet?.text || '').slice(0, 600)
        }))
        : [];
    return {
        kind: String(result.kind || ''),
        kindLabel: String(result.kindLabel || ''),
        primaryId: String(result.primaryId || ''),
        docId: String(result.docId || ''),
        title: String(result.title || ''),
        groupTitle: String(result.groupTitle || ''),
        matchCount: Number.isFinite(result.matchCount) ? result.matchCount : 0,
        hitOrdinal: Number.isFinite(result.hitOrdinal) ? result.hitOrdinal : null,
        matchIndex: Number.isFinite(result.matchIndex) ? result.matchIndex : null,
        pageNum: normalizePdfPageNumber(result.pageNum),
        snippets,
        firstMatchIndex: Number.isFinite(result.firstMatchIndex) ? result.firstMatchIndex : -1
    };
}

function persistGlobalSearchSession(query, results) {
    if (typeof localStorage === 'undefined') return;
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return;

    const payload = {
        query: normalizedQuery,
        savedAt: new Date().toISOString(),
        results: Array.isArray(results)
            ? results.slice(0, MAX_PERSISTED_GLOBAL_RESULTS).map(sanitizeGlobalSearchResultForPersistence).filter(Boolean)
            : []
    };
    try {
        localStorage.setItem(getGlobalSearchSessionStorageKey(), JSON.stringify(payload));
    } catch (_) {}
}

function loadPersistedGlobalSearchSession() {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(getGlobalSearchSessionStorageKey());
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const query = String(parsed?.query || '').trim();
        if (!query) return null;
        const results = Array.isArray(parsed?.results) ? parsed.results.map(sanitizeGlobalSearchResultForPersistence).filter(Boolean) : [];
        return { query, results };
    } catch (_) {
        return null;
    }
}

function openSearchModal() {
    if (typeof closeInPageSearch === 'function') closeInPageSearch();
    if (appData.documents.length === 0) {
        alert('No documents to search. Import or paste a document first.');
        return;
    }
    
    const persistedSession = loadPersistedGlobalSearchSession();

    // Show modal with saved search if available
    const modal = document.getElementById('searchResultsModal');
    const summary = document.getElementById('searchSummary');
    const list = document.getElementById('searchResultsList');
    refreshSearchOcrStatus();

    if (persistedSession && persistedSession.query) {
        showSearchResults(persistedSession.query, persistedSession.results);
        setTimeout(() => {
            const input = document.getElementById('modalSearchInput');
            if (input) input.focus();
        }, 50);
        return;
    }
    
    summary.innerHTML = `
        <span class="search-summary-label">Search</span>
        <div class="search-summary-input-wrapper">
            <svg class="toolbar-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" class="search-summary-input" id="modalSearchInput" value="" placeholder="Enter search terms...">
        </div>
    `;
    
    list.innerHTML = '<p style="color: var(--text-tertiary); text-align: center; padding: 40px;">Type to search across documents, code descriptions, and annotations</p>';
    
    // Add enter key handler
    document.getElementById('modalSearchInput').addEventListener('keydown', async function(e) {
        if (e.key === 'Enter') {
            const query = this.value.trim();
            if (query) {
                if (isSingleLetterGlobalSearchQuery(query)) {
                    showGlobalSearchQueryValidationMessage('Search must be at least 2 characters.');
                    return;
                }
                const results = await searchAllDocuments(query);
                showSearchResults(query, results);
            }
        }
    });
    
    modal.classList.add('show');
    
    // Focus the input
    setTimeout(() => {
        document.getElementById('modalSearchInput').focus();
    }, 50);
}

async function performSearch(query) {
    if (appData.documents.length === 0) {
        alert('No documents to search.');
        return;
    }
    if (isSingleLetterGlobalSearchQuery(query)) {
        showGlobalSearchQueryValidationMessage('Search must be at least 2 characters.');
        return;
    }
    
    const results = await searchAllDocuments(query);
    showSearchResults(query, results);
}

function parseSearchQuery(query) {
    // Parse Boolean operators and wildcards
    // Returns an object with { type: 'AND'|'OR'|'SIMPLE', terms: [...], notTerms: [...] }

    const tokens = tokenizeSearchQuery(query);
    const terms = [];
    const notTerms = [];
    if (tokens.length === 0) return { type: 'SIMPLE', terms, notTerms };

    const hasOr = tokens.some(token => isBooleanOperatorToken(token, 'OR'));
    const hasAnd = tokens.some(token => isBooleanOperatorToken(token, 'AND'));
    const valueTokenCount = tokens.filter(token => !isAnyBooleanOperatorToken(token)).length;

    let type = 'SIMPLE';
    if (hasOr) type = 'OR';
    else if (hasAnd || valueTokenCount > 1) type = 'AND';

    let pendingNot = false;
    tokens.forEach((token) => {
        if (isBooleanOperatorToken(token, 'NOT')) {
            pendingNot = true;
            return;
        }
        if (isBooleanOperatorToken(token, 'AND') || isBooleanOperatorToken(token, 'OR')) {
            pendingNot = false;
            return;
        }
        const pattern = convertWildcardToRegex(token.text);
        if (!pattern) return;
        if (pendingNot) {
            notTerms.push(pattern);
            pendingNot = false;
        } else {
            terms.push(pattern);
        }
    });

    if (terms.length === 0 && notTerms.length > 0) type = 'AND';
    return { type, terms, notTerms };
}

function convertWildcardToRegex(term) {
    // Escape regex metacharacters except *, then convert * to .*
    const escaped = term.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(/\*/g, '.*');
}

function normalizePdfPageNumber(value) {
    const pageNum = Number.parseInt(value, 10);
    if (!Number.isFinite(pageNum)) return null;
    return pageNum >= 1 ? pageNum : null;
}

function resolvePdfPageNumberForSearch(pageInfo, index) {
    const candidates = [
        pageInfo?.pageNum,
        pageInfo?.pageNumber,
        pageInfo?.page
    ];
    for (const candidate of candidates) {
        const normalized = normalizePdfPageNumber(candidate);
        if (normalized) return normalized;
        const parsed = Number.parseInt(candidate, 10);
        if (Number.isFinite(parsed) && parsed === 0) {
            return index + 1; // legacy 0-based page numbering
        }
    }
    return index + 1; // fallback to page order in array
}

function getPdfPageForCharPos(doc, charPos) {
    if (!doc || doc.type !== 'pdf') return null;
    const target = Math.max(0, Number.parseInt(charPos, 10) || 0);

    // Best source: absolute text positions collected at PDF import time.
    if (Array.isArray(doc.pdfTextPositions) && doc.pdfTextPositions.length > 0) {
        let selectedPage = null;
        for (const pos of doc.pdfTextPositions) {
            const start = Number(pos?.start);
            if (!Number.isFinite(start)) continue;
            if (start > target) break;
            const pageNum = normalizePdfPageNumber(pos?.pageNum);
            if (pageNum) selectedPage = pageNum;
        }
        if (selectedPage) return selectedPage;
    }

    if (!Array.isArray(doc.pdfPages) || doc.pdfPages.length === 0) return 1;

    const rangesFromOffsets = [];
    for (let idx = 0; idx < doc.pdfPages.length; idx++) {
        const pageInfo = doc.pdfPages[idx];
        if (!pageInfo || !Array.isArray(pageInfo.textItems) || pageInfo.textItems.length === 0) continue;
        let start = Infinity;
        let end = -Infinity;
        for (const item of pageInfo.textItems) {
            const s = Number(item?.start ?? item?.startIndex);
            const e = Number(item?.end ?? item?.endIndex);
            if (Number.isFinite(s) && s < start) start = s;
            if (Number.isFinite(e) && e > end) end = e;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const pageNum = resolvePdfPageNumberForSearch(pageInfo, idx);
        if (!pageNum) continue;
        rangesFromOffsets.push({
            pageNum,
            start,
            end: Math.max(start, end)
        });
    }

    if (rangesFromOffsets.length > 0) {
        rangesFromOffsets.sort((a, b) => a.start - b.start);
        let selected = rangesFromOffsets[0];
        for (const range of rangesFromOffsets) {
            if (target < range.start) break;
            selected = range;
            if (target <= range.end) break;
        }
        return selected.pageNum;
    }

    let cursor = 0;
    for (let idx = 0; idx < doc.pdfPages.length; idx++) {
        const pageInfo = doc.pdfPages[idx];
        let pageLength = 0;
        if (Array.isArray(pageInfo?.textItems)) {
            for (const item of pageInfo.textItems) {
                const textValue = (item?.text ?? item?.str ?? '');
                pageLength += String(textValue).length;
            }
        }
        const pageNum = resolvePdfPageNumberForSearch(pageInfo, idx);
        if (target <= cursor + pageLength) return pageNum;
        cursor += pageLength + 2; // '\n\n' page break marker
    }

    return resolvePdfPageNumberForSearch(doc.pdfPages[doc.pdfPages.length - 1], doc.pdfPages.length - 1);
}

function buildPdfSearchPageRanges(doc) {
    if (!doc || doc.type !== 'pdf' || !Array.isArray(doc.pdfPages) || doc.pdfPages.length === 0) return [];
    const ranges = [];

    doc.pdfPages.forEach((pageInfo, idx) => {
        const pageNum = resolvePdfPageNumberForSearch(pageInfo, idx);
        if (!pageNum) return;

        const textItems = Array.isArray(pageInfo?.textItems) ? pageInfo.textItems : [];
        let start = Infinity;
        let end = -Infinity;
        textItems.forEach((item) => {
            const s = Number(item?.start ?? item?.startIndex);
            const e = Number(item?.end ?? item?.endIndex);
            if (Number.isFinite(s) && s < start) start = s;
            if (Number.isFinite(e) && e > end) end = e;
        });

        let text = '';
        let baseStart = 0;
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start && typeof doc.content === 'string') {
            baseStart = Math.max(0, Math.floor(start));
            const safeEnd = Math.min(doc.content.length, Math.floor(end));
            text = doc.content.slice(baseStart, safeEnd);
        } else {
            baseStart = getPdfPageTextOffset(doc, pageNum);
            text = textItems.map((item) => String(item?.text || item?.str || '')).join(' ');
        }

        ranges.push({ pageNum, start: baseStart, text });
    });

    return ranges;
}

async function searchAllDocuments(query) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return [];
    if (isSingleLetterGlobalSearchQuery(normalizedQuery)) return [];

    ensureSearchIndexCurrent();
    const parsed = parseSearchQuery(normalizedQuery);
    const results = [];
    
    // Pre-compile all regex patterns once (avoid recompilation per document)
    const notRegexes = parsed.notTerms.map(term => new RegExp(term, 'gi'));
    const termRegexes = parsed.terms.map(term => new RegExp(term, 'gi'));

    const collectMatchData = (text) => {
        const sourceText = String(text || '');
        let matches = true;
        let matchCount = 0;
        let firstMatchIndex = -1;
        const mentions = [];
        const addMention = (matchIndex, matchLength) => {
            const idx = Number.isFinite(matchIndex) ? matchIndex : -1;
            if (idx < 0) return;
            if (firstMatchIndex === -1 || idx < firstMatchIndex) firstMatchIndex = idx;
            const safeLen = Math.max(1, Number.isFinite(matchLength) ? matchLength : 1);
            const start = Math.max(0, idx - 50);
            const end = Math.min(sourceText.length, idx + safeLen + 50);
            let snippet = sourceText.substring(start, end);
            if (start > 0) snippet = '...' + snippet;
            if (end < sourceText.length) snippet += '...';
            mentions.push({ index: idx, snippet });
        };

        for (const regex of notRegexes) {
            regex.lastIndex = 0;
            if (regex.test(sourceText)) {
                matches = false;
                break;
            }
        }
        if (!matches) return { matches: false, matchCount: 0, snippets: [], mentions: [], firstMatchIndex: -1 };

        if (parsed.type === 'AND' || parsed.type === 'SIMPLE') {
            for (const regex of termRegexes) {
                regex.lastIndex = 0;
                const termMatches = sourceText.match(regex);
                if (!termMatches) {
                    matches = false;
                    break;
                }
                matchCount += termMatches.length;
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(sourceText)) !== null) {
                    addMention(match.index, String(match[0] || '').length);
                }
            }
        } else if (parsed.type === 'OR') {
            let anyMatch = false;
            for (const regex of termRegexes) {
                regex.lastIndex = 0;
                const termMatches = sourceText.match(regex);
                if (!termMatches) continue;
                anyMatch = true;
                matchCount += termMatches.length;
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(sourceText)) !== null) {
                    addMention(match.index, String(match[0] || '').length);
                }
            }
            matches = anyMatch;
        }

        if (!(parsed.terms.length > 0 || parsed.notTerms.length > 0)) {
            matches = false;
        }
        mentions.sort((a, b) => a.index - b.index);
        const snippets = mentions.slice(0, 3).map((m) => ({ text: m.snippet }));
        return { matches, matchCount, snippets, mentions, firstMatchIndex };
    };

    const indexEntries = Array.from(globalSearchIndex.entries.values());
    for (const entry of indexEntries) {
        const result = collectMatchData(entry.searchText);
        if (!result.matches) continue;
        if (entry.kind === 'document') {
            const doc = appData.documents.find(d => d.id === entry.primaryId);
            const isPdfDoc = !!(doc && doc.type === 'pdf');
            if (isPdfDoc) {
                const pageRanges = buildPdfSearchPageRanges(doc);
                let emitted = 0;
                pageRanges.forEach((pageRange) => {
                    const pageResult = collectMatchData(pageRange.text);
                    if (!pageResult.matches || !Array.isArray(pageResult.mentions)) return;
                    pageResult.mentions.forEach((mention, pageHitIndex) => {
                        const localIdx = Number.isFinite(mention.index) ? mention.index : -1;
                        const globalIdx = localIdx >= 0 ? (pageRange.start + localIdx) : pageRange.start;
                        results.push({
                            kind: entry.kind,
                            kindLabel: 'Document hit',
                            primaryId: entry.primaryId,
                            docId: entry.docId || entry.primaryId || '',
                            title: entry.title,
                            groupTitle: entry.title,
                            matchCount: pageResult.matchCount,
                            hitOrdinal: pageHitIndex + 1,
                            matchIndex: globalIdx,
                            pageNum: normalizePdfPageNumber(pageRange.pageNum),
                            snippets: [{ text: mention.snippet }],
                            firstMatchIndex: globalIdx
                        });
                        emitted += 1;
                    });
                });
                if (emitted > 0) continue;
            }

            let resolvedPages = [];
            if (
                isPdfDoc &&
                typeof pdfResolvePageForCharPos === 'function' &&
                Array.isArray(result.mentions) &&
                result.mentions.length > 0
            ) {
                resolvedPages = await Promise.all(
                    result.mentions.map((mention) => pdfResolvePageForCharPos(doc, mention.index, {
                        allowLive: true,
                        allowBinaryLoad: true
                    }))
                );
            }
            result.mentions.forEach((mention, index) => {
                const resolved = normalizePdfPageNumber(resolvedPages[index]);
                results.push({
                    kind: entry.kind,
                    kindLabel: 'Document hit',
                    primaryId: entry.primaryId,
                    docId: entry.docId || entry.primaryId || '',
                    title: entry.title,
                    groupTitle: entry.title,
                    matchCount: result.matchCount,
                    hitOrdinal: index + 1,
                    matchIndex: Number.isFinite(mention.index) ? mention.index : -1,
                    pageNum: isPdfDoc ? (resolved || getPdfPageForCharPos(doc, mention.index)) : null,
                    snippets: [{ text: mention.snippet }],
                    firstMatchIndex: Number.isFinite(mention.index) ? mention.index : -1
                });
            });
            continue;
        }
        results.push({
            kind: entry.kind,
            kindLabel: entry.kindLabel,
            primaryId: entry.primaryId,
            docId: entry.docId || '',
            title: entry.title,
            matchCount: result.matchCount,
            snippets: result.snippets,
            firstMatchIndex: Number.isFinite(result.firstMatchIndex) ? result.firstMatchIndex : -1
        });
    }
    
    // Sort by document then hit position for document hits; others by match count desc.
    results.sort((a, b) => {
        if (a.kind === 'document' && b.kind === 'document') {
            const titleCmp = String(a.groupTitle || a.title || '').localeCompare(String(b.groupTitle || b.title || ''));
            if (titleCmp !== 0) return titleCmp;
            return (a.matchIndex || 0) - (b.matchIndex || 0);
        }
        if (a.kind === 'document') return -1;
        if (b.kind === 'document') return 1;
        return (b.matchCount || 0) - (a.matchCount || 0);
    });
    
    return results;
}

function showSearchResults(query, results) {
    const modal = document.getElementById('searchResultsModal');
    const summary = document.getElementById('searchSummary');
    const list = document.getElementById('searchResultsList');
    refreshSearchOcrStatus();
    
    // Build combined regex for highlighting
    const parsed = parseSearchQuery(query);
    const highlightPatterns = parsed.terms.join('|');
    
    // Create search bar in summary.
    summary.innerHTML = `
        <span class="search-summary-label">Found ${results.length} result${results.length !== 1 ? 's' : ''} for</span>
        <div class="search-summary-input-wrapper">
            <svg class="toolbar-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" class="search-summary-input" id="modalSearchInput" value="${escapeHtmlAttrValue(query)}" placeholder="Refine search...">
        </div>
    `;
    
    // Focus the input
    setTimeout(() => {
        const input = document.getElementById('modalSearchInput');
        if (input) {
            input.onkeydown = handleSearchInputKeydown;
            input.focus();
            input.select();
        }
    }, 50);
    
    const highlightSnippet = (text) => {
        if (highlightPatterns) {
            const regex = new RegExp(`(${highlightPatterns})`, 'gi');
            return escapeHtml(String(text || '')).replace(regex, '<mark>$1</mark>');
        }
        return escapeHtml(String(text || ''));
    };
    const renderResultItem = (result, snippetHtml, countLabel) => {
        const firstMatchIndex = Number.isFinite(result.firstMatchIndex) ? result.firstMatchIndex : -1;
        const pageNum = normalizePdfPageNumber(result.pageNum);
        return `
            <div class="search-result-item"
                 data-kind="${escapeHtmlAttrValue(result.kind)}"
                 data-primary-id="${escapeHtmlAttrValue(result.primaryId)}"
                 data-doc-id="${escapeHtmlAttrValue(result.docId || '')}"
                 data-query="${escapeHtmlAttrValue(encodeURIComponent(query))}"
                 data-first-match-index="${escapeHtmlAttrValue(String(firstMatchIndex))}"
                 data-page-num="${escapeHtmlAttrValue(String(pageNum || ''))}">
                <div class="search-result-title">
                    ${escapeHtml(result.title)}
                    <span class="search-result-count">${escapeHtml(countLabel)}</span>
                </div>
                <div class="search-result-snippet">${snippetHtml || '<em>No preview available</em>'}</div>
            </div>
        `;
    };

    if (results.length === 0) {
        list.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">No documents match your search.</p>';
    } else {
        const documentResults = results.filter(r => r.kind === 'document');
        const nonDocumentResults = results.filter(r => r.kind !== 'document');

        const documentGroups = new Map();
        documentResults.forEach((result) => {
            const key = String(result.primaryId || '');
            if (!documentGroups.has(key)) {
                documentGroups.set(key, {
                    title: result.groupTitle || result.title || 'Untitled document',
                    items: []
                });
            }
            documentGroups.get(key).items.push(result);
        });

        let html = '';
        documentGroups.forEach((group) => {
            html += `
                <div class="search-result-group-title">
                    ${escapeHtml(group.title)}
                    <span class="search-result-group-count">${group.items.length} hit${group.items.length !== 1 ? 's' : ''}</span>
                </div>
            `;
            group.items.forEach((result, idx) => {
                const snippet = Array.isArray(result.snippets) && result.snippets[0] ? result.snippets[0].text : '';
                const safePageNum = normalizePdfPageNumber(result.pageNum);
                const approximatePage = !!(safePageNum && safePageNum > 100);
                const pageLabel = safePageNum
                    ? `page ${approximatePage ? '~' : ''}${safePageNum}`
                    : null;
                const label = pageLabel
                    ? `Document · ${pageLabel} · hit ${idx + 1}/${group.items.length}`
                    : `Document · hit ${idx + 1}/${group.items.length}`;
                html += renderResultItem(
                    result,
                    highlightSnippet(snippet),
                    label
                );
            });
        });

        if (nonDocumentResults.length > 0) {
            html += '<div class="search-result-group-title">Other matches</div>';
            nonDocumentResults.forEach((result) => {
                const highlightedSnippets = (Array.isArray(result.snippets) ? result.snippets : [])
                    .map(s => highlightSnippet(s.text))
                    .join('<br>');
                html += renderResultItem(
                    result,
                    highlightedSnippets,
                    `${result.kindLabel} · ${result.matchCount} match${result.matchCount !== 1 ? 'es' : ''}`
                );
            });
        }

        list.innerHTML = html;
    }
    
    modal.classList.add('show');
    persistGlobalSearchSession(query, results);
}

async function handleSearchInputKeydown(e) {
    if (e.key === 'Enter') {
        const newQuery = e.target.value.trim();
        if (newQuery) {
            if (isSingleLetterGlobalSearchQuery(newQuery)) {
                showGlobalSearchQueryValidationMessage('Search must be at least 2 characters.');
                return;
            }
            const newResults = await searchAllDocuments(newQuery);
            showSearchResults(newQuery, newResults);
        }
    }
}

function closeSearchResults() {
    document.getElementById('searchResultsModal').classList.remove('show');
}

let inPageSearchState = {
    query: '',
    marks: [],
    activeIndex: -1
};

function getInPageSearchRoot() {
    return document.getElementById('documentContent');
}

function updateInPageSearchCount() {
    const countEl = document.getElementById('inPageSearchCount');
    if (!countEl) return;
    const total = inPageSearchState.marks.length;
    const current = total > 0 ? (inPageSearchState.activeIndex + 1) : 0;
    countEl.textContent = `${current}/${total}`;
}

function clearInPageSearchHighlights() {
    const root = getInPageSearchRoot();
    if (!root) return;
    const marks = root.querySelectorAll('mark.in-page-search-mark');
    marks.forEach(mark => {
        const text = document.createTextNode(mark.textContent || '');
        mark.replaceWith(text);
    });
    root.normalize();
    inPageSearchState.marks = [];
    inPageSearchState.activeIndex = -1;
    updateInPageSearchCount();
}

function setActiveInPageSearchMatch(index, options = {}) {
    const shouldScroll = options.scroll !== false;
    if (!inPageSearchState.marks.length) {
        inPageSearchState.activeIndex = -1;
        updateInPageSearchCount();
        return;
    }
    const total = inPageSearchState.marks.length;
    inPageSearchState.activeIndex = ((index % total) + total) % total;
    inPageSearchState.marks.forEach((mark, i) => {
        mark.classList.toggle('active', i === inPageSearchState.activeIndex);
    });
    const active = inPageSearchState.marks[inPageSearchState.activeIndex];
    if (active && shouldScroll) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateInPageSearchCount();
}

function applyInPageSearch(query, options = {}) {
    const skipInitialScroll = !!options.skipInitialScroll;
    const root = getInPageSearchRoot();
    if (!root) return;
    const wasQueryActive = String(inPageSearchState.query || '').trim().length > 0;
    const q = String(query || '').trim();
    const isQueryActive = q.length > 0;

    if (
        appData.filterCodeId &&
        typeof codeViewUiState !== 'undefined' &&
        codeViewUiState &&
        codeViewUiState.mode === 'segments' &&
        wasQueryActive !== isQueryActive &&
        typeof renderCurrentDocument === 'function'
    ) {
        renderCurrentDocument();
    }

    clearInPageSearchHighlights();
    inPageSearchState.query = q;
    if (!q) return;

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const markTextNodesIn = (container) => {
        const regex = new RegExp(escaped, 'gi');
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const p = node.parentElement;
                if (!p) return NodeFilter.FILTER_ACCEPT;
                if (p.closest && p.closest('.code-actions, .memo-indicator')) return NodeFilter.FILTER_REJECT;
                if (p.tagName === 'MARK') return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);

        textNodes.forEach(node => {
            const text = node.nodeValue || '';
            if (!text) return;
            regex.lastIndex = 0;
            if (!regex.test(text)) return;
            regex.lastIndex = 0;

            const frag = document.createDocumentFragment();
            let last = 0;
            let match;
            while ((match = regex.exec(text)) !== null) {
                if (match.index > last) {
                    frag.appendChild(document.createTextNode(text.substring(last, match.index)));
                }
                const mark = document.createElement('mark');
                mark.className = 'in-page-search-mark';
                mark.textContent = match[0];
                frag.appendChild(mark);
                inPageSearchState.marks.push(mark);
                last = regex.lastIndex;
            }
            if (last < text.length) {
                frag.appendChild(document.createTextNode(text.substring(last)));
            }
            node.parentNode.replaceChild(frag, node);
        });
    };

    if (appData.filterCodeId) {
        const targets = Array.from(root.querySelectorAll('.filter-snippet .coded-segment, .filter-snippet .filter-snippet-memo'));
        targets.forEach(markTextNodesIn);
    } else {
        markTextNodesIn(root);
    }

    setActiveInPageSearchMatch(0, { scroll: !skipInitialScroll });
}

function openInPageSearch() {
    const currentDoc = appData.documents.find(d => d.id === appData.currentDocId);
    if (currentDoc && currentDoc.type === 'pdf') {
        closeInPageSearch();
        return;
    }
    const bar = document.getElementById('inPageSearchBar');
    const input = document.getElementById('inPageSearchInput');
    if (!bar || !input) return;
    bar.classList.add('show');

    if (!input.dataset.bound) {
        input.addEventListener('input', () => applyInPageSearch(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                inPageSearchPrev();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                inPageSearchNext();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeInPageSearch();
            }
        });
        input.dataset.bound = '1';
    }

    input.focus();
    input.select();
    if (input.value.trim()) {
        applyInPageSearch(input.value.trim(), { skipInitialScroll: true });
    } else {
        updateInPageSearchCount();
    }
}

function closeInPageSearch() {
    const hadActiveQuery = String(inPageSearchState.query || '').trim().length > 0;
    const bar = document.getElementById('inPageSearchBar');
    if (bar) bar.classList.remove('show');
    clearInPageSearchHighlights();
    if (
        hadActiveQuery &&
        appData.filterCodeId &&
        typeof codeViewUiState !== 'undefined' &&
        codeViewUiState &&
        codeViewUiState.mode === 'segments' &&
        typeof renderCurrentDocument === 'function'
    ) {
        renderCurrentDocument();
    }
}

function inPageSearchNext() {
    if (!inPageSearchState.marks.length) return;
    setActiveInPageSearchMatch(inPageSearchState.activeIndex + 1);
}

function inPageSearchPrev() {
    if (!inPageSearchState.marks.length) return;
    setActiveInPageSearchMatch(inPageSearchState.activeIndex - 1);
}

function refreshInPageSearchAfterRender() {
    const bar = document.getElementById('inPageSearchBar');
    const input = document.getElementById('inPageSearchInput');
    if (!bar || !bar.classList.contains('show') || !input) return;
    applyInPageSearch(input.value || '');
}

function highlightSearchTermsInCurrentDocument(query) {
    const content = document.getElementById('documentContent');
    if (!content) return;

    const parsed = parseSearchQuery(query);
    if (parsed.terms.length === 0) return;

    const highlightPatterns = parsed.terms.join('|');
    const regex = new RegExp(highlightPatterns, 'gi');

    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const p = node.parentElement;
            if (!p) return NodeFilter.FILTER_ACCEPT;
            if (p.classList.contains('memo-indicator') || p.classList.contains('code-actions')) {
                return NodeFilter.FILTER_REJECT;
            }
            if (p.closest && p.closest('.code-actions, .memo-indicator')) {
                return NodeFilter.FILTER_REJECT;
            }
            if (p.tagName === 'MARK') return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    const textNodes = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }

    let firstMark = null;
    textNodes.forEach(node => {
        const text = node.nodeValue;
        if (!regex.test(text)) return;
        regex.lastIndex = 0;

        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                frag.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            }
            const mark = document.createElement('mark');
            mark.style.background = '#fff3cd';
            mark.style.padding = '1px 2px';
            mark.style.borderRadius = '2px';
            mark.textContent = match[0];
            frag.appendChild(mark);
            if (!firstMark) firstMark = mark;
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < text.length) {
            frag.appendChild(document.createTextNode(text.substring(lastIndex)));
        }
        node.parentNode.replaceChild(frag, node);
    });

    if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    setTimeout(() => {
        const marks = content.querySelectorAll('mark');
        marks.forEach(mark => {
            const text = document.createTextNode(mark.textContent);
            mark.parentNode.replaceChild(text, mark);
        });
    }, 5000);
}

function goToSearchResult(kind, primaryId, docId, encodedQuery, firstMatchIndexRaw = '-1', pageNumRaw = '') {
    const query = decodeURIComponent(encodedQuery || '');
    const firstMatchIndex = Number.parseInt(firstMatchIndexRaw, 10);
    const pageNum = normalizePdfPageNumber(pageNumRaw);
    closeSearchResults();

    if (kind === 'document') {
        const doc = appData.documents.find(d => d.id === primaryId);
        if (doc && doc.type === 'pdf') {
            const isSamePdfContext = (
                appData.currentDocId === primaryId &&
                !appData.filterCodeId &&
                !appData.selectedCaseId
            );
            if (!isSamePdfContext) {
                selectDocument(primaryId);
            }
            if (pageNum && typeof pdfGoToPage === 'function') {
                const selectedDoc = appData.documents.find(d => d.id === primaryId) || doc;
                pdfGoToPage(selectedDoc, pageNum);
            } else if (Number.isFinite(firstMatchIndex) && firstMatchIndex >= 0 && typeof pdfGoToPosition === 'function') {
                const selectedDoc = appData.documents.find(d => d.id === primaryId) || doc;
                pdfGoToPosition(selectedDoc, firstMatchIndex);
            }
        } else {
            selectDocument(primaryId);
            setTimeout(() => highlightSearchTermsInCurrentDocument(query), 100);
        }
        return;
    }

    if (kind === 'code') {
        appData.filterCodeId = primaryId;
        renderAll();
        return;
    }

    if (kind === 'annotation') {
        const memo = appData.memos.find(m => m.id === primaryId);
        if (!memo) return;

        if (memo.type === 'code' && memo.targetId && appData.codes.some(c => c.id === memo.targetId)) {
            appData.filterCodeId = memo.targetId;
            renderAll();
            return;
        }
        if (memo.type === 'document' && memo.targetId && appData.documents.some(d => d.id === memo.targetId)) {
            selectDocument(memo.targetId);
            const doc = appData.documents.find(d => d.id === memo.targetId);
            if (!(doc && doc.type === 'pdf')) {
                setTimeout(() => highlightSearchTermsInCurrentDocument(query), 100);
            }
            return;
        }
        if (memo.type === 'segment' && memo.targetId) {
            const segment = appData.segments.find(s => s.id === memo.targetId);
            if (segment && segment.docId) {
                goToSegmentLocation(segment.docId, segment.id);
                setTimeout(() => highlightSearchTermsInCurrentDocument(query), 120);
            }
        }
    }
}
