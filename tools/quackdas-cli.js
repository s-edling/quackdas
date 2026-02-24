#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SEMANTIC_DEFAULTS } = require('../semantic/config');
const { assertLocalOllamaBaseUrl, listModels, embedText } = require('../semantic/ollama-embeddings');

let _semanticStore = null;
let _vector = null;
let _rerank = null;

function getSemanticStore() {
  if (!_semanticStore) _semanticStore = require('../semantic/store');
  return _semanticStore;
}

function getVector() {
  if (!_vector) _vector = require('../semantic/vector');
  return _vector;
}

function getRerank() {
  if (!_rerank) _rerank = require('../semantic/rerank');
  return _rerank;
}

function printUsage() {
  console.log([
    'Quackdas local CLI',
    '',
    'Usage:',
    '  quackdas-cli models list',
    '  quackdas-cli semantic status --project /path/to/project.qdpx',
    '  quackdas-cli semantic search --project /path/to/project.qdpx --query "..." [--top-k 20] [--model bge-m3:latest]',
    '  quackdas-cli semantic ask --project /path/to/project.qdpx --question "..." [--top-k 8] [--embed-model ...] [--gen-model ...] [--language en|sv]',
    '',
    'Notes:',
    '  - Local-only: Ollama endpoint is restricted to localhost/127.0.0.1',
    '  - Reads semantic index only; does not mutate project files'
  ].join('\n'));
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function sanitizeName(value, fallback = 'project') {
  const out = String(value || '')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 80);
  return out || fallback;
}

function getUserDataDir() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Quackdas');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Quackdas');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Quackdas');
}

function getManagedSemanticDbPath(projectPath) {
  const resolved = path.resolve(String(projectPath || ''));
  const base = path.basename(resolved, path.extname(resolved));
  const safeBase = sanitizeName(base, 'project');
  const hash = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 16);
  return path.join(getUserDataDir(), 'Indexes', `${safeBase}-${hash}.semantic.sqlite`);
}

function resolveProjectPath(args) {
  const projectPath = String(args.project || '').trim();
  if (!projectPath) throw new Error('Missing required --project path.');
  const resolved = path.resolve(projectPath);
  if (!fs.existsSync(resolved)) throw new Error(`Project file not found: ${resolved}`);
  return resolved;
}

function chooseEmbeddingModel(args, models, store) {
  const explicit = String(args.model || args['embed-model'] || '').trim();
  if (explicit) return explicit;
  const stored = String(store.getMeta('embedding_model_name') || '').trim();
  if (stored) return stored;
  const names = Array.isArray(models) ? models : [];
  return names.find((name) => /^bge-m3(?::|$)/i.test(name))
    || names.find((name) => /^nomic-embed-text(?::|$)/i.test(name))
    || names[0]
    || '';
}

function chooseGenerationModel(args, models, store) {
  const explicit = String(args['gen-model'] || '').trim();
  if (explicit) return explicit;
  const stored = String(store.getMeta('generation_model_name') || '').trim();
  if (stored) return stored;
  const names = Array.isArray(models) ? models : [];
  return names.find((name) => /^qwen/i.test(name))
    || names.find((name) => /^llama/i.test(name))
    || names.find((name) => /^gemma/i.test(name))
    || names[0]
    || '';
}

async function runModelsList() {
  const models = await listModels(assertLocalOllamaBaseUrl(SEMANTIC_DEFAULTS.ollamaBaseUrl));
  console.log(JSON.stringify({ ok: true, models }, null, 2));
}

function readRowsForSearch(dbPath, modelName) {
  const { openSemanticStore } = getSemanticStore();
  const store = openSemanticStore(dbPath);
  try {
    return store.getEmbeddingsForModel(modelName);
  } finally {
    store.close();
  }
}

function buildSearchResultRows(query, rows, queryEmbedding, topK, candidateK) {
  const { cosineSimilarity } = getVector();
  const { rerankCandidates } = getRerank();
  const scored = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ...row,
      score: cosineSimilarity(queryEmbedding, row.embedding),
      text: String(row.chunkTextPreview || '')
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, candidateK);

  const reranked = rerankCandidates(query, scored);
  return reranked.slice(0, topK).map((row, idx) => ({
    rank: idx + 1,
    doc_id: row.docId,
    chunk_id: row.chunkId,
    start_char: row.startChar,
    end_char: row.endChar,
    score: Number(row.rerankScore || row.score || 0),
    semantic_score: Number(row.semanticScore || row.score || 0),
    snippet: String(row.chunkTextPreview || '').slice(0, 240)
  }));
}

async function runSemanticStatus(args) {
  const projectPath = resolveProjectPath(args);
  const dbPath = getManagedSemanticDbPath(projectPath);
  const exists = fs.existsSync(dbPath);
  const models = await listModels(assertLocalOllamaBaseUrl(SEMANTIC_DEFAULTS.ollamaBaseUrl));

  let chunkCount = 0;
  let docStates = [];
  let embeddingModel = '';
  let generationModel = '';
  if (exists) {
    const { openSemanticStore } = getSemanticStore();
    const store = openSemanticStore(dbPath);
    try {
      chunkCount = store.getTotalChunkCount();
      docStates = store.getAllDocStates();
      embeddingModel = String(store.getMeta('embedding_model_name') || '');
      generationModel = String(store.getMeta('generation_model_name') || '');
    } finally {
      store.close();
    }
  }

  console.log(JSON.stringify({
    ok: true,
    projectPath,
    dbPath,
    indexExists: exists,
    chunkCount,
    docCount: docStates.length,
    embeddingModel,
    generationModel,
    ollamaModels: models
  }, null, 2));
}

