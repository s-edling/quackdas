function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function extractCodeFenceCandidates(text) {
  const candidates = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fenceRegex.exec(text)) !== null) {
    const body = String(match[1] || '').trim();
    if (body) candidates.push(body);
  }
  return candidates;
}

function extractFirstBalancedObject(text) {
  const src = String(text || '');
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}') {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        return src.slice(start, i + 1);
      }
    }
  }
  return '';
}

function parseAskJson(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Model returned empty output.');
  let parsed = tryParseJson(text);
  if (!parsed) {
    const fenceCandidates = extractCodeFenceCandidates(text);
    for (let i = 0; i < fenceCandidates.length && !parsed; i++) {
      parsed = tryParseJson(fenceCandidates[i]);
    }
  }
  if (!parsed) {
    const balanced = extractFirstBalancedObject(text);
    if (balanced) parsed = tryParseJson(balanced);
  }
  if (!parsed) throw new Error('Model output is not valid JSON.');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model JSON root must be an object.');
  }
  // Conservative schema recovery for minor key drift.
  const answerArray = Array.isArray(parsed.answer)
    ? parsed.answer
    : (Array.isArray(parsed.answers) ? parsed.answers : null);
  if (!Array.isArray(answerArray)) {
    throw new Error('Model JSON must include answer array.');
  }
  return {
    answer: answerArray,
    notes: safeString(parsed.notes)
  };
}

function parseLooseCitedResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Model returned empty output.');

  // First, allow JSON-shaped loose output.
  const maybeJson = tryParseJson(text);
  if (maybeJson && typeof maybeJson === 'object' && !Array.isArray(maybeJson)) {
    const answerText = safeString(maybeJson.answer_text || maybeJson.answer || maybeJson.response).trim();
    const rawSources = Array.isArray(maybeJson.sources) ? maybeJson.sources : [];
    const refs = rawSources
      .map((row, idx) => ({
        marker: Number(row?.marker || idx + 1),
        doc_id: safeString(row?.doc_id),
        chunk_id: safeString(row?.chunk_id)
      }))
      .filter((r) => Number.isFinite(r.marker) && r.marker > 0 && r.doc_id && r.chunk_id);
    return { answerText, refs, notes: safeString(maybeJson.notes) };
  }

  const sourceHeaderMatch = text.match(/\n?\s*sources\s*:\s*/i);
  const splitIndex = sourceHeaderMatch ? sourceHeaderMatch.index : -1;
  const answerText = splitIndex >= 0 ? String(text.slice(0, splitIndex)).trim() : text;
  const headerLen = sourceHeaderMatch ? String(sourceHeaderMatch[0] || '').length : 0;
  const sourcesBlock = splitIndex >= 0 ? String(text.slice(splitIndex + headerLen)).trim() : '';
  const refs = [];
  const lines = sourcesBlock ? sourcesBlock.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  lines.forEach((line) => {
    const markerMatch = line.match(/^\[(\d+)\]\s*(.+)$/);
    if (!markerMatch) return;
    const marker = Number(markerMatch[1]);
    const rest = String(markerMatch[2] || '').trim();
    if (!Number.isFinite(marker) || marker <= 0 || !rest) return;

    const obj = tryParseJson(rest);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const docId = safeString(obj.doc_id);
      const chunkId = safeString(obj.chunk_id);
      if (docId && chunkId) refs.push({ marker, doc_id: docId, chunk_id: chunkId });
      return;
    }

    const docMatch = rest.match(/doc_id\s*[:=]\s*([^\s,;]+)/i);
    const chunkMatch = rest.match(/chunk_id\s*[:=]\s*([^\s,;]+)/i);
    if (docMatch && chunkMatch) {
      refs.push({ marker, doc_id: String(docMatch[1] || '').trim(), chunk_id: String(chunkMatch[1] || '').trim() });
    }
  });

  return { answerText, refs, notes: '' };
}

function makeRetrievedChunkMap(retrievedChunks) {
  const map = new Map();
  (Array.isArray(retrievedChunks) ? retrievedChunks : []).forEach((chunk) => {
    if (!chunk || !chunk.chunkId || !chunk.docId) return;
    map.set(`${chunk.docId}::${chunk.chunkId}`, chunk);
  });
  return map;
}

