function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\r\n?/g, '\n')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(input) {
  const norm = normalizeText(input);
  if (!norm) return [];
  return norm.split(' ').filter((t) => t.length > 1);
}

function cosineToUnit(score) {
  const x = Number(score || 0);
  const clipped = Math.max(-1, Math.min(1, x));
  return (clipped + 1) / 2;
}

function scoreLexical(queryTokens, textTokens, originalQuery, originalText) {
  if (queryTokens.length === 0 || textTokens.length === 0) return { coverage: 0, density: 0, phrase: 0 };

  const querySet = new Set(queryTokens);
  let matchedUnique = 0;
  querySet.forEach((token) => {
    if (textTokens.includes(token)) matchedUnique += 1;
  });
  const coverage = matchedUnique / querySet.size;

  let matchedCount = 0;
  const queryFreq = new Map();
  queryTokens.forEach((t) => queryFreq.set(t, (queryFreq.get(t) || 0) + 1));
  textTokens.forEach((t) => {
    if (queryFreq.has(t)) matchedCount += 1;
  });
  const density = matchedCount / Math.max(8, textTokens.length);

  const q = normalizeText(originalQuery);
  const t = normalizeText(originalText);
  const phrase = q.length >= 6 && t.includes(q) ? 1 : 0;

  return { coverage, density, phrase };
}

function rerankCandidates(query, candidates, options = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (rows.length === 0) return [];

  const queryText = String(query || '').trim();
  const queryTokens = tokenize(queryText);
  const wSemantic = Number(options.wSemantic ?? 0.65);
  const wCoverage = Number(options.wCoverage ?? 0.25);
  const wDensity = Number(options.wDensity ?? 0.08);
  const wPhrase = Number(options.wPhrase ?? 0.02);

  const withScores = rows.map((row) => {
    const text = String(row?.text || row?.chunkTextPreview || '');
    const textTokens = tokenize(text);
    const lexical = scoreLexical(queryTokens, textTokens, queryText, text);
    const semantic = cosineToUnit(row?.score ?? row?.semanticScore ?? 0);
    const rerankScore = (semantic * wSemantic)
      + (lexical.coverage * wCoverage)
      + (lexical.density * wDensity)
      + (lexical.phrase * wPhrase);
    return {
      ...row,
      semanticScore: Number(row?.score ?? row?.semanticScore ?? 0),
      rerankScore
    };
  });

  withScores.sort((a, b) => b.rerankScore - a.rerankScore || b.semanticScore - a.semanticScore);
  return withScores;
}

module.exports = {
  rerankCandidates
};