async function runSemanticSearch(args) {
  const projectPath = resolveProjectPath(args);
  const dbPath = getManagedSemanticDbPath(projectPath);
  if (!fs.existsSync(dbPath)) throw new Error(`Semantic index not found for project: ${dbPath}`);
  const query = String(args.query || '').trim();
  if (!query) throw new Error('Missing required --query text.');

  const topK = Math.max(1, Number(args['top-k'] || args.topK || SEMANTIC_DEFAULTS.searchTopK) || SEMANTIC_DEFAULTS.searchTopK);
  const candidateK = Math.max(topK, Math.floor(topK * Number(SEMANTIC_DEFAULTS.searchRerankCandidateMultiplier || 3)));
  const models = await listModels(assertLocalOllamaBaseUrl(SEMANTIC_DEFAULTS.ollamaBaseUrl));
  const { openSemanticStore } = getSemanticStore();
  const store = openSemanticStore(dbPath);
  let embeddingModel = '';
  try {
    embeddingModel = chooseEmbeddingModel(args, models, store);
  } finally {
    store.close();
  }
  if (!embeddingModel) throw new Error('No embedding model available. Install one via Ollama.');

  const queryEmbedding = await embedText(embeddingModel, query, {
    baseUrl: assertLocalOllamaBaseUrl(SEMANTIC_DEFAULTS.ollamaBaseUrl),
    timeoutMs: SEMANTIC_DEFAULTS.ollamaTimeoutMs
  });
  const rows = readRowsForSearch(dbPath, embeddingModel);
  const results = buildSearchResultRows(query, rows, queryEmbedding, topK, candidateK);
  console.log(JSON.stringify({ ok: true, embeddingModel, count: results.length, results }, null, 2));
}

async function runSemanticAsk(args) {
  const projectPath = resolveProjectPath(args);
  const dbPath = getManagedSemanticDbPath(projectPath);
  if (!fs.existsSync(dbPath)) throw new Error(`Semantic index not found for project: ${dbPath}`);
  const question = String(args.question || '').trim();
  if (!question) throw new Error('Missing required --question text.');

  const topK = Math.max(1, Number(args['top-k'] || args.topK || SEMANTIC_DEFAULTS.askTopK) || SEMANTIC_DEFAULTS.askTopK);
  const candidateK = Math.max(topK, Math.floor(topK * Number(SEMANTIC_DEFAULTS.askRerankCandidateMultiplier || 3)));
  const language = String(args.language || 'en').toLowerCase() === 'sv' ? 'Swedish' : 'English';
  const localBaseUrl = assertLocalOllamaBaseUrl(SEMANTIC_DEFAULTS.ollamaBaseUrl);
  const models = await listModels(localBaseUrl);

  const { openSemanticStore } = getSemanticStore();
  const store = openSemanticStore(dbPath);
  let embeddingModel = '';
  let generationModel = '';
  try {
    embeddingModel = chooseEmbeddingModel(args, models, store);
    generationModel = chooseGenerationModel(args, models, store);
  } finally {
    store.close();
  }
  if (!embeddingModel) throw new Error('No embedding model available for retrieval.');
  if (!generationModel) throw new Error('No generation model available for Ask.');

  const queryEmbedding = await embedText(embeddingModel, question, {
    baseUrl: localBaseUrl,
    timeoutMs: SEMANTIC_DEFAULTS.ollamaTimeoutMs
  });
  const rows = readRowsForSearch(dbPath, embeddingModel);
  const retrieved = buildSearchResultRows(question, rows, queryEmbedding, topK, candidateK);
  if (retrieved.length === 0) {
    console.log(JSON.stringify({ ok: true, generationModel, answer: '', sources: [], notes: 'No indexed chunks found for this model.' }, null, 2));
    return;
  }

  const contextRows = retrieved.map((row, idx) => ({
    marker: idx + 1,
    doc_id: row.doc_id,
    chunk_id: row.chunk_id,
    text: row.snippet
  }));

  const response = await fetch(`${localBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: generationModel,
      stream: false,
      options: { num_ctx: SEMANTIC_DEFAULTS.askGenerationNumCtx },
      messages: [
        {
          role: 'system',
          content: [
            'Answer only from the provided sources.',
            'Write short grounded prose with inline citations like [1], [2].',
            `Write in ${language}.`,
            'If uncertain, say so briefly and still cite what you used.'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            question,
            context: contextRows
          })
        }
      ]
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Generation failed: ${body || response.status}`);
  }
  const payload = await response.json();
  const answer = String(payload?.message?.content || '').trim();
  console.log(JSON.stringify({
    ok: true,
    generationModel,
    embeddingModel,
    answer,
    sources: retrieved
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [group, action] = args._;
  if (!group || !action) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (group === 'models' && action === 'list') {
    await runModelsList();
    return;
  }
  if (group === 'semantic' && action === 'status') {
    await runSemanticStatus(args);
    return;
  }
  if (group === 'semantic' && action === 'search') {
    await runSemanticSearch(args);
    return;
  }
  if (group === 'semantic' && action === 'ask') {
    await runSemanticAsk(args);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err?.message || String(err)
  }, null, 2));
  process.exitCode = 1;
});
