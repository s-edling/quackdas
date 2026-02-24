const { canonicalizeText, sha256Hex } = require('./text');
const { SEMANTIC_DEFAULTS } = require('./config');

function splitByDelimiter(text, delimiterRegex) {
  if (!text) return [];
  const units = [];
  let last = 0;
  delimiterRegex.lastIndex = 0;
  let match = delimiterRegex.exec(text);
  while (match) {
    const end = match.index + match[0].length;
    if (end > last) {
      units.push({ start: last, end });
    }
    last = end;
    match = delimiterRegex.exec(text);
  }
  if (last < text.length) {
    units.push({ start: last, end: text.length });
  }
  return units;
}

function splitLongUnitBySentence(text, unit, maxChars) {
  const chunk = text.slice(unit.start, unit.end);
  const sentenceUnits = splitByDelimiter(chunk, /[.!?]+[\])"']*\s+/g)
    .map((part) => ({ start: part.start + unit.start, end: part.end + unit.start }));

  if (sentenceUnits.length <= 1) {
    return splitLongUnitHard(unit, maxChars);
  }

  const out = [];
  for (let i = 0; i < sentenceUnits.length; i++) {
    const sent = sentenceUnits[i];
    if ((sent.end - sent.start) <= maxChars) {
      out.push(sent);
      continue;
    }
    out.push(...splitLongUnitHard(sent, maxChars));
  }
  return out;
}

function splitLongUnitHard(unit, maxChars) {
  const out = [];
  let cursor = unit.start;
  while (cursor < unit.end) {
    const end = Math.min(unit.end, cursor + maxChars);
    if (end > cursor) out.push({ start: cursor, end });
    cursor = end;
  }
  return out;
}

function buildBaseUnits(text, maxChars) {
  let units;
  if (text.includes('\n\n')) {
    units = splitByDelimiter(text, /\n{2,}/g);
  } else if (text.includes('\n')) {
    units = splitByDelimiter(text, /\n+/g);
  } else {
    units = [{ start: 0, end: text.length }];
  }

  const out = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if ((unit.end - unit.start) <= maxChars) {
      out.push(unit);
      continue;
    }
    out.push(...splitLongUnitBySentence(text, unit, maxChars));
  }

  return out.filter((unit) => unit.end > unit.start);
}

function selectChunkEnd(startChar, units, textLength, minChars, maxChars) {
  const minTarget = Math.min(textLength, startChar + minChars);
  const maxTarget = Math.min(textLength, startChar + maxChars);

  const endCandidates = units
    .map((unit) => unit.end)
    .filter((end) => end > startChar);

  if (endCandidates.length === 0) {
    return Math.min(textLength, startChar + maxChars);
  }

  const inRange = endCandidates.find((end) => end >= minTarget && end <= maxTarget);
  if (inRange) return inRange;

  const atMostMax = endCandidates.filter((end) => end <= maxTarget);
  if (atMostMax.length > 0) return atMostMax[atMostMax.length - 1];

  const firstAfter = endCandidates[0];
  if ((firstAfter - startChar) > maxChars) {
    return maxTarget;
  }
  return firstAfter;
}

function createDeterministicChunks(docId, rawText, options = {}) {
  const text = canonicalizeText(rawText);
  const minChars = Math.max(100, Number(options.minChars || SEMANTIC_DEFAULTS.chunkTargetMinChars));
  const maxChars = Math.max(minChars, Number(options.maxChars || SEMANTIC_DEFAULTS.chunkTargetMaxChars));
  const overlapChars = Math.max(0, Number(options.overlapChars || SEMANTIC_DEFAULTS.chunkOverlapChars));

  if (!text) return [];

  const units = buildBaseUnits(text, maxChars);
  const chunks = [];

  let startChar = 0;
  let safety = 0;
  while (startChar < text.length && safety < 100000) {
    safety += 1;
    const endChar = selectChunkEnd(startChar, units, text.length, minChars, maxChars);
    if (!(endChar > startChar)) break;

    const textSlice = text.slice(startChar, endChar);
    if (textSlice.length > 0) {
      const chunkIndex = chunks.length;
      chunks.push({
        chunkIndex,
        chunkId: `${docId}::${chunkIndex}`,
        startChar,
        endChar,
        textSlice,
        hash: sha256Hex(textSlice)
      });
    }

    if (endChar >= text.length) break;

    const nextStart = Math.max(endChar - overlapChars, startChar);
    startChar = (nextStart > startChar) ? nextStart : endChar;
  }

  return chunks.filter((chunk) => chunk.endChar > chunk.startChar);
}

module.exports = {
  createDeterministicChunks
};
