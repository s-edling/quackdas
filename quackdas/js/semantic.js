/**
 * Quackdas - Semantic tools UI (local Ollama embeddings + Ask)
 */

const semanticUiState = {
    availability: null,
    activeTool: 'search',
    indexState: 'not_indexed',
    indexStatusMessage: '',
    indexing: false,
    lastProgress: null,
    results: [],
    pollTimer: null,
    ask: {
        running: false,
        phase: 'idle',
        streamText: '',
        statusMessage: '',
        statusError: false,
        answer: null,
        notes: '',
        rawOutput: '',
        fallback: false,
        answerText: '',
        answerMode: 'strict',
        outputMode: 'strict',
        modeManuallySet: false,
        verifiedCitationCount: 0,
        sources: [],
        retrievedChunks: [],
        lastQuestion: '',
        outputLanguage: 'en',
        generationModel: ''
    }
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

function inferModelSizeBillionsFromName(modelName) {
    const raw = String(modelName || '').trim().toLowerCase();
    if (!raw) return null;
    const bMatch = raw.match(/(^|[:/ _-])(\d+(?:\.\d+)?)\s*b(?=$|[:/ _.-])/i);
    if (bMatch) {
        const value = Number(bMatch[2]);
        return Number.isFinite(value) && value > 0 ? value : null;
    }
    const mMatch = raw.match(/(^|[:/ _-])(\d+(?:\.\d+)?)\s*m(?=$|[:/ _.-])/i);
    if (mMatch) {
        const value = Number(mMatch[2]);
        return Number.isFinite(value) && value > 0 ? (value / 1000) : null;
    }
    return null;
}

function getRecommendedAskMode(modelName) {
    const sizeB = inferModelSizeBillionsFromName(modelName);
    return Number.isFinite(sizeB) && sizeB <= 4 ? 'loose' : 'strict';
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

function setSemanticAskStatus(message, isError = false) {
    semanticUiState.ask.statusMessage = String(message || '');
    semanticUiState.ask.statusError = !!isError;
    const badgeEl = document.getElementById('semanticAskStatusBadge');
    if (!badgeEl) return;
    const text = semanticUiState.ask.statusMessage.trim();
    badgeEl.hidden = !text;
    badgeEl.textContent = text;
    badgeEl.classList.toggle('semantic-status-error', semanticUiState.ask.statusError);
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

function formatAskInlineMarkdown(escapedText) {
    return String(escapedText || '')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
        .replace(/`([^`]+?)`/g, '<code>$1</code>');
}

function renderAskMarkdownWithCitations(rawText, markerMap = new Map()) {
    const citeTokens = [];
    const withTokens = String(rawText || '').replace(/\[(\d+)\]/g, (_m, markerRaw) => {
        const marker = Number(markerRaw);
        if (!Number.isFinite(marker) || !markerMap.has(marker)) return `[${markerRaw}]`;
        const sourceIdx = markerMap.get(marker);
        const token = `@@SEM_CITE_${citeTokens.length}@@`;
        citeTokens.push({
            token,
            html: `<button type="button" class="semantic-ask-cite-chip" data-semantic-source-index="${sourceIdx}">[${marker}]</button>`
        });
        return token;
    });

    const lines = withTokens.replace(/\r\n?/g, '\n').split('\n');
    let rendered = lines.map((line) => {
        const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const content = formatAskInlineMarkdown(escapeHtml(headingMatch[2]));
            return `<div class="semantic-ask-md-heading semantic-ask-md-h${level}">${content}</div>`;
        }

        const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
        if (bulletMatch) {
            const content = formatAskInlineMarkdown(escapeHtml(bulletMatch[1]));
            return `<div class="semantic-ask-md-bullet">&bull; ${content}</div>`;
        }

        if (!line.trim()) return '<br>';
        return `<div>${formatAskInlineMarkdown(escapeHtml(line))}</div>`;
    }).join('');

    citeTokens.forEach((entry) => {
        rendered = rendered.replaceAll(entry.token, entry.html);
    });
    return rendered;
}

function toggleSemanticTool(tool) {
    semanticUiState.activeTool = tool === 'ask' ? 'ask' : 'search';
    const searchView = document.getElementById('semanticSearchView');
    const askView = document.getElementById('semanticAskView');
    const tabSearch = document.getElementById('semanticTabSearch');
    const tabAsk = document.getElementById('semanticTabAsk');

    if (searchView) searchView.hidden = semanticUiState.activeTool !== 'search';
    if (askView) askView.hidden = semanticUiState.activeTool !== 'ask';
    if (tabSearch) tabSearch.classList.toggle('active', semanticUiState.activeTool === 'search');
    if (tabAsk) tabAsk.classList.toggle('active', semanticUiState.activeTool === 'ask');
}

function renderAskAnswer() {
    const answerEl = document.getElementById('semanticAskAnswer');
    const sourcesEl = document.getElementById('semanticAskSources');
    const contextDetails = document.getElementById('semanticAskContextDetails');
    const contextList = document.getElementById('semanticAskContextList');
    const rawDetails = document.getElementById('semanticAskRawOutputDetails');
    const rawPre = document.getElementById('semanticAskRawOutput');

    if (answerEl) {
        const answerText = String(semanticUiState.ask.answerText || '').trim();
        const claims = Array.isArray(semanticUiState.ask.answer) ? semanticUiState.ask.answer : [];
        const isLoose = String(semanticUiState.ask.answerMode || '').toLowerCase() === 'loose';
        const verifiedCount = Number(semanticUiState.ask.verifiedCitationCount || 0);
        const looseIndicator = (isLoose && verifiedCount === 0)
            ? '<div class="semantic-empty-results"><strong>Ungrounded:</strong> No citations.</div>'
            : '';
        if (answerText) {
            const markerMap = new Map();
            (semanticUiState.ask.sources || []).forEach((source, idx) => {
                const marker = Number(source?.marker || idx + 1);
                if (!Number.isFinite(marker) || marker <= 0) return;
                markerMap.set(marker, idx);
            });
            const html = renderAskMarkdownWithCitations(answerText, markerMap);
            answerEl.innerHTML = `${looseIndicator}<div class="semantic-ask-claim semantic-ask-prose">${html}</div>`;
        } else if (claims.length === 0) {
            answerEl.innerHTML = `${looseIndicator}<div class="semantic-empty-results">No grounded answer claims yet.</div>`;
        } else {
            const sourceIndexMap = new Map();
            (semanticUiState.ask.sources || []).forEach((source, idx) => {
                sourceIndexMap.set(`${source.docId}::${source.chunkId}`, idx + 1);
            });

            answerEl.innerHTML = claims.map((claim, claimIdx) => {
                const chips = (claim.citations || []).map((citation) => {
                    const key = `${citation.doc_id}::${citation.chunk_id}`;
                    const sourceNumber = sourceIndexMap.get(key);
                    if (!sourceNumber) return '';
                    return `<button type="button" class="semantic-ask-cite-chip" data-semantic-source-key="${escapeHtmlAttrValue(key)}">[${sourceNumber}]</button>`;
                }).join(' ');
                return `<div class="semantic-ask-claim"><strong>${claimIdx + 1}.</strong> ${formatAskInlineMarkdown(escapeHtml(claim.claim || ''))} ${chips}</div>`;
            }).join('');
        }
    }

    if (sourcesEl) {
        const sources = Array.isArray(semanticUiState.ask.sources) ? semanticUiState.ask.sources : [];
        if (sources.length === 0) {
            sourcesEl.innerHTML = '<div class="semantic-empty-results">Sources will appear here after a grounded answer.</div>';
        } else {
            sourcesEl.innerHTML = `<div class="semantic-ask-source-title">Sources</div>${sources.map((source, idx) => `
                <button type="button" class="semantic-ask-source-item" data-semantic-source-index="${idx}">
                    <div class="semantic-ask-source-doc">[${idx + 1}] ${escapeHtml(source.docTitle)} • Char ${Number(source.startChar || 0)}-${Number(source.endChar || 0)}</div>
                    <div class="semantic-ask-source-snippet">${escapeHtml(buildSemanticSnippet(source.fullText || source.snippet || '', 0, Math.min(220, (source.fullText || source.snippet || '').length), 0))}</div>
                </button>
            `).join('')}`;
        }
    }

    if (contextDetails && contextList) {
        const retrieved = Array.isArray(semanticUiState.ask.retrievedChunks) ? semanticUiState.ask.retrievedChunks : [];
        contextDetails.hidden = retrieved.length === 0;
        contextList.innerHTML = retrieved.map((chunk, idx) => `
            <div class="semantic-ask-context-item">
                <div><strong>${idx + 1}.</strong> ${escapeHtml(chunk.docTitle || chunk.docId)} • ${escapeHtml(chunk.chunkId)}</div>
                <div>${escapeHtml((chunk.text || '').slice(0, 320))}</div>
            </div>
        `).join('');
    }

    const notes = String(semanticUiState.ask.notes || '').trim();
    if (notes && answerEl) {
        const noteHtml = `<div class=\"semantic-empty-results\"><strong>Notes:</strong> ${escapeHtml(notes)}</div>`;
        answerEl.innerHTML = `${answerEl.innerHTML}${noteHtml}`;
    }

    if (rawDetails && rawPre) {
        const raw = String(semanticUiState.ask.rawOutput || '').trim();
        rawDetails.hidden = !raw;
        rawPre.textContent = raw;
    }
}

function openAskSource(source) {
    if (!source) return;
    const doc = appData.documents.find((d) => d.id === source.docId);
    if (!doc || doc.type === 'pdf') {
        alert('Ask sources currently support text documents only.');
        return;
    }
    if (typeof goToCharacterRangeWithHighlight === 'function') {
        goToCharacterRangeWithHighlight(source.docId, source.startChar, source.endChar);
        return;
    }
    selectDocument(source.docId);
    setTimeout(() => {
        if (typeof scrollToCharacterPosition === 'function') {
            scrollToCharacterPosition(source.startChar);
        }
    }, 60);
}

async function refreshSemanticAvailability(force = false) {
    const btn = getSemanticButton();
    const modal = getSemanticModal();
    if (!(window.electronAPI && window.electronAPI.semanticGetAvailability)) {
        if (btn) btn.hidden = true;
        if (modal) {
            modal.classList.remove('show');
            modal.hidden = true;
        }
        return null;
    }

    const result = await window.electronAPI.semanticGetAvailability({ force });
    semanticUiState.availability = result && result.ok ? result : null;

    const reachable = !!(result && result.ok && result.reachable);
    if (btn) btn.hidden = !reachable;
    if (modal) {
        modal.hidden = !reachable;
        if (!reachable) modal.classList.remove('show');
    }

    if (getSemanticModal()?.classList.contains('show')) {
        if (reachable) {
            if (result?.modelReady) {
                setSemanticStatus('Semantic tools ready.');
            } else {
                setSemanticStatus(result?.error || 'Ollama reachable, but no embedding model is installed yet.', true);
            }
        } else {
            setSemanticStatus(result?.error || 'Ollama is unavailable. Start Ollama and ensure your embedding model is pulled.', true);
            setSemanticAskStatus(result?.error || 'Ollama is unavailable.', true);
        }
    }
    updateSemanticIndexButtons();
    updateSemanticAskButtons();

    return result;
}

async function refreshSemanticProjectSettings() {
    if (!(window.electronAPI && window.electronAPI.semanticGetProjectSettings)) return;
    const select = document.getElementById('semanticModelSelect');
    const generationSelect = document.getElementById('semanticGenerationModelSelect');
    const modeSelect = document.getElementById('semanticAskModeSelect');
    const hint = document.getElementById('semanticModelHint');
    const settings = await window.electronAPI.semanticGetProjectSettings();
    const availability = semanticUiState.availability;
    const models = Array.isArray(settings?.models) ? settings.models : [];
    const configuredModel = String(settings?.modelName || 'bge-m3');
    const configuredGenerationModel = String(settings?.generationModel || '');

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

    if (generationSelect) {
        const options = [];
        models.forEach((name) => {
            options.push(`<option value="${escapeHtmlAttrValue(name)}">${escapeHtml(name)}</option>`);
        });
        if (options.length === 0) options.push('<option value="">No local models found</option>');
        if (configuredGenerationModel && !models.includes(configuredGenerationModel)) {
            options.unshift(`<option value="${escapeHtmlAttrValue(configuredGenerationModel)}">${escapeHtml(configuredGenerationModel)} (not installed)</option>`);
        }
        generationSelect.innerHTML = options.join('');
        generationSelect.value = configuredGenerationModel || models[0] || '';
        generationSelect.disabled = models.length === 0;
        semanticUiState.ask.generationModel = generationSelect.value;
    }
    if (modeSelect) {
        if (!semanticUiState.ask.modeManuallySet) {
            const recommended = getRecommendedAskMode(semanticUiState.ask.generationModel);
            semanticUiState.ask.outputMode = recommended;
        }
        modeSelect.value = semanticUiState.ask.outputMode || 'strict';
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
    } else if (semanticUiState.indexState === 'indexed_stale') {
        semanticUiState.indexStatusMessage = status.message || `Indexed cache loaded (${status.indexedDocCount}/${status.totalDocs} docs).`;
        setSemanticStatus(semanticUiState.indexStatusMessage);
    } else if (semanticUiState.indexState === 'partial') {
        semanticUiState.indexStatusMessage = status.message || `Partially indexed (${status.indexedDocCount}/${status.totalDocs} docs).`;
        setSemanticStatus(semanticUiState.indexStatusMessage, true);
    } else {
        semanticUiState.indexStatusMessage = status.message || `Not indexed (${status.indexedDocCount}/${status.totalDocs} docs indexed).`;
        setSemanticStatus(semanticUiState.indexStatusMessage, true);
    }
}

function updateSemanticIndexButtons() {
    const startBtn = document.getElementById('semanticStartIndexBtn');
    const cancelBtn = document.getElementById('semanticCancelIndexBtn');
    const searchInput = document.getElementById('semanticQueryInput');

    const reachable = !!(semanticUiState.availability && semanticUiState.availability.reachable);
    const modelReady = !!(semanticUiState.availability && semanticUiState.availability.modelReady);
    const indexing = !!semanticUiState.indexing;
    const indexedReady = semanticUiState.indexState === 'indexed' || semanticUiState.indexState === 'indexed_stale';

    if (startBtn) {
        startBtn.disabled = !reachable || !modelReady || indexing;
    }
    if (cancelBtn) {
        cancelBtn.hidden = !indexing;
        cancelBtn.disabled = !indexing;
    }
    if (searchInput) {
        searchInput.disabled = !reachable || !modelReady || indexing || !indexedReady;
    }
}

function updateSemanticAskButtons() {
    const askBtn = document.getElementById('semanticAskBtn');
    const askAgainBtn = document.getElementById('semanticAskAgainBtn');
    const cancelBtn = document.getElementById('semanticCancelAskBtn');
    const questionInput = document.getElementById('semanticAskInput');
    const generationSelect = document.getElementById('semanticGenerationModelSelect');
    const modeSelect = document.getElementById('semanticAskModeSelect');

    const reachable = !!(semanticUiState.availability && semanticUiState.availability.reachable);
    const modelReady = !!(semanticUiState.availability && semanticUiState.availability.modelReady);
    const running = !!semanticUiState.ask.running;
    const indexedReady = semanticUiState.indexState === 'indexed' || semanticUiState.indexState === 'indexed_stale';

    if (askBtn) askBtn.disabled = !reachable || !modelReady || !indexedReady || running || semanticUiState.indexing;
    if (askAgainBtn) askAgainBtn.disabled = running || !indexedReady || !semanticUiState.ask.retrievedChunks.length || !semanticUiState.ask.lastQuestion;
    if (cancelBtn) {
        cancelBtn.hidden = !running;
        cancelBtn.disabled = !running;
    }
    if (questionInput) questionInput.disabled = false;
    if (generationSelect) generationSelect.disabled = running || generationSelect.options.length === 0;
    if (modeSelect) modeSelect.disabled = running;
}

async function openSemanticToolsModal() {
    const modal = getSemanticModal();
    if (!modal) return;
    const availability = await refreshSemanticAvailability(true);
    if (!(availability?.reachable)) return;
    modal.hidden = false;
    modal.classList.add('show');

    await refreshSemanticProjectSettings();
    await refreshSemanticIndexStatus();

    updateSemanticIndexButtons();
    updateSemanticAskButtons();
    renderSemanticResults(document.getElementById('semanticQueryInput')?.value || '');
    renderAskAnswer();
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

async function saveSemanticGenerationModel() {
    const select = document.getElementById('semanticGenerationModelSelect');
    const modelName = String(select?.value || '').trim();
    if (!modelName) {
        setSemanticAskStatus('Generation model is required.', true);
        return;
    }
    const result = await window.electronAPI.semanticSetGenerationModel(modelName);
    if (!result?.ok) {
        setSemanticAskStatus(result?.error || 'Could not save generation model.', true);
        return;
    }
    semanticUiState.ask.generationModel = modelName;
    setSemanticAskStatus(`Generation model saved: ${modelName}`);
    await refreshSemanticProjectSettings();
    updateSemanticAskButtons();
}

async function refreshSemanticModelList() {
    await refreshSemanticAvailability(true);
    await refreshSemanticProjectSettings();
    updateSemanticIndexButtons();
    updateSemanticAskButtons();
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

async function runSemanticAskInternal({ reuseEvidence = false } = {}) {
    if (!window.electronAPI?.semanticStartAsk) return;

    const askInput = document.getElementById('semanticAskInput');
    const languageSelect = document.getElementById('semanticAskLanguageSelect');
    const generationSelect = document.getElementById('semanticGenerationModelSelect');
    const modeSelect = document.getElementById('semanticAskModeSelect');
    const question = String(askInput?.value || semanticUiState.ask.lastQuestion || '').trim();
    if (!(semanticUiState.indexState === 'indexed' || semanticUiState.indexState === 'indexed_stale')) {
        setSemanticAskStatus('Index this project first before using Ask.', true);
        return;
    }
    if (!question) {
        setSemanticAskStatus('Please enter a question.', true);
        return;
    }

    semanticUiState.ask.running = true;
    semanticUiState.ask.phase = reuseEvidence ? 'generating' : 'retrieving';
    semanticUiState.ask.streamText = '';
    semanticUiState.ask.answer = null;
    semanticUiState.ask.answerText = '';
    semanticUiState.ask.verifiedCitationCount = 0;
    semanticUiState.ask.answerMode = String(modeSelect?.value || semanticUiState.ask.outputMode || 'strict');
    semanticUiState.ask.notes = '';
    semanticUiState.ask.rawOutput = '';
    semanticUiState.ask.fallback = false;
    semanticUiState.ask.sources = [];
    semanticUiState.ask.lastQuestion = question;
    semanticUiState.ask.outputLanguage = String(languageSelect?.value || 'sv');
    semanticUiState.ask.generationModel = String(generationSelect?.value || semanticUiState.ask.generationModel || '');
    semanticUiState.ask.outputMode = String(modeSelect?.value || semanticUiState.ask.outputMode || 'strict');
    if (reuseEvidence) {
        setSemanticAskStatus('Generating answer from existing evidence...');
    } else {
        setSemanticAskStatus('Retrieving evidence...');
    }
    renderAskAnswer();
    updateSemanticAskButtons();

    const result = await window.electronAPI.semanticStartAsk({
        question,
        outputLanguage: semanticUiState.ask.outputLanguage,
        outputMode: semanticUiState.ask.outputMode,
        generationModel: semanticUiState.ask.generationModel,
        documents: getSemanticTextDocuments(),
        retrievedChunks: (reuseEvidence && semanticUiState.ask.retrievedChunks.length > 0) ? semanticUiState.ask.retrievedChunks : []
    });

    if (!result?.ok) {
        semanticUiState.ask.running = false;
        semanticUiState.ask.phase = 'idle';
        setSemanticAskStatus(result?.error || 'Ask failed to start.', true);
        updateSemanticAskButtons();
    }
}

function runSemanticAsk() {
    return runSemanticAskInternal({ reuseEvidence: false });
}

function runSemanticAskAgain() {
    return runSemanticAskInternal({ reuseEvidence: true });
}

async function cancelSemanticAsk() {
    if (!window.electronAPI?.semanticCancelAsk) return;
    await window.electronAPI.semanticCancelAsk();
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

    const askInput = document.getElementById('semanticAskInput');
    if (askInput) {
        askInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            if (event.shiftKey) return;
            event.preventDefault();
            runSemanticAsk();
        });
    }

    const generationSelect = document.getElementById('semanticGenerationModelSelect');
    const modeSelect = document.getElementById('semanticAskModeSelect');
    if (generationSelect) {
        generationSelect.addEventListener('change', () => {
            semanticUiState.ask.generationModel = String(generationSelect.value || '');
            const recommended = getRecommendedAskMode(semanticUiState.ask.generationModel);
            semanticUiState.ask.modeManuallySet = false;
            semanticUiState.ask.outputMode = recommended;
            if (modeSelect) modeSelect.value = recommended;
        });
    }
    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            semanticUiState.ask.outputMode = String(modeSelect.value || 'strict');
            semanticUiState.ask.modeManuallySet = true;
        });
    }

    const askAnswer = document.getElementById('semanticAskAnswer');
    if (askAnswer) {
        askAnswer.addEventListener('click', (event) => {
            const sourceIdxBtn = event.target.closest('.semantic-ask-cite-chip[data-semantic-source-index]');
            if (sourceIdxBtn) {
                const idx = Number(sourceIdxBtn.dataset.semanticSourceIndex);
                const source = semanticUiState.ask.sources[idx];
                if (source) openAskSource(source);
                return;
            }
            const keyBtn = event.target.closest('.semantic-ask-cite-chip[data-semantic-source-key]');
            if (!keyBtn) return;
            const key = keyBtn.dataset.semanticSourceKey;
            const source = (semanticUiState.ask.sources || []).find((s) => `${s.docId}::${s.chunkId}` === key);
            if (source) openAskSource(source);
        });
    }

    const askSources = document.getElementById('semanticAskSources');
    if (askSources) {
        askSources.addEventListener('click', (event) => {
            const item = event.target.closest('.semantic-ask-source-item[data-semantic-source-index]');
            if (!item) return;
            const idx = Number(item.dataset.semanticSourceIndex);
            const source = semanticUiState.ask.sources[idx];
            openAskSource(source);
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

    if (window.electronAPI?.onSemanticAskRetrieved) {
        window.electronAPI.onSemanticAskRetrieved((payload) => {
            semanticUiState.ask.retrievedChunks = Array.isArray(payload?.retrievedChunks) ? payload.retrievedChunks : [];
            semanticUiState.ask.phase = 'generating';
            setSemanticAskStatus(semanticUiState.ask.outputMode === 'loose' ? 'Generating cited answer...' : 'Generating grounded answer...');
            renderAskAnswer();
            updateSemanticAskButtons();
        });
    }

    if (window.electronAPI?.onSemanticAskStream) {
        window.electronAPI.onSemanticAskStream((payload) => {
            semanticUiState.ask.streamText += String(payload?.delta || '');
            if (semanticUiState.ask.running && semanticUiState.ask.phase !== 'validating' && semanticUiState.ask.phase !== 'repairing') {
                setSemanticAskStatus('Generating grounded answer...');
            }
        });
    }

    if (window.electronAPI?.onSemanticAskPhase) {
        window.electronAPI.onSemanticAskPhase((payload) => {
            const phase = String(payload?.phase || '').trim();
            if (!phase) return;
            semanticUiState.ask.phase = phase;
            if (phase === 'validating') {
                setSemanticAskStatus('Validating citations...');
            } else if (phase === 'planning') {
                setSemanticAskStatus('Planning evidence set...');
            } else if (phase === 'repairing') {
                setSemanticAskStatus('Repairing model output...');
            } else if (phase === 'generating') {
                setSemanticAskStatus(semanticUiState.ask.outputMode === 'loose' ? 'Generating cited answer...' : 'Generating grounded answer...');
            }
            updateSemanticAskButtons();
        });
    }

    if (window.electronAPI?.onSemanticAskDone) {
        window.electronAPI.onSemanticAskDone((payload) => {
            semanticUiState.ask.running = false;
            semanticUiState.ask.phase = 'idle';
            semanticUiState.ask.answer = Array.isArray(payload?.answer) ? payload.answer : [];
            semanticUiState.ask.answerText = String(payload?.answerText || '');
            semanticUiState.ask.answerMode = String(payload?.answerMode || semanticUiState.ask.outputMode || 'strict');
            semanticUiState.ask.verifiedCitationCount = Number(payload?.verifiedCitationCount || 0);
            semanticUiState.ask.notes = String(payload?.notes || '').trim();
            semanticUiState.ask.rawOutput = String(payload?.rawOutput || '');
            semanticUiState.ask.fallback = !!payload?.fallback;
            semanticUiState.ask.sources = (Array.isArray(payload?.sources) ? payload.sources : []).map((source) => {
                const chunk = (semanticUiState.ask.retrievedChunks || []).find((c) => c.docId === source.docId && c.chunkId === source.chunkId);
                return {
                    ...source,
                    fullText: chunk?.text || source.snippet || ''
                };
            });
            if (Array.isArray(payload?.retrievedChunks)) {
                semanticUiState.ask.retrievedChunks = payload.retrievedChunks;
            }
            if (payload?.repaired) {
                semanticUiState.ask.notes = `${semanticUiState.ask.notes} Response was repaired for parsing/validation.`.trim();
            }
            semanticUiState.ask.streamText = '';
            renderAskAnswer();
            const hasStructured = Array.isArray(semanticUiState.ask.answer) && semanticUiState.ask.answer.length > 0;
            const hasLooseText = !!String(semanticUiState.ask.answerText || '').trim();
            if (!hasStructured && !hasLooseText) {
                setSemanticAskStatus('No cited answer produced. Showing retrieved sources and notes.');
            } else {
                setSemanticAskStatus('');
            }
            updateSemanticAskButtons();
        });
    }

    if (window.electronAPI?.onSemanticAskError) {
        window.electronAPI.onSemanticAskError((payload) => {
            semanticUiState.ask.running = false;
            semanticUiState.ask.phase = 'idle';
            if (payload?.code === 'ASK_CANCELLED') {
                setSemanticAskStatus('Ask cancelled.');
            } else if (payload?.message && String(payload.message).toLowerCase().includes('abort')) {
                setSemanticAskStatus('Ask was interrupted. Try Ask again.', true);
            } else {
                setSemanticAskStatus(payload?.message || 'Ask failed.', true);
            }
            semanticUiState.ask.streamText = '';
            semanticUiState.ask.rawOutput = '';
            semanticUiState.ask.fallback = false;
            semanticUiState.ask.verifiedCitationCount = 0;
            renderAskAnswer();
            updateSemanticAskButtons();
        });
    }
}

async function initSemanticTools() {
    const btn = getSemanticButton();
    if (!btn || !window.electronAPI) return;

    semanticUiState.ask.running = false;
    semanticUiState.ask.phase = 'idle';
    semanticUiState.ask.lastQuestion = '';
    setSemanticAskStatus('');

    bindSemanticToolListeners();
    toggleSemanticTool('search');
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

    if (window.electronAPI?.semanticGetAskState) {
        const askState = await window.electronAPI.semanticGetAskState();
        const running = askState?.ok && askState.state && askState.state.status === 'running';
        if (running) {
            semanticUiState.ask.running = true;
            semanticUiState.ask.phase = 'generating';
            semanticUiState.ask.lastQuestion = String(askState.state.question || '');
            semanticUiState.ask.generationModel = String(askState.state.generationModel || '');
            setSemanticAskStatus(semanticUiState.ask.outputMode === 'loose' ? 'Generating cited answer...' : 'Generating grounded answer...');
        } else {
            semanticUiState.ask.running = false;
            semanticUiState.ask.phase = 'idle';
            semanticUiState.ask.lastQuestion = '';
        }
    }

    updateSemanticIndexButtons();
    updateSemanticAskButtons();
    renderAskAnswer();

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

function showSemanticToolSearch() {
    toggleSemanticTool('search');
}

function showSemanticToolAsk() {
    toggleSemanticTool('ask');
}
