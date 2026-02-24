const { parentPort, workerData } = require('worker_threads');
const { openSemanticStore } = require('./store');
const { cosineSimilarity } = require('./vector');
const { rerankCandidates } = require('./rerank');

function siftUpScoreMinHeap(heap, index) {
  let i = index;
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    if (heap[parent].score <= heap[i].score) break;
    const tmp = heap[parent];
    heap[parent] = heap[i];
    heap[i] = tmp;
    i = parent;
  }
}

function siftDownScoreMinHeap(heap, index) {
  let i = index;
  while (true) {
    const left = (i * 2) + 1;
    const right = left + 1;
    let smallest = i;

    if (left < heap.length && heap[left].score < heap[smallest].score) smallest = left;
    if (right < heap.length && heap[right].score < heap[smallest].score) smallest = right;
    if (smallest === i) break;

    const tmp = heap[i];
    heap[i] = heap[smallest];
    heap[smallest] = tmp;
    i = smallest;
  }
}

function pushBoundedTopKByScore(minHeap, item, limit) {
  if (limit <= 0) return;
  if (minHeap.length < limit) {
    minHeap.push(item);
    siftUpScoreMinHeap(minHeap, minHeap.length - 1);
    return;
  }
  if (item.score <= minHeap[0].score) return;
  minHeap[0] = item;
  siftDownScoreMinHeap(minHeap, 0);
}

function normalizeTopK(value) {
  const topK = Number(value);
  if (!Number.isFinite(topK) || topK <= 0) return 1;
  return Math.max(1, Math.floor(topK));
}

function normalizeCandidateK(topK, value) {
  const candidateK = Number(value);
  if (!Number.isFinite(candidateK) || candidateK <= 0) return topK;
  return Math.max(topK, Math.floor(candidateK));
}

(async () => {
  try {
    if (!parentPort) throw new Error('Search worker missing parent port.');

    const dbPath = String(workerData?.dbPath || '').trim();
    const modelName = String(workerData?.modelName || '').trim();
    const queryEmbedding = Array.isArray(workerData?.queryEmbedding) ? workerData.queryEmbedding : [];
    const queryText = String(workerData?.queryText || '');
    const topK = normalizeTopK(workerData?.topK);
    const candidateK = normalizeCandidateK(topK, workerData?.candidateK);

    if (!dbPath) throw new Error('Search worker requires dbPath.');
    if (!modelName) throw new Error('Search worker requires modelName.');
    if (queryEmbedding.length === 0) {
      parentPort.postMessage({ type: 'done', payload: { results: [] } });
      return;
    }

    const store = openSemanticStore(dbPath);
    let rows = [];
    try {
      rows = store.getEmbeddingsForModel(modelName);
    } finally {
      store.close();
    }

    const best = [];
    rows.forEach((row) => {
      const score = cosineSimilarity(queryEmbedding, row.embedding);
      pushBoundedTopKByScore(best, {
        doc_id: row.docId,
        chunk_id: row.chunkId,
        chunk_index: row.chunkIndex,
        start_char: row.startChar,
        end_char: row.endChar,
        score: Number.isFinite(score) ? score : 0,
        chunk_text_preview: row.chunkTextPreview || ''
      }, candidateK);
    });

    best.sort((a, b) => b.score - a.score);
    const reranked = rerankCandidates(queryText, best.map((row) => ({
      ...row,
      text: row.chunk_text_preview || ''
    })));
    const results = reranked.slice(0, topK).map((row) => ({
      doc_id: row.doc_id,
      chunk_id: row.chunk_id,
      chunk_index: row.chunk_index,
      start_char: row.start_char,
      end_char: row.end_char,
      score: Number(row.rerankScore || row.score || 0),
      semantic_score: Number(row.semanticScore || row.score || 0)
    }));
    parentPort.postMessage({ type: 'done', payload: { results } });
  } catch (err) {
    parentPort?.postMessage({
      type: 'error',
      payload: {
        ok: false,
        code: String(err?.code || 'SEARCH_FAILED'),
        message: err?.message || String(err)
      }
    });
  }
})();
