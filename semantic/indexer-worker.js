const { parentPort, workerData } = require('worker_threads');
const { runIncrementalIndexing } = require('./indexing-core');

let cancelled = false;

parentPort.on('message', (msg) => {
  if (msg && msg.type === 'cancel') {
    cancelled = true;
  }
});

(async () => {
  try {
    const result = await runIncrementalIndexing({
      ...workerData,
      shouldCancel: () => cancelled,
      onProgress: (payload) => {
        parentPort.postMessage({ type: 'progress', payload });
      }
    });

    if (cancelled) {
      parentPort.postMessage({
        type: 'cancelled',
        payload: { ok: false, code: 'INDEX_CANCELLED', message: 'Indexing cancelled.' }
      });
      return;
    }

    parentPort.postMessage({ type: 'done', payload: result });
  } catch (err) {
    const code = err?.code || 'INDEX_FAILED';
    if (code === 'INDEX_CANCELLED') {
      parentPort.postMessage({
        type: 'cancelled',
        payload: { ok: false, code: 'INDEX_CANCELLED', message: 'Indexing cancelled.' }
      });
      return;
    }
    parentPort.postMessage({
      type: 'error',
      payload: {
        ok: false,
        code,
        message: err?.message || String(err)
      }
    });
  }
})();
