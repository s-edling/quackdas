/**
 * Quackdas - Semantic tools UI (local Ollama embeddings)
 */

const semanticUiState = {
    availability: null,
    indexState: 'not_indexed',
    indexStatusMessage: '',
    indexing: false,
    lastProgress: null,
    results: [],
    pollTimer: null
};

const semanticRuntimeDefaults = {
    chunkMin: 1200,
    chunkMax: 1800,
    chunkOverlap: 200,
    embeddingConcurrency: 2,
    topK: 20,
    snippetRadius: 120
};

function canonicalizeSemanticText(input) {
    return String(input == null ? '' : input).replace(/\r\n?/g, '\n');
}

function getSemanticTextDocuments() {
    return (Array.isArray(appData.documents) ? appData.documents : [])
        .filter((doc) => doc && doc.id && doc.type !== 'pdf')
        .map((doc) => ({
            id: String(doc.id),
            title: String(doc.title || 'Untitled document'),
            type: String(doc.type || 'text'),
            content: canonicalizeSemanticText(doc.content || '')
        }));
}

function getSemanticButton() {
    return document.getElementById('semanticToolsButton');
}

function getSemanticModal() {
    return document.getElementById('semanticToolsModal');
}

function setSemanticStatus(message, isError = false) {
    const banner = document.getElementById('semanticStatusBanner');
    if (!banner) return;
    banner.textContent = message || '';
    banner.classList.toggle('semantic-status-error', !!isError);
}

function setSemanticProgress(progress) {
    const wrap = document.getElementById('semanticProgressWrap');
    const fill = document.getElementById('semanticProgressFill');
    const meta = document.getElementById('semanticProgressMeta');
    if (!wrap || !fill || !meta) return;

    if (!progress) {
        wrap.hidden = true;
        fill.style.width = '0%';
        meta.textContent = '';
        return;
    }

    wrap.hidden = false;
    const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
    fill.style.width = `${percent}%`;
    const currentDoc = progress.currentDocName ? ` • ${progress.currentDocName}` : '';
    meta.textContent = `${Math.round(percent)}% • ${Number(progress.embeddedChunks || 0)}/${Number(progress.totalChunks || 0)} chunks${currentDoc}`;
}

