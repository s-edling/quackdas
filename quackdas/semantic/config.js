const SEMANTIC_DEFAULTS = Object.freeze({
  embeddingModel: 'bge-m3',
  fallbackEmbeddingModel: 'nomic-embed-text',
  chunkTargetMinChars: 1200,
  chunkTargetMaxChars: 1800,
  chunkOverlapChars: 200,
  embeddingConcurrency: 2,
  searchTopK: 20,
  searchSnippetRadius: 120,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaTimeoutMs: 30000,
  availabilityCacheMs: 8000
});

module.exports = {
  SEMANTIC_DEFAULTS
};
