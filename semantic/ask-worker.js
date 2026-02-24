const { parentPort, workerData } = require('worker_threads');
const { SEMANTIC_DEFAULTS } = require('./config');
const { retrieveTopKChunks, buildAskSystemPrompt, buildAskUserPrompt, parseAndValidateAskOutput } = require('./ask-core');
const { extractFirstBalancedObject } = require('./ask-validation');

let cancelled = false;
const controllers = new Set();
const MISSING_ANSWER_ARRAY_ERROR = 'Model JSON must include answer array.';

function makeController() {
  const c = new AbortController();
  controllers.add(c);
  return c;
}

function clearController(c) {
  controllers.delete(c);
}

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'cancel') {
    cancelled = true;
    controllers.forEach((c) => c.abort());
  }
});

function assertLocalBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) throw new Error('Ollama base URL is empty.');
  const url = new URL(raw);
  const allowed = new Set(['localhost', '127.0.0.1']);
  if (!allowed.has(url.hostname)) {
    throw new Error('Only local Ollama endpoints are allowed. Use localhost or 127.0.0.1.');
  }
  return `${url.protocol}//${url.host}`;
}

function buildGracefulNoAnswerResult(rawMessage) {
  const message = String(rawMessage || '').trim();
  const notes = [
    'Could not produce a valid grounded answer structure from the model output.',
    message ? `Technical details: ${message}` : '',
    'Try Ask again, simplify the question, or switch generation model.'
  ].filter(Boolean).join(' ');
  return {
    kind: 'strict',
    answer: [],
    answerText: '',
    citationRefs: [],
    notes,
    fallback: true
  };
}

function buildFallbackSourcesFromRetrieved(retrievedChunks) {
  return (Array.isArray(retrievedChunks) ? retrievedChunks : []).slice(0, 8).map((chunk) => ({
    docId: chunk.docId,
    docTitle: chunk.docTitle,
    chunkId: chunk.chunkId,
    startChar: chunk.startChar,
    endChar: chunk.endChar,
    snippet: String(chunk.text || '').slice(0, 260)
  }));
}

function tryParseObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {}
  const extracted = extractFirstBalancedObject(raw);
  if (!extracted) return null;
  try {
    const parsed = JSON.parse(extracted);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function buildSourcePlannerSystemPrompt(language) {
  const targetLanguage = (String(language || 'sv').toLowerCase() === 'en') ? 'English' : 'Swedish';
  return [
    'You are selecting evidence chunks for grounded QA.',
    'Return JSON ONLY: {"sources":[{"doc_id":"string","chunk_id":"string"}],"notes":"string"}',
    'Pick 1-3 most useful sources from provided context IDs only.',
    'Never invent doc_id or chunk_id.',
    `Notes language: ${targetLanguage}.`
  ].join('\n');
}

function buildSourcePlannerPrompt(question, retrievedChunks) {
  const list = (Array.isArray(retrievedChunks) ? retrievedChunks : []).map((chunk) => ({
    rank: chunk.rank,
    doc_id: chunk.docId,
    chunk_id: chunk.chunkId,
    title: chunk.docTitle,
    text: String(chunk.promptText || '').slice(0, 900)
  }));
  return JSON.stringify({
    question: String(question || ''),
    candidate_sources: list
  });
}

function selectPlannedChunks(rawOutput, retrievedChunks, maxSources = 3) {
  const parsed = tryParseObject(rawOutput);
  const candidates = [];
  if (parsed) {
    const rows = Array.isArray(parsed.sources)
      ? parsed.sources
      : (Array.isArray(parsed.citations) ? parsed.citations : []);
    rows.forEach((row) => {
      const docId = String(row?.doc_id || row?.docId || '').trim();
      const chunkId = String(row?.chunk_id || row?.chunkId || '').trim();
      if (!docId || !chunkId) return;
      const found = (Array.isArray(retrievedChunks) ? retrievedChunks : []).find((chunk) => chunk.docId === docId && chunk.chunkId === chunkId);
      if (found) candidates.push(found);
    });
  }

  const deduped = [];
  const seen = new Set();
  candidates.forEach((chunk) => {
    const key = `${chunk.docId}::${chunk.chunkId}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(chunk);
  });
  if (deduped.length > 0) return deduped.slice(0, Math.max(1, maxSources));
  return (Array.isArray(retrievedChunks) ? retrievedChunks : []).slice(0, Math.max(1, maxSources));
}

function buildSourcesFromCitationRefs(citationRefs, retrievedChunks) {
  const byKey = new Map();
  (Array.isArray(citationRefs) ? citationRefs : []).forEach((ref, idx) => {
    const docId = String(ref?.doc_id || '');
    const chunkId = String(ref?.chunk_id || '');
    if (!docId || !chunkId) return;
    const key = `${docId}::${chunkId}`;
    if (byKey.has(key)) return;
    const found = (Array.isArray(retrievedChunks) ? retrievedChunks : []).find((chunk) => chunk.docId === docId && chunk.chunkId === chunkId);
    if (!found) return;
    byKey.set(key, {
      docId: found.docId,
      docTitle: found.docTitle,
      chunkId: found.chunkId,
      startChar: found.startChar,
      endChar: found.endChar,
      snippet: found.text.slice(0, 260),
      marker: Number(ref?.marker || idx + 1)
    });
  });
  return Array.from(byKey.values());
}

async function callChatRequest({ baseUrl, modelName, systemPrompt, userPrompt, stream, numCtx, signal, jsonMode }) {
  return fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: modelName,
      stream: !!stream,
      format: jsonMode ? 'json' : undefined,
      options: {
        num_ctx: Math.max(1024, Number(numCtx || SEMANTIC_DEFAULTS.askGenerationNumCtx))
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });
}

async function callChat({ baseUrl, modelName, systemPrompt, userPrompt, stream, onToken, numCtx, jsonMode = true }) {
  const controller = makeController();
  try {
    let response = await callChatRequest({
      baseUrl,
      modelName,
      systemPrompt,
      userPrompt,
      stream,
      numCtx,
      signal: controller.signal,
      jsonMode
    });

    if (!response.ok && jsonMode) {
      const failedBody = await response.text();
      const lower = String(failedBody || '').toLowerCase();
      if (lower.includes('format') && (lower.includes('invalid') || lower.includes('unknown'))) {
        response = await callChatRequest({
          baseUrl,
          modelName,
          systemPrompt,
          userPrompt,
          stream,
          numCtx,
          signal: controller.signal,
          jsonMode: false
        });
      } else {
        throw new Error(`Generation failed: ${failedBody || response.status}`);
      }
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Generation failed: ${body || response.status}`);
    }

    if (!stream) {
      const payload = await response.json();
      return String(payload?.message?.content || '');
    }

    const decoder = new TextDecoder();
    let raw = '';
    let buffer = '';

    for await (const chunk of response.body) {
      if (cancelled) throw new Error('ASK_CANCELLED');
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch (_) {
          return;
        }
        const delta = String(parsed?.message?.content || '');
        if (delta) {
          raw += delta;
          if (typeof onToken === 'function') onToken(delta);
        }
      });
    }

    return raw.trim();
  } finally {
    clearController(controller);
  }
}