function renderSemanticResults(query) {
    const host = document.getElementById('semanticResultsList');
    if (!host) return;

    if (!Array.isArray(semanticUiState.results) || semanticUiState.results.length === 0) {
        host.innerHTML = '<div class="semantic-empty-results">No semantic matches yet.</div>';
        return;
    }

    const queryTerms = String(query || '')
        .split(/\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 1)
        .slice(0, 12);

    const termRegex = queryTerms.length > 0
        ? new RegExp(`(${queryTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
        : null;

    host.innerHTML = semanticUiState.results.map((result, idx) => {
        const snippetRaw = escapeHtml(result.snippet || '');
        const snippet = termRegex ? snippetRaw.replace(termRegex, '<mark>$1</mark>') : snippetRaw;
        const score = Number(result.score || 0).toFixed(3);
        return `
            <button type="button" class="semantic-result-item" data-semantic-result-index="${idx}">
                <div class="semantic-result-doc">${escapeHtml(result.docTitle)} • ${escapeHtml(result.locationLabel)}<span class="semantic-result-score">${score}</span></div>
                <div class="semantic-result-snippet">${snippet}</div>
            </button>
        `;
    }).join('');
}

function computeParagraphLabel(text, charIndex) {
    const safeIndex = Math.max(0, Math.min(Number(charIndex || 0), text.length));
    let count = 1;
    for (let i = 0; i < safeIndex; i++) {
        if (text[i] === '\n' && text[i + 1] === '\n') count += 1;
    }
    return `Paragraph ${count}`;
}

function buildSemanticSnippet(text, startChar, endChar, radius = semanticRuntimeDefaults.snippetRadius) {
    const safeText = canonicalizeSemanticText(text || '');
    const start = Math.max(0, Math.min(Number(startChar || 0), safeText.length));
    const end = Math.max(start, Math.min(Number(endChar || 0), safeText.length));
    const from = Math.max(0, start - radius);
    const to = Math.min(safeText.length, Math.max(end, start + radius));
    const prefix = from > 0 ? '…' : '';
    const suffix = to < safeText.length ? '…' : '';
    return `${prefix}${safeText.slice(from, to)}${suffix}`;
}

async function refreshSemanticAvailability(force = false) {
    const btn = getSemanticButton();
    if (!(window.electronAPI && window.electronAPI.semanticGetAvailability)) {
        if (btn) btn.hidden = true;
        return null;
    }

    const result = await window.electronAPI.semanticGetAvailability({ force });
    semanticUiState.availability = result && result.ok ? result : null;

    const reachable = !!(result && result.ok && result.reachable);
    if (btn) btn.hidden = !reachable;

    if (getSemanticModal()?.classList.contains('show')) {
        if (reachable) {
            if (result?.modelReady) {
                setSemanticStatus('Semantic tools ready.');
            } else {
                setSemanticStatus(result?.error || 'Ollama reachable, but no embedding model is installed yet.', true);
            }
        } else {
            setSemanticStatus(result?.error || 'Ollama is unavailable. Start Ollama and ensure your embedding model is pulled.', true);
        }
    }
    updateSemanticIndexButtons();

    return result;
}

async function refreshSemanticProjectSettings() {
    if (!(window.electronAPI && window.electronAPI.semanticGetProjectSettings)) return;
    const select = document.getElementById('semanticModelSelect');
    const hint = document.getElementById('semanticModelHint');
    const settings = await window.electronAPI.semanticGetProjectSettings();
    const availability = semanticUiState.availability;
    const models = Array.isArray(availability?.models) ? availability.models : [];
    const configuredModel = String(settings?.modelName || 'bge-m3');

    if (select) {
        const options = [];
        models.forEach((name) => {
            options.push(`<option value="${escapeHtmlAttrValue(name)}">${escapeHtml(name)}</option>`);
        });
        if (models.length === 0) {
            options.push('<option value="">No local models found</option>');
        }
        if (configuredModel && !models.includes(configuredModel)) {
            options.unshift(`<option value="${escapeHtmlAttrValue(configuredModel)}">${escapeHtml(configuredModel)} (not installed)</option>`);
        }
        select.innerHTML = options.join('');
        select.value = configuredModel && options.length > 0 ? configuredModel : (models[0] || '');
        select.disabled = models.length === 0;
    }

    if (hint) {
        if (!availability?.reachable) {
            hint.textContent = availability?.error || 'Ollama not reachable.';
        } else if (!availability?.modelReady) {
            hint.textContent = availability?.error || 'No embedding model found. Pull one and retry.';
        } else if (availability?.fallbackUsed) {
            hint.textContent = `Configured model not found locally. Using fallback: ${availability.selectedModel}.`;
        } else if (availability?.selectedModel) {
            hint.textContent = `Connected model: ${availability.selectedModel}.`;
        } else {
            hint.textContent = 'Connected to Ollama.';
        }
    }
}

async function refreshSemanticIndexStatus() {
    if (!(window.electronAPI && window.electronAPI.semanticGetIndexStatus)) return;

    const docs = getSemanticTextDocuments();
    const status = await window.electronAPI.semanticGetIndexStatus({ documents: docs });
    if (!status?.ok) {
        semanticUiState.indexState = 'error';
        semanticUiState.indexStatusMessage = status?.error || 'Index status unavailable.';
        setSemanticStatus(semanticUiState.indexStatusMessage, true);
        return;
    }

    semanticUiState.indexState = status.state || 'not_indexed';
    if (semanticUiState.indexState === 'indexed') {
        semanticUiState.indexStatusMessage = `Indexed (${status.indexedDocCount}/${status.totalDocs} docs, ${status.chunkCount} chunks).`;
        setSemanticStatus(semanticUiState.indexStatusMessage);
    } else {
        semanticUiState.indexStatusMessage = status.message || `Not indexed (${status.indexedDocCount}/${status.totalDocs} docs indexed).`;
        setSemanticStatus(semanticUiState.indexStatusMessage);
    }
}

function updateSemanticIndexButtons() {
    const startBtn = document.getElementById('semanticStartIndexBtn');
    const cancelBtn = document.getElementById('semanticCancelIndexBtn');
    const searchInput = document.getElementById('semanticQueryInput');

    const reachable = !!(semanticUiState.availability && semanticUiState.availability.reachable);
    const modelReady = !!(semanticUiState.availability && semanticUiState.availability.modelReady);
    const indexing = !!semanticUiState.indexing;

    if (startBtn) {
        startBtn.disabled = !reachable || !modelReady || indexing;
    }
    if (cancelBtn) {
        cancelBtn.hidden = !indexing;
        cancelBtn.disabled = !indexing;
    }
    if (searchInput) {
        searchInput.disabled = !reachable || !modelReady || indexing || semanticUiState.indexState !== 'indexed';
    }
}

async function openSemanticToolsModal() {
    const modal = getSemanticModal();
    if (!modal) return;
    modal.classList.add('show');

    await refreshSemanticAvailability(true);
    await refreshSemanticProjectSettings();
    await refreshSemanticIndexStatus();

    updateSemanticIndexButtons();
    renderSemanticResults(document.getElementById('semanticQueryInput')?.value || '');
}

function closeSemanticToolsModal() {
    const modal = getSemanticModal();
    if (modal) modal.classList.remove('show');
}

async function saveSemanticModelSetting() {
    const select = document.getElementById('semanticModelSelect');
    const modelName = String(select?.value || '').trim();
    if (!modelName) {
        setSemanticStatus('Model name is required.', true);
        return;
    }

    const result = await window.electronAPI.semanticSetProjectModel(modelName);
    if (!result?.ok) {
        setSemanticStatus(result?.error || 'Could not save model setting.', true);
        return;
    }

    await refreshSemanticAvailability(true);
    await refreshSemanticProjectSettings();
    await refreshSemanticIndexStatus();
    updateSemanticIndexButtons();
}

async function refreshSemanticModelList() {
    await refreshSemanticAvailability(true);
    await refreshSemanticProjectSettings();
    updateSemanticIndexButtons();
}

async function startSemanticIndexing() {
    if (!window.electronAPI?.semanticStartIndexing) return;

    const docs = getSemanticTextDocuments();
    if (docs.length === 0) {
        setSemanticStatus('No text documents to index. Semantic Search currently supports text documents only.', true);
        return;
    }

    semanticUiState.indexing = true;
    semanticUiState.lastProgress = {
        percent: 0,
        embeddedChunks: 0,
        totalChunks: 0,
        currentDocName: docs[0]?.title || ''
    };
    setSemanticProgress(semanticUiState.lastProgress);
    setSemanticStatus('Indexing started...');
    updateSemanticIndexButtons();

    const result = await window.electronAPI.semanticStartIndexing({
        documents: docs,
        chunkMin: semanticRuntimeDefaults.chunkMin,
        chunkMax: semanticRuntimeDefaults.chunkMax,
        chunkOverlap: semanticRuntimeDefaults.chunkOverlap,
        embeddingConcurrency: semanticRuntimeDefaults.embeddingConcurrency
    });

    if (!result?.ok) {
        semanticUiState.indexing = false;
        setSemanticStatus(result?.error || 'Failed to start indexing.', true);
        updateSemanticIndexButtons();
        return;
    }
}

async function cancelSemanticIndexing() {
    if (!window.electronAPI?.semanticCancelIndexing) return;
    await window.electronAPI.semanticCancelIndexing();
}

async function runSemanticSearch() {
    if (!window.electronAPI?.semanticSearch) return;
    const input = document.getElementById('semanticQueryInput');
    const query = String(input?.value || '').trim();
    if (!query) {
        semanticUiState.results = [];
        renderSemanticResults('');
        return;
    }

    setSemanticStatus('Running semantic search...');
    const response = await window.electronAPI.semanticSearch({
        query,
        topK: semanticRuntimeDefaults.topK
    });

    if (!response?.ok) {
        setSemanticStatus(response?.error || 'Semantic search failed.', true);
        semanticUiState.results = [];
        renderSemanticResults(query);
        return;
    }

    const docsById = new Map((appData.documents || []).map((doc) => [doc.id, doc]));
    semanticUiState.results = (Array.isArray(response.results) ? response.results : []).map((row) => {
        const doc = docsById.get(row.doc_id);
        const content = canonicalizeSemanticText(doc?.content || '');
        return {
            docId: row.doc_id,
            chunkId: row.chunk_id,
            startChar: Number(row.start_char || 0),
            endChar: Number(row.end_char || 0),
            score: Number(row.score || 0),
            docTitle: doc?.title || row.doc_id,
            locationLabel: computeParagraphLabel(content, Number(row.start_char || 0)),
            snippet: buildSemanticSnippet(content, Number(row.start_char || 0), Number(row.end_char || 0))
        };
    });

    setSemanticStatus(`Found ${semanticUiState.results.length} matches.`);
    renderSemanticResults(query);
}

function handleSemanticResultClick(event) {
    const item = event.target.closest('.semantic-result-item[data-semantic-result-index]');
    if (!item) return;
    const idx = Number(item.dataset.semanticResultIndex);
    const result = semanticUiState.results[idx];
    if (!result) return;

    const doc = appData.documents.find((d) => d.id === result.docId);
    if (!doc || doc.type === 'pdf') {
        alert('Semantic Search currently supports text documents only.');
        return;
    }

    selectDocument(result.docId);
    setTimeout(() => {
        if (typeof scrollToCharacterPosition === 'function') {
            scrollToCharacterPosition(result.startChar);
        }
    }, 60);
}

function bindSemanticToolListeners() {
    const results = document.getElementById('semanticResultsList');
    if (results) {
        results.addEventListener('click', handleSemanticResultClick);
    }

    const queryInput = document.getElementById('semanticQueryInput');
    if (queryInput) {
        queryInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            runSemanticSearch();
        });
    }

    if (window.electronAPI?.onSemanticIndexProgress) {
        window.electronAPI.onSemanticIndexProgress((payload) => {
            semanticUiState.indexing = true;
            semanticUiState.lastProgress = payload || null;
            setSemanticProgress(payload || null);
            setSemanticStatus('Indexing in progress...');
            updateSemanticIndexButtons();
        });
    }

    if (window.electronAPI?.onSemanticIndexDone) {
        window.electronAPI.onSemanticIndexDone(async (payload) => {
            semanticUiState.indexing = false;
            setSemanticProgress(null);
            setSemanticStatus(`Indexing complete (${payload?.indexedDocs || 0} docs).`);
            await refreshSemanticAvailability(true);
            await refreshSemanticIndexStatus();
            updateSemanticIndexButtons();
        });
    }

    if (window.electronAPI?.onSemanticIndexError) {
        window.electronAPI.onSemanticIndexError(async (payload) => {
            semanticUiState.indexing = false;
            if (payload?.code === 'INDEX_CANCELLED') {
                setSemanticStatus('Indexing cancelled.');
            } else {
                setSemanticStatus(payload?.message || 'Indexing failed.', true);
            }
            setSemanticProgress(null);
            await refreshSemanticIndexStatus();
            updateSemanticIndexButtons();
        });
    }
}

async function initSemanticTools() {
    const btn = getSemanticButton();
    if (!btn || !window.electronAPI) return;

    bindSemanticToolListeners();
    await refreshSemanticAvailability(true);
    await refreshSemanticProjectSettings();
    await refreshSemanticIndexStatus();

    if (window.electronAPI?.semanticGetIndexingState) {
        const state = await window.electronAPI.semanticGetIndexingState();
        const running = state?.ok && state.state && state.state.status === 'running';
        if (running) {
            semanticUiState.indexing = true;
            semanticUiState.lastProgress = state.state.progress || null;
            setSemanticProgress(semanticUiState.lastProgress);
        }
    }

    updateSemanticIndexButtons();

    // Ensure the button state updates after launch async settles.
    setTimeout(() => {
        refreshSemanticAvailability(true).then(() => {
            refreshSemanticProjectSettings().catch(() => {});
        }).catch(() => {});
    }, 1200);

    if (semanticUiState.pollTimer) clearInterval(semanticUiState.pollTimer);
    semanticUiState.pollTimer = setInterval(() => {
        refreshSemanticAvailability(false).then(() => {
            refreshSemanticProjectSettings().catch(() => {});
        }).catch(() => {});
    }, 10000);
}