function validateAskResponse(parsed, retrievedChunks, options = {}) {
  const chunkMap = makeRetrievedChunkMap(retrievedChunks);
  const minCitationsOverall = Math.max(1, Number(options.minCitationsOverall || 2));
  const notes = [];
  const outClaims = [];
  const citationMap = new Map();

  (Array.isArray(parsed.answer) ? parsed.answer : []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const claimText = safeString(item.claim).trim();
    if (!claimText) return;

    const rawCitations = Array.isArray(item.citations) ? item.citations : [];
    const validCitations = rawCitations
      .map((c) => ({ chunk_id: safeString(c?.chunk_id), doc_id: safeString(c?.doc_id) }))
      .filter((c) => c.chunk_id && c.doc_id)
      .filter((c) => chunkMap.has(`${c.doc_id}::${c.chunk_id}`));

    validCitations.forEach((c) => {
      const key = JSON.stringify([c.doc_id, c.chunk_id]);
      citationMap.set(key, { doc_id: c.doc_id, chunk_id: c.chunk_id });
    });

    const rawQuotes = Array.isArray(item.quotes) ? item.quotes : [];
    const validQuotes = [];
    let quoteDropped = false;

    rawQuotes.forEach((q) => {
      const quote = safeString(q?.quote);
      const chunkId = safeString(q?.chunk_id);
      const docId = safeString(q?.doc_id);
      if (!quote || !chunkId || !docId) {
        quoteDropped = true;
        return;
      }
      const chunk = chunkMap.get(`${docId}::${chunkId}`);
      if (!chunk) {
        quoteDropped = true;
        return;
      }
      if (quote.split(/\s+/).filter(Boolean).length > 25) {
        quoteDropped = true;
        return;
      }
      if (!String(chunk.text || '').includes(quote)) {
        quoteDropped = true;
        return;
      }
      validQuotes.push({ chunk_id: chunkId, doc_id: docId, quote });
    });

    if (quoteDropped) notes.push('Some quotes omitted due to validation.');

    outClaims.push({
      claim: claimText,
      citations: validCitations,
      quotes: validQuotes
    });
  });

  const totalCitations = citationMap.size;
  const finalNotes = [safeString(parsed.notes), ...notes].filter(Boolean).join(' ').trim();
  const hadClaims = Array.isArray(parsed.answer) && parsed.answer.length > 0;
  const missingCitationFloor = totalCitations < minCitationsOverall;
  const normalizedNotes = (hadClaims && outClaims.length === 0 && !finalNotes)
    ? 'No valid grounded claims passed citation validation. Try asking a narrower question or ask again with same evidence.'
    : (missingCitationFloor
      ? `${finalNotes ? `${finalNotes} ` : ''}No cited answer met minimum citation coverage.`
      : finalNotes);

  return {
    kind: 'strict',
    answer: missingCitationFloor ? [] : outClaims,
    answerText: '',
    citationRefs: Array.from(citationMap.values()),
    notes: normalizedNotes
  };
}

function validateLooseCitedResponse(parsed, retrievedChunks, options = {}) {
  const chunkMap = makeRetrievedChunkMap(retrievedChunks);
  const minCitationsOverall = Math.max(1, Number(options.minCitationsOverall || 2));
  const answerText = String(parsed?.answerText || '').trim();
  const refs = Array.isArray(parsed?.refs) ? parsed.refs : [];
  const notes = safeString(parsed?.notes || '');
  const markerRefs = new Map();
  refs.forEach((ref) => {
    const marker = Number(ref.marker || 0);
    if (!Number.isFinite(marker) || marker <= 0) return;
    if (!ref.doc_id || !ref.chunk_id) return;
    if (!chunkMap.has(`${ref.doc_id}::${ref.chunk_id}`)) return;
    markerRefs.set(marker, { marker, doc_id: ref.doc_id, chunk_id: ref.chunk_id });
  });

  const markerMatches = Array.from(answerText.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]));
  const usedMarkers = new Set(markerMatches.filter((n) => Number.isFinite(n) && n > 0));
  const usedRefsRaw = Array.from(usedMarkers)
    .map((marker) => refs.find((r) => Number(r?.marker || 0) === marker))
    .filter(Boolean);
  const citationRefs = Array.from(usedMarkers)
    .map((marker) => markerRefs.get(marker))
    .filter(Boolean);
  const unverifiedCitationCount = Math.max(0, usedRefsRaw.length - citationRefs.length);

  if (!answerText) {
    return {
      kind: 'loose',
      answer: [],
      answerText: '',
      citationRefs: [],
      verifiedCitationCount: 0,
      unverifiedCitationCount: 0,
      notes: notes || 'No cited answer text returned by model.'
    };
  }

  const noCitations = citationRefs.length === 0;
  const belowFloor = citationRefs.length > 0 && citationRefs.length < minCitationsOverall;
  const noteBits = [notes];
  if (unverifiedCitationCount > 0) {
    noteBits.push('Some citations were unverified and omitted.');
  }
  if (noCitations) {
    noteBits.push('No verified citations detected in loose mode output.');
  } else if (belowFloor) {
    noteBits.push('Citation coverage is below the recommended minimum.');
  }

  return {
    kind: 'loose',
    answer: [],
    answerText,
    citationRefs,
    verifiedCitationCount: citationRefs.length,
    unverifiedCitationCount,
    notes: noteBits.filter(Boolean).join(' ').trim()
  };
}

module.exports = {
  parseAskJson,
  parseLooseCitedResponse,
  validateAskResponse,
  validateLooseCitedResponse,
  makeRetrievedChunkMap,
  extractFirstBalancedObject
};