(async () => {
  try {
    const baseUrl = assertLocalBaseUrl(workerData.baseUrl || SEMANTIC_DEFAULTS.ollamaBaseUrl);
    const question = String(workerData.question || '').trim();
    if (!question) throw new Error('Question is empty.');

    let retrievedChunks = Array.isArray(workerData.retrievedChunks) ? workerData.retrievedChunks : [];
    if (retrievedChunks.length === 0) {
      const retrieveController = makeController();
      retrievedChunks = await retrieveTopKChunks({
        dbPath: workerData.dbPath,
        question,
        documents: workerData.documents,
        embeddingModel: workerData.embeddingModel,
        topK: workerData.topK,
        maxPromptChunkChars: workerData.maxPromptChunkChars,
        baseUrl,
        timeoutMs: workerData.timeoutMs,
        signal: retrieveController.signal
      });
      clearController(retrieveController);
    }

    if (retrievedChunks.length === 0) {
      parentPort.postMessage({
        type: 'done',
        payload: {
          answer: [],
          notes: 'No relevant indexed evidence found. Try rephrasing your question with more specific terms.',
          sources: [],
          retrievedChunks: []
        }
      });
      return;
    }

    const outputMode = String(workerData.outputMode || 'strict').toLowerCase() === 'loose' ? 'loose' : 'strict';
    const systemPrompt = buildAskSystemPrompt(workerData.outputLanguage || 'sv', outputMode);

    const modelName = String(workerData.generationModel || '').trim();
    if (!modelName) throw new Error('Generation model is not configured.');

    parentPort.postMessage({ type: 'retrieved', payload: { retrievedChunks } });
    parentPort.postMessage({ type: 'phase', payload: { phase: 'planning' } });

    const plannerOutput = await callChat({
      baseUrl,
      modelName,
      systemPrompt: buildSourcePlannerSystemPrompt(workerData.outputLanguage || 'sv'),
      userPrompt: buildSourcePlannerPrompt(question, retrievedChunks),
      stream: false,
      numCtx: Math.max(1024, Math.floor(Number(workerData.numCtx || SEMANTIC_DEFAULTS.askGenerationNumCtx) * 0.66)),
      jsonMode: true
    });
    const plannedChunks = selectPlannedChunks(plannerOutput, retrievedChunks, 3);
    const activeChunks = plannedChunks.length > 0 ? plannedChunks : retrievedChunks;
    const userPrompt = buildAskUserPrompt(question, activeChunks);

    parentPort.postMessage({ type: 'phase', payload: { phase: 'generating' } });

    let rawOutput = await callChat({
      baseUrl,
      modelName,
      systemPrompt,
      userPrompt,
      stream: true,
      jsonMode: outputMode === 'strict',
      onToken: (delta) => {
        parentPort.postMessage({ type: 'stream', payload: { delta } });
      },
      numCtx: workerData.numCtx
    });

    let validated;
    let repaired = false;
    parentPort.postMessage({ type: 'phase', payload: { phase: 'validating' } });
    try {
      validated = parseAndValidateAskOutput(rawOutput, retrievedChunks, {
        mode: outputMode,
        minCitationsOverall: Number(workerData.minCitationsOverall || 2)
      });
      if (validated && Array.isArray(validated.citationRefs) && validated.citationRefs.length === 0) {
        validated.citationRefs = activeChunks.slice(0, 2).map((c) => ({ doc_id: c.docId, chunk_id: c.chunkId }));
      }
    } catch (_) {
      repaired = true;
      parentPort.postMessage({ type: 'phase', payload: { phase: 'repairing' } });
      const repairPrompt = outputMode === 'loose'
        ? [
          userPrompt,
          '',
          'Your previous response was invalid.',
          'Return cited prose with [1], [2] markers, then SOURCES:',
          '[1] {"doc_id":"...","chunk_id":"..."}',
          'Use only sources from provided context.'
        ].join('\n')
        : [
          userPrompt,
          '',
          'Your previous response was invalid.',
          'Return JSON ONLY and match this exact schema:',
          '{"answer":[{"claim":"string","citations":[{"chunk_id":"string","doc_id":"string"}],"quotes":[{"chunk_id":"string","doc_id":"string","quote":"string"}]}],"notes":"string"}',
          'Use only sources from provided context.'
        ].join('\n');
      rawOutput = await callChat({
        baseUrl,
        modelName,
        systemPrompt,
        userPrompt: repairPrompt,
        stream: false,
        numCtx: workerData.numCtx,
        jsonMode: outputMode === 'strict'
      });
      parentPort.postMessage({ type: 'phase', payload: { phase: 'validating' } });
      try {
        validated = parseAndValidateAskOutput(rawOutput, activeChunks, {
          mode: outputMode,
          minCitationsOverall: Number(workerData.minCitationsOverall || 2)
        });
      } catch (_) {
        parentPort.postMessage({ type: 'phase', payload: { phase: 'repairing' } });
        const compactInvalid = String(rawOutput || '').slice(0, 6000);
        const finalRepairPrompt = outputMode === 'loose'
          ? [
            userPrompt,
            '',
            'Repair the invalid response below.',
            'Return cited prose with [n] markers and a SOURCES block.',
            'SOURCES lines must be: [n] {"doc_id":"...","chunk_id":"..."}',
            'Invalid response:',
            compactInvalid
          ].join('\n')
          : [
            userPrompt,
            '',
            'Repair the invalid response below into valid JSON for the exact schema.',
            'Do not add explanation. Return JSON object only.',
            'Use this exact skeleton if needed:',
            '{"answer":[],"notes":"Unable to answer from provided evidence. Suggest a narrower re-query."}',
            'Invalid response:',
            compactInvalid
          ].join('\n');
        rawOutput = await callChat({
          baseUrl,
          modelName,
          systemPrompt,
          userPrompt: finalRepairPrompt,
          stream: false,
          numCtx: workerData.numCtx,
          jsonMode: outputMode === 'strict'
        });
        parentPort.postMessage({ type: 'phase', payload: { phase: 'validating' } });
        try {
          validated = parseAndValidateAskOutput(rawOutput, activeChunks, {
            mode: outputMode,
            minCitationsOverall: Number(workerData.minCitationsOverall || 2)
          });
        } catch (errFinal) {
          const msg = String(errFinal?.message || 'Validation failed');
          if (outputMode === 'strict' && msg.includes(MISSING_ANSWER_ARRAY_ERROR)) {
            validated = buildGracefulNoAnswerResult(`${MISSING_ANSWER_ARRAY_ERROR} (after retries)`);
          } else {
            validated = buildGracefulNoAnswerResult(`${msg} (after retries)`);
          }
        }
      }
    }

    if (!validated) {
      validated = buildGracefulNoAnswerResult('Unknown validation failure.');
    }

    if (Array.isArray(validated.answer) && validated.answer.length === 0 && !validated.notes) {
      validated.notes = 'No grounded claims found in retrieved evidence. Try a narrower question.';
    }

    const sources = buildSourcesFromCitationRefs(validated.citationRefs, activeChunks);
    const finalSources = sources.length > 0 ? sources : buildFallbackSourcesFromRetrieved(activeChunks);

    parentPort.postMessage({
      type: 'done',
      payload: {
        answer: validated.answer,
        answerText: String(validated.answerText || ''),
        verifiedCitationCount: Number(validated.verifiedCitationCount || (Array.isArray(validated.citationRefs) ? validated.citationRefs.length : 0)),
        notes: validated.notes,
        sources: finalSources,
        retrievedChunks: activeChunks,
        repaired,
        rawOutput: String(rawOutput || '').slice(0, 20000),
        fallback: !!validated.fallback,
        answerMode: validated.kind || outputMode
      }
    });
  } catch (err) {
    const message = err?.message || String(err);
    if (cancelled || message === 'ASK_CANCELLED' || err?.name === 'AbortError') {
      parentPort.postMessage({ type: 'cancelled', payload: { code: 'ASK_CANCELLED', message: 'Ask request cancelled.' } });
      return;
    }
    parentPort.postMessage({ type: 'error', payload: { code: 'ASK_FAILED', message } });
  }
})();
