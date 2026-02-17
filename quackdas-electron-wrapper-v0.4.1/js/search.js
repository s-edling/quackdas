/**
 * Quackdas - Search Functions
 * Boolean search with AND/OR/NOT and wildcards
 */

const globalSearchIndex = {
    dirty: true,
    entries: new Map() // key -> { kind, kindLabel, primaryId, docId, title, searchText }
};
let searchResultsDelegationBound = false;

function initSearchResultsDelegatedHandlers() {
    if (searchResultsDelegationBound) return;
    const list = document.getElementById('searchResultsList');
    if (!list) return;
    list.addEventListener('click', (event) => {
        const item = event.target.closest('.search-result-item[data-kind][data-primary-id][data-doc-id][data-query]');
        if (!item) return;
        goToSearchResult(
            item.dataset.kind,
            item.dataset.primaryId,
            item.dataset.docId,
            item.dataset.query
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

    appData.documents.forEach(doc => {
        snapshot.set(`d:${doc.id}`, {
            kind: 'document',
            kindLabel: 'Document',
            primaryId: doc.id,
            docId: doc.id,
            title: doc.title || 'Untitled document',
            searchText: String(doc.content || '')
        });
    });

    appData.codes.forEach(code => {
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

    appData.memos.forEach(memo => {
        const searchable = [memo.content || '', memo.tag || ''].join(' ').trim();
        if (!searchable) return;

        let targetLabel = 'Project';
        let docId = '';
        if (memo.type === 'document') {
            const doc = appData.documents.find(d => d.id === memo.targetId);
            targetLabel = doc ? doc.title : 'Document';
            docId = memo.targetId || '';
        } else if (memo.type === 'code') {
            const code = appData.codes.find(c => c.id === memo.targetId);
            targetLabel = code ? code.name : 'Code';
        } else if (memo.type === 'segment') {
            const segment = appData.segments.find(s => s.id === memo.targetId);
            const doc = segment ? appData.documents.find(d => d.id === segment.docId) : null;
            targetLabel = doc ? doc.title : 'Segment';
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

function openSearchModal() {
    if (typeof closeInPageSearch === 'function') closeInPageSearch();
    if (appData.documents.length === 0) {
        alert('No documents to search. Import or paste a document first.');
        return;
    }
    
    // Show modal with empty search
    const modal = document.getElementById('searchResultsModal');
    const summary = document.getElementById('searchSummary');
    const list = document.getElementById('searchResultsList');
    
    summary.innerHTML = `
        <span class="search-summary-label">Search</span>
        <div class="search-summary-input-wrapper">
            <svg class="toolbar-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" class="search-summary-input" id="modalSearchInput" value="" placeholder="Enter search terms...">
        </div>
    `;
    
    list.innerHTML = '<p style="color: var(--text-tertiary); text-align: center; padding: 40px;">Type to search across documents, code descriptions, and annotations</p>';
    
    // Add enter key handler
    document.getElementById('modalSearchInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const query = this.value.trim();
            if (query) {
                const results = searchAllDocuments(query);
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

function performSearch(query) {
    if (appData.documents.length === 0) {
        alert('No documents to search.');
        return;
    }
    
    const results = searchAllDocuments(query);
    showSearchResults(query, results);
}

function parseSearchQuery(query) {
    // Parse Boolean operators and wildcards
    // Returns an object with { type: 'AND'|'OR'|'SIMPLE', terms: [...], notTerms: [...] }
    
    const upperQuery = query.toUpperCase();
    let type = 'SIMPLE';
    let terms = [];
    let notTerms = [];
    
    // Check for OR
    if (upperQuery.includes(' OR ')) {
        type = 'OR';
        const parts = query.split(/\s+OR\s+/i);
        parts.forEach(part => {
            const parsed = parseSimpleTerm(part.trim());
            if (parsed.not) {
                notTerms.push(parsed.term);
            } else {
                terms.push(parsed.term);
            }
        });
    }
    // Check for AND (explicit or implicit with multiple words)
    else if (upperQuery.includes(' AND ')) {
        type = 'AND';
        const parts = query.split(/\s+AND\s+/i);
        parts.forEach(part => {
            const parsed = parseSimpleTerm(part.trim());
            if (parsed.not) {
                notTerms.push(parsed.term);
            } else {
                terms.push(parsed.term);
            }
        });
    }
    // Check for NOT only
    else if (upperQuery.startsWith('NOT ')) {
        type = 'AND';
        notTerms.push(convertWildcardToRegex(query.substring(4).trim()));
    }
    // Simple term or multiple words (treat as AND)
    else {
        const words = query.split(/\s+/).filter(w => w.length > 0);
        if (words.length > 1) {
            type = 'AND';
            words.forEach(word => {
                const parsed = parseSimpleTerm(word);
                if (parsed.not) {
                    notTerms.push(parsed.term);
                } else {
                    terms.push(parsed.term);
                }
            });
        } else {
            type = 'SIMPLE';
            const parsed = parseSimpleTerm(query);
            if (parsed.not) {
                notTerms.push(parsed.term);
            } else {
                terms.push(parsed.term);
            }
        }
    }
    
    return { type, terms, notTerms };
}

function parseSimpleTerm(term) {
    // Check for NOT prefix
    if (term.toUpperCase().startsWith('NOT ')) {
        return { not: true, term: convertWildcardToRegex(term.substring(4)) };
    }
    return { not: false, term: convertWildcardToRegex(term) };
}

function convertWildcardToRegex(term) {
    // Escape regex metacharacters except *, then convert * to .*
    const escaped = term.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(/\*/g, '.*');
}

function searchAllDocuments(query) {
    ensureSearchIndexCurrent();
    const parsed = parseSearchQuery(query);
    const results = [];
    
    // Pre-compile all regex patterns once (avoid recompilation per document)
    const notRegexes = parsed.notTerms.map(term => new RegExp(term, 'gi'));
    const termRegexes = parsed.terms.map(term => new RegExp(term, 'gi'));

    const collectMatchData = (text) => {
        const sourceText = String(text || '');
        let matches = true;
        let matchCount = 0;
        const snippets = [];

        for (const regex of notRegexes) {
            regex.lastIndex = 0;
            if (regex.test(sourceText)) {
                matches = false;
                break;
            }
        }
        if (!matches) return { matches: false, matchCount: 0, snippets: [] };

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
                while ((match = regex.exec(sourceText)) !== null && snippets.length < 3) {
                    const start = Math.max(0, match.index - 50);
                    const end = Math.min(sourceText.length, match.index + match[0].length + 50);
                    let snippet = sourceText.substring(start, end);
                    if (start > 0) snippet = '...' + snippet;
                    if (end < sourceText.length) snippet += '...';
                    snippets.push({ text: snippet });
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
                while ((match = regex.exec(sourceText)) !== null && snippets.length < 3) {
                    const start = Math.max(0, match.index - 50);
                    const end = Math.min(sourceText.length, match.index + match[0].length + 50);
                    let snippet = sourceText.substring(start, end);
                    if (start > 0) snippet = '...' + snippet;
                    if (end < sourceText.length) snippet += '...';
                    snippets.push({ text: snippet });
                }
            }
            matches = anyMatch;
        }

        if (!(parsed.terms.length > 0 || parsed.notTerms.length > 0)) {
            matches = false;
        }
        return { matches, matchCount, snippets };
    };

    globalSearchIndex.entries.forEach((entry) => {
        const result = collectMatchData(entry.searchText);
        if (!result.matches) return;
        results.push({
            kind: entry.kind,
            kindLabel: entry.kindLabel,
            primaryId: entry.primaryId,
            docId: entry.docId || '',
            title: entry.title,
            matchCount: result.matchCount,
            snippets: result.snippets
        });
    });
    
    // Sort by match count descending
    results.sort((a, b) => b.matchCount - a.matchCount);
    
    return results;
}

function showSearchResults(query, results) {
    const modal = document.getElementById('searchResultsModal');
    const summary = document.getElementById('searchSummary');
    const list = document.getElementById('searchResultsList');
    
    // Build combined regex for highlighting
    const parsed = parseSearchQuery(query);
    const highlightPatterns = parsed.terms.join('|');
    
    // Create search bar in summary.
    summary.innerHTML = `
        <span class="search-summary-label">Found ${results.length} result${results.length !== 1 ? 's' : ''} for</span>
        <div class="search-summary-input-wrapper">
            <svg class="toolbar-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" class="search-summary-input" id="modalSearchInput" value="${escapeHtml(query)}" placeholder="Refine search...">
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
    
    if (results.length === 0) {
        list.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">No documents match your search.</p>';
    } else {
        list.innerHTML = results.map(result => {
            // Highlight snippets
            const highlightedSnippets = result.snippets.map(s => {
                if (highlightPatterns) {
                    const regex = new RegExp(`(${highlightPatterns})`, 'gi');
                    return escapeHtml(s.text).replace(regex, '<mark>$1</mark>');
                }
                return escapeHtml(s.text);
            }).join('<br>');
            
            return `
                <div class="search-result-item"
                     data-kind="${escapeHtmlAttrValue(result.kind)}"
                     data-primary-id="${escapeHtmlAttrValue(result.primaryId)}"
                     data-doc-id="${escapeHtmlAttrValue(result.docId || '')}"
                     data-query="${escapeHtmlAttrValue(encodeURIComponent(query))}">
                    <div class="search-result-title">
                        ${escapeHtml(result.title)}
                        <span class="search-result-count">${result.kindLabel} · ${result.matchCount} match${result.matchCount !== 1 ? 'es' : ''}</span>
                    </div>
                    <div class="search-result-snippet">${highlightedSnippets || '<em>No preview available</em>'}</div>
                </div>
            `;
        }).join('');
    }
    
    modal.classList.add('show');
}

function handleSearchInputKeydown(e) {
    if (e.key === 'Enter') {
        const newQuery = e.target.value.trim();
        if (newQuery) {
            const newResults = searchAllDocuments(newQuery);
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

function setActiveInPageSearchMatch(index) {
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
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateInPageSearchCount();
}

function applyInPageSearch(query) {
    const root = getInPageSearchRoot();
    if (!root) return;
    clearInPageSearchHighlights();

    const q = String(query || '').trim();
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

    setActiveInPageSearchMatch(0);
}

function openInPageSearch() {
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
        applyInPageSearch(input.value.trim());
    } else {
        updateInPageSearchCount();
    }
}

function closeInPageSearch() {
    const bar = document.getElementById('inPageSearchBar');
    if (bar) bar.classList.remove('show');
    clearInPageSearchHighlights();
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

function goToSearchResult(kind, primaryId, docId, encodedQuery) {
    const query = decodeURIComponent(encodedQuery || '');
    closeSearchResults();

    if (kind === 'document') {
        selectDocument(primaryId);
        setTimeout(() => highlightSearchTermsInCurrentDocument(query), 100);
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
            setTimeout(() => highlightSearchTermsInCurrentDocument(query), 100);
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
