const { SEMANTIC_DEFAULTS } = require('./config');

class OllamaError extends Error {
  constructor(message, code = 'OLLAMA_ERROR') {
    super(message);
    this.name = 'OllamaError';
    this.code = code;
  }
}

async function requestJson(baseUrl, pathName, options = {}) {
  const timeoutMs = Number(options.timeoutMs || SEMANTIC_DEFAULTS.ollamaTimeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${pathName}`, {
      method: options.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}),
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal || controller.signal
    });

    const bodyText = await response.text();
    let body = {};
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch (_) {
        body = { raw: bodyText };
      }
    }

    if (!response.ok) {
      const detail = body?.error || body?.message || bodyText || `HTTP ${response.status}`;
      throw new OllamaError(`Ollama request failed: ${detail}`, 'OLLAMA_HTTP_ERROR');
    }

    return body;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new OllamaError('Ollama request timed out. Verify local model and try again.', 'OLLAMA_TIMEOUT');
    }
    if (err instanceof OllamaError) throw err;
    throw new OllamaError('Could not reach Ollama at localhost:11434. Start Ollama and try again.', 'OLLAMA_UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }
}

async function listModels(baseUrl = SEMANTIC_DEFAULTS.ollamaBaseUrl, options = {}) {
  const body = await requestJson(baseUrl, '/api/tags', { timeoutMs: options.timeoutMs });
  const rows = Array.isArray(body?.models) ? body.models : [];
  return rows
    .map((row) => String(row?.name || '').trim())
    .filter(Boolean);
}

async function isOllamaReachable(baseUrl = SEMANTIC_DEFAULTS.ollamaBaseUrl, options = {}) {
  try {
    await listModels(baseUrl, options);
    return true;
  } catch (_) {
    return false;
  }
}

async function embedText(modelName, prompt, options = {}) {
  const model = String(modelName || '').trim();
  if (!model) {
    throw new OllamaError('Embedding model name is empty.', 'MODEL_MISSING');
  }

  const body = await requestJson(options.baseUrl || SEMANTIC_DEFAULTS.ollamaBaseUrl, '/api/embeddings', {
    method: 'POST',
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    body: {
      model,
      prompt: String(prompt || '')
    }
  });

  const vector = Array.isArray(body?.embedding) ? body.embedding : null;
  if (!vector || vector.length === 0) {
    const errMessage = String(body?.error || '').toLowerCase();
    if (errMessage.includes('model') && errMessage.includes('not found')) {
      throw new OllamaError(`Model "${model}" is not available locally. Pull it first: ollama pull ${model}`, 'MODEL_NOT_FOUND');
    }
    throw new OllamaError('Ollama returned an invalid embedding payload.', 'INVALID_EMBEDDING_PAYLOAD');
  }

  return vector.map((v) => Number(v) || 0);
}

async function embedMany(texts, options = {}) {
  const model = String(options.modelName || '').trim();
  if (!model) throw new OllamaError('Embedding model name is empty.', 'MODEL_MISSING');

  const list = Array.isArray(texts) ? texts : [];
  const concurrency = Math.max(1, Number(options.concurrency || SEMANTIC_DEFAULTS.embeddingConcurrency));
  const out = new Array(list.length);
  let cursor = 0;

  async function worker() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      if (typeof options.shouldCancel === 'function' && options.shouldCancel()) {
        throw new OllamaError('Indexing cancelled by user.', 'INDEX_CANCELLED');
      }
      out[index] = await embedText(model, list[index], {
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
        signal: options.signal
      });
      if (typeof options.onProgress === 'function') {
        options.onProgress(index + 1, list.length);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, list.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return out;
}

module.exports = {
  OllamaError,
  listModels,
  isOllamaReachable,
  embedText,
  embedMany
};
