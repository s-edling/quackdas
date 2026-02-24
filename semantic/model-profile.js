const { SEMANTIC_DEFAULTS } = require('./config');

function inferModelSizeBillions(modelName) {
  const raw = String(modelName || '').trim().toLowerCase();
  if (!raw) return null;

  const bMatch = raw.match(/(^|[:/ _-])(\d+(?:\.\d+)?)\s*b(?=$|[:/ _.-])/i);
  if (bMatch) {
    const value = Number(bMatch[2]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const mMatch = raw.match(/(^|[:/ _-])(\d+(?:\.\d+)?)\s*m(?=$|[:/ _.-])/i);
  if (mMatch) {
    const value = Number(mMatch[2]);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value / 1000;
  }

  return null;
}

function getAskModelProfile(modelName, defaults = SEMANTIC_DEFAULTS) {
  const sizeBillions = inferModelSizeBillions(modelName);
  const threshold = Number(defaults.askSmallModelMaxBillions || 4);
  const isSmallModel = Number.isFinite(sizeBillions) && sizeBillions <= threshold;
  if (isSmallModel) {
    return {
      sizeBillions,
      isSmallModel: true,
      recommendedMode: 'loose',
      topK: Number(defaults.askSmallTopK || 4),
      maxPromptChunkChars: Number(defaults.askSmallMaxChunkCharsForPrompt || 1000),
      numCtx: Number(defaults.askSmallGenerationNumCtx || 2048),
      minCitationsOverall: Number(defaults.askSmallMinCitationsOverall || 1)
    };
  }
  return {
    sizeBillions,
    isSmallModel: false,
    recommendedMode: 'strict',
    topK: Number(defaults.askTopK || 8),
    maxPromptChunkChars: Number(defaults.askMaxChunkCharsForPrompt || 2000),
    numCtx: Number(defaults.askGenerationNumCtx || 3072),
    minCitationsOverall: Number(defaults.askMinCitationsOverall || 2)
  };
}

module.exports = {
  inferModelSizeBillions,
  getAskModelProfile
};
