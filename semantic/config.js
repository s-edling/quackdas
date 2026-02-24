const SEMANTIC_DEFAULTS = Object.freeze({
  embeddingModel: 'bge-m3',
  fallbackEmbeddingModel: 'nomic-embed-text',
  chunkTargetMinChars: 1200,
  chunkTargetMaxChars: 1800,
  chunkOverlapChars: 200,
  embeddingConcurrency: 2,
  searchTopK: 20,
  searchRerankCandidateMultiplier: 3,
  searchSnippetRadius: 120,
  askTopK: 8,
  askMinCitationsOverall: 2,
  askRerankCandidateMultiplier: 3,
  askMaxChunkCharsForPrompt: 2000,
  askGenerationNumCtx: 3072,
  askSmallModelMaxBillions: 4,
  askSmallTopK: 4,
  askSmallMaxChunkCharsForPrompt: 1000,
  askSmallGenerationNumCtx: 2048,
  askSmallMinCitationsOverall: 1,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaTimeoutMs: 30000,
  availabilityCacheMs: 8000
});

module.exports = {
  SEMANTIC_DEFAULTS
};
