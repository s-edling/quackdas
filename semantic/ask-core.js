const { openSemanticStore } = require('./store');
const { cosineSimilarity } = require('./vector');
const { canonicalizeText } = require('./text');
const { SEMANTIC_DEFAULTS } = require('./config');
const { embedText } = require('./ollama-embeddings');
const { parseAskJson, validateAskResponse, parseLooseCitedResponse, validateLooseCitedResponse } = require('./ask-validation');
const { rerankCandidates } = require('./rerank');

function truncateChunkForPrompt(text, maxChars) {
  const raw = String(text || '');
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n...[truncated]`;
}

function buildDocMap(documents) {
  const map = new Map();
  (Array.isArray(documents) ? documents : []).forEach((doc) => {
    if (!doc || !doc.id) return;
    map.set(String(doc.id), {
      id: String(doc.id),
      title: String(doc.title || 'Untitled document'),
      content: canonicalizeText(doc.content || '')
    });
  });
  return map;
}

function buildRetrievedChunks(scoredRows, docMap, options = {}) {
  const maxChars = Math.max(400, Number(options.maxPromptChunkChars || SEMANTIC_DEFAULTS.askMaxChunkCharsForPrompt));
  return scoredRows.map((row, idx) => {
    const doc = docMap.get(row.docId);
    const fullText = String(doc?.content || '').slice(row.startChar, row.endChar);
    return {
      rank: idx + 1,
      docId: row.docId,
      docTitle: doc?.title || row.docId,
      chunkId: row.chunkId,
      chunkIndex: row.chunkIndex,
      startChar: row.startChar,
      endChar: row.endChar,
      score: row.score,
      text: fullText,
      promptText: truncateChunkForPrompt(fullText, maxChars)
    };
  });
}

async function retrieveTopKChunks(payload) {
  const dbPath = String(payload.dbPath || '');
  const question = String(payload.question || '').trim();
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  const embeddingModel = String(payload.embeddingModel || '').trim();
  const topK = Math.max(1, Number(payload.topK || SEMANTIC_DEFAULTS.askTopK));
  const candidateK = Math.max(
    topK,
    Number(payload.rerankCandidateK || (topK * Number(SEMANTIC_DEFAULTS.askRerankCandidateMultiplier || 3)))
  );

  if (!question) throw new Error('Question is empty.');
  if (!embeddingModel) throw new Error('Embedding model is not set.');

  const timeoutMs = payload.timeoutMs == null ? SEMANTIC_DEFAULTS.ollamaTimeoutMs : Number(payload.timeoutMs);
  const questionEmbedding = await (payload.embedTextFn || embedText)(embeddingModel, question, {
    baseUrl: payload.baseUrl || SEMANTIC_DEFAULTS.ollamaBaseUrl,
    timeoutMs,
    signal: payload.signal
  });

  const store = openSemanticStore(dbPath);
  let rows;
  try {
    rows = store.getEmbeddingsForModel(embeddingModel);
  } finally {
    store.close();
  }

  const docMap = buildDocMap(documents);
  const scored = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ...row,
      score: cosineSimilarity(questionEmbedding, row.embedding)
    }))
    .filter((row) => docMap.has(row.docId))
    .sort((a, b) => b.score - a.score)
    .slice(0, candidateK);

  const chunkCandidates = buildRetrievedChunks(scored, docMap, payload);
  const reranked = rerankCandidates(question, chunkCandidates.map((chunk) => ({
    ...chunk,
    score: chunk.score,
    text: chunk.text
  })));

  return reranked.slice(0, topK).map((row, idx) => ({
    rank: idx + 1,
    docId: row.docId,
    docTitle: row.docTitle,
    chunkId: row.chunkId,
    chunkIndex: row.chunkIndex,
    startChar: row.startChar,
    endChar: row.endChar,
    score: Number(row.rerankScore || row.score || 0),
    text: row.text,
    promptText: row.promptText
  }));
}

function buildAskSystemPrompt(language, mode = 'strict') {
  const targetLanguage = (String(language || 'sv').toLowerCase() === 'en') ? 'English' : 'Swedish';
  const askMode = String(mode || 'strict').toLowerCase() === 'loose' ? 'loose' : 'strict';
  if (askMode === 'loose') {
    return [
      'You are a grounded QA assistant.',
      'Use ONLY provided context. No external knowledge.',
      'Respond in two parts:',
      '1) Free-text answer using inline citation markers [1], [2], ...',
      '2) SOURCES section, one per line: [n] {"doc_id":"...","chunk_id":"..."}',
      'For interpretive statements, prefix sentence with "Hypothesis:" or "Possible interpretation:".',
      'If evidence is weak, still provide short cautious directions and cite relevant sources.',
      `Write in ${targetLanguage}.`
    ].join('\n');
  }
  return [
    'You are a grounded QA assistant.',
    'Answer ONLY from provided sources. No external knowledge.',
    'Return JSON ONLY with exact schema:',
    '{"answer":[{"claim":"string","citations":[{"chunk_id":"string","doc_id":"string"}],"quotes":[{"chunk_id":"string","doc_id":"string","quote":"verbatim substring <= 25 words"}]}],"notes":"string"}',
    'Quotes are optional.',
    'Citations should be attached across the answer; ensure at least 2 total citations.',
    'Citations can only use provided doc_id/chunk_id pairs.',
    'If evidence is insufficient, still provide a short cautious suggestion with citations, or answer [] with notes.',
    `Write claims and notes in ${targetLanguage}.`
  ].join('\n');
}

function buildAskUserPrompt(question, retrievedChunks) {
  const contextRows = retrievedChunks.map((chunk) => ({
    rank: chunk.rank,
    doc_id: chunk.docId,
    doc_title: chunk.docTitle,
    chunk_id: chunk.chunkId,
    chunk_index: chunk.chunkIndex,
    start_char: chunk.startChar,
    end_char: chunk.endChar,
    text: chunk.promptText
  }));

  return JSON.stringify({
    question: String(question || ''),
    context: contextRows
  });
}

function parseAndValidateAskOutput(rawText, retrievedChunks, options = {}) {
  const mode = String(options.mode || 'strict').toLowerCase() === 'loose' ? 'loose' : 'strict';
  const minCitationsOverall = Math.max(1, Number(options.minCitationsOverall || 2));
  if (mode === 'loose') {
    const parsedLoose = parseLooseCitedResponse(rawText);
    return validateLooseCitedResponse(parsedLoose, retrievedChunks, { minCitationsOverall });
  }
  const parsed = parseAskJson(rawText);
  return validateAskResponse(parsed, retrievedChunks, { minCitationsOverall });
}

module.exports = {
  retrieveTopKChunks,
  buildAskSystemPrompt,
  buildAskUserPrompt,
  parseAndValidateAskOutput
};
