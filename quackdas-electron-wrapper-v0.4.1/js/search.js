/**
 * Quackdas - Search Functions
 * Boolean search with AND/OR/NOT and wildcards
 */

function openSearchModal() {
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
    
    list.innerHTML = '<p style="color: var(--text-tertiary); text-align: center; padding: 40px;">Type to search across all documents</p>';
    
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
    const parsed = parseSearchQuery(query);
    const results = [];
    
    // Pre-compile all regex patterns once (avoid recompilation per document)
    const notRegexes = parsed.notTerms.map(term => new RegExp(term, 'gi'));
    const termRegexes = parsed.terms.map(term => new RegExp(term, 'gi'));
    
    appData.documents.forEach(doc => {
        let matches = true;
        let matchCount = 0;
        let snippets = [];
        
        // Check NOT terms first - if any match, exclude this document
        for (const regex of notRegexes) {
            regex.lastIndex = 0; // Reset for reuse
            if (regex.test(doc.content)) {
                matches = false;
                break;
            }
        }
        
        if (!matches) return;
        
        // Check positive terms
        if (parsed.type === 'AND' || parsed.type === 'SIMPLE') {
            // All terms must match
            for (const regex of termRegexes) {
                regex.lastIndex = 0;
                const termMatches = doc.content.match(regex);
                if (!termMatches) {
                    matches = false;
                    break;
                }
                matchCount += termMatches.length;
                
                // Collect snippets for this term
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(doc.content)) !== null && snippets.length < 3) {
                    const start = Math.max(0, match.index - 50);
                    const end = Math.min(doc.content.length, match.index + match[0].length + 50);
                    let snippet = doc.content.substring(start, end);
                    if (start > 0) snippet = '...' + snippet;
                    if (end < doc.content.length) snippet = snippet + '...';
                    snippets.push({ text: snippet, matchStart: match.index - start, matchEnd: match.index - start + match[0].length });
                }
            }
        } else if (parsed.type === 'OR') {
            // At least one term must match
            let anyMatch = false;
            for (const regex of termRegexes) {
                regex.lastIndex = 0;
                const termMatches = doc.content.match(regex);
                if (termMatches) {
                    anyMatch = true;
                    matchCount += termMatches.length;
                    
                    // Collect snippets
                    regex.lastIndex = 0;
                    let match;
                    while ((match = regex.exec(doc.content)) !== null && snippets.length < 3) {
                        const start = Math.max(0, match.index - 50);
                        const end = Math.min(doc.content.length, match.index + match[0].length + 50);
                        let snippet = doc.content.substring(start, end);
                        if (start > 0) snippet = '...' + snippet;
                        if (end < doc.content.length) snippet = snippet + '...';
                        snippets.push({ text: snippet, matchStart: match.index - start, matchEnd: match.index - start + match[0].length });
                    }
                }
            }
            matches = anyMatch;
        }
        
        if (matches && (parsed.terms.length > 0 || parsed.notTerms.length > 0)) {
            results.push({
                docId: doc.id,
                title: doc.title,
                matchCount: matchCount,
                snippets: snippets
            });
        }
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
    
    // Create search bar in summary (using inline handler to avoid listener accumulation)
    summary.innerHTML = `
        <span class="search-summary-label">Found ${results.length} document${results.length !== 1 ? 's' : ''} for</span>
        <div class="search-summary-input-wrapper">
            <svg class="toolbar-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" class="search-summary-input" id="modalSearchInput" value="${escapeHtml(query)}" placeholder="Refine search..." onkeydown="handleSearchInputKeydown(event)">
        </div>
    `;
    
    // Focus the input
    setTimeout(() => {
        const input = document.getElementById('modalSearchInput');
        if (input) {
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
                <div class="search-result-item" onclick="goToSearchResult('${result.docId}', '${escapeHtml(query).replace(/'/g, "\\'")}')">
                    <div class="search-result-title">
                        ${escapeHtml(result.title)}
                        <span class="search-result-count">${result.matchCount} match${result.matchCount !== 1 ? 'es' : ''}</span>
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

function goToSearchResult(docId, query) {
    closeSearchResults();
    selectDocument(docId);
    
    // Highlight search terms by adding temporary highlight class to matching text
    // We do this after render to preserve coded segment markup
    setTimeout(() => {
        const content = document.getElementById('documentContent');
        if (!content) return;
        
        const parsed = parseSearchQuery(query);
        if (parsed.terms.length === 0) return;
        
        const highlightPatterns = parsed.terms.join('|');
        const regex = new RegExp(highlightPatterns, 'gi');
        
        // Walk through text nodes and wrap matches in <mark> elements
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const p = node.parentElement;
                if (!p) return NodeFilter.FILTER_ACCEPT;
                // Skip UI elements
                if (p.classList.contains('memo-indicator') || p.classList.contains('code-actions')) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (p.closest && p.closest('.code-actions, .memo-indicator')) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Skip already-marked text
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
            
            // Reset regex lastIndex
            regex.lastIndex = 0;
            
            // Split text by matches and rebuild with <mark> elements
            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            let match;
            
            while ((match = regex.exec(text)) !== null) {
                // Text before match
                if (match.index > lastIndex) {
                    frag.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
                }
                // The match itself
                const mark = document.createElement('mark');
                mark.style.background = '#fff3cd';
                mark.style.padding = '1px 2px';
                mark.style.borderRadius = '2px';
                mark.textContent = match[0];
                frag.appendChild(mark);
                
                if (!firstMark) firstMark = mark;
                
                lastIndex = regex.lastIndex;
            }
            
            // Remaining text after last match
            if (lastIndex < text.length) {
                frag.appendChild(document.createTextNode(text.substring(lastIndex)));
            }
            
            node.parentNode.replaceChild(frag, node);
        });
        
        // Scroll to first match
        if (firstMark) {
            firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        // Remove highlights after 5 seconds to clean up
        setTimeout(() => {
            const marks = content.querySelectorAll('mark');
            marks.forEach(mark => {
                const text = document.createTextNode(mark.textContent);
                mark.parentNode.replaceChild(text, mark);
            });
        }, 5000);
    }, 100);
}
