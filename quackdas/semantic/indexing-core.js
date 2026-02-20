const { createDeterministicChunks } = require('./chunker');
const { canonicalizeText, getDocumentTextHash } = require('./text');
const { openSemanticStore } = require('./store');
const { embedMany } = require('./ollama-embeddings');
const { SEMANTIC_DEFAULTS } = require('./config');

function toPreview(text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function normalizeSemanticDocs(rawDocs) {
  const docs = Array.isArray(rawDocs) ? rawDocs : [];
  return docs
    .filter((doc) => doc && typeof doc === 'object' && doc.id)
    .map((doc) => ({
      id: String(doc.id),
      title: String(doc.title || 'Untitled document'),
      type: String(doc.type || 'text'),
      content: canonicalizeText(doc.content || '')
    }))
    .filter((doc) => doc.type !== 'pdf');
}

async function runIncrementalIndexing(payload) {
  const docs = normalizeSemanticDocs(payload.documents);
  const dbPath = String(payload.dbPath || '');
  const modelName = String(payload.modelName || SEMANTIC_DEFAULTS.embeddingModel);

  const settings = {
    chunkMin: Number(payload.chunkMin || SEMANTIC_DEFAULTS.chunkTargetMinChars),
    chunkMax: Number(payload.chunkMax || SEMANTIC_DEFAULTS.chunkTargetMaxChars),
    chunkOverlap: Number(payload.chunkOverlap || SEMANTIC_DEFAULTS.chunkOverlapChars),
    embeddingConcurrency: Number(payload.embeddingConcurrency || SEMANTIC_DEFAULTS.embeddingConcurrency)
  };

  const shouldCancel = (typeof payload.shouldCancel === 'function') ? payload.shouldCancel : () => false;
  const onProgress = (typeof payload.onProgress === 'function') ? payload.onProgress : () => {};
  const embedManyImpl = (typeof payload.embedMany === 'function') ? payload.embedMany : embedMany;

  const store = openSemanticStore(dbPath);
  const startedAt = Date.now();

  try {
    store.setMeta('embedding_model_name', modelName);

    const plans = docs.map((doc) => {
      const docHash = getDocumentTextHash(doc.content);
      const chunks = createDeterministicChunks(doc.id, doc.content, {
        minChars: settings.chunkMin,
        maxChars: settings.chunkMax,
        overlapChars: settings.chunkOverlap
      }).map((chunk) => ({
        docId: doc.id,
        docTitle: doc.title,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
        textSlice: chunk.textSlice,
        hash: chunk.hash,
        preview: toPreview(chunk.textSlice)
      }));

      const existing = store.getDocChunkMap(doc.id);
      const changed = chunks.filter((chunk) => {
        const row = existing.get(chunk.chunkId);
        if (!row) return true;
        if (row.hash !== chunk.hash) return true;
        if (row.modelName !== modelName) return true;
        return false;
      });

      return {
        doc,
        docHash,
        chunks,
        changed
      };
    });

    const totalToEmbed = plans.reduce((sum, plan) => sum + plan.changed.length, 0);
    let embeddedSoFar = 0;

    onProgress({
      phase: 'indexing',
      percent: totalToEmbed === 0 ? 100 : 0,
      currentDocName: plans[0]?.doc?.title || '',
      embeddedChunks: 0,
      totalChunks: totalToEmbed
    });

    for (let p = 0; p < plans.length; p++) {
      if (shouldCancel()) {
        const err = new Error('Indexing cancelled');
        err.code = 'INDEX_CANCELLED';
        throw err;
      }

      const plan = plans[p];
      const chunkIds = plan.chunks.map((chunk) => chunk.chunkId);
      const vectorByChunkId = new Map();

      if (plan.changed.length > 0) {
        const vectors = await embedManyImpl(
          plan.changed.map((chunk) => chunk.textSlice),
          {
            modelName,
            concurrency: settings.embeddingConcurrency,
            shouldCancel,
            onProgress: (_done) => {
              embeddedSoFar += 1;
              const percent = totalToEmbed > 0 ? Math.round((embeddedSoFar / totalToEmbed) * 100) : 100;
              onProgress({
                phase: 'indexing',
                percent,
                currentDocName: plan.doc.title,
                embeddedChunks: embeddedSoFar,
                totalChunks: totalToEmbed
              });
            }
          }
        );
        for (let i = 0; i < plan.changed.length; i++) {
          vectorByChunkId.set(plan.changed[i].chunkId, vectors[i]);
        }
      }

      store.begin();
      try {
        for (let i = 0; i < plan.chunks.length; i++) {
          const chunk = plan.chunks[i];
          const maybeVector = vectorByChunkId.get(chunk.chunkId) || null;
          store.upsertChunk(chunk, modelName, maybeVector);
        }
        store.deleteChunksNotIn(plan.doc.id, chunkIds);
        store.upsertDocState(plan.doc.id, plan.docHash, plan.chunks.length);
        store.commit();
      } catch (err) {
        store.rollback();
        throw err;
      }
    }

    const durationMs = Date.now() - startedAt;
    return {
      ok: true,
      indexedDocs: plans.length,
      embeddedChunks: totalToEmbed,
      durationMs
    };
  } finally {
    store.close();
  }
}

module.exports = {
  runIncrementalIndexing,
  normalizeSemanticDocs
};
