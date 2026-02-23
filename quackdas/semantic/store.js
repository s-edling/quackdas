const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { fromFloat32Buffer, toFloat32Buffer } = require('./vector');

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function openSemanticStore(dbPath) {
  ensureDirForFile(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_chunks (
      doc_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_char INTEGER NOT NULL,
      end_char INTEGER NOT NULL,
      chunk_text_hash TEXT NOT NULL,
      chunk_text_preview TEXT,
      embedding_model_name TEXT NOT NULL,
      embedding_vector BLOB,
      embedding_dim INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (doc_id, chunk_id)
    );

    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_doc_id
      ON semantic_chunks(doc_id);

    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_doc_chunk
      ON semantic_chunks(doc_id, chunk_id);

    CREATE TABLE IF NOT EXISTS semantic_doc_state (
      doc_id TEXT PRIMARY KEY,
      doc_text_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS semantic_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const statements = {
    getMeta: db.prepare('SELECT meta_value FROM semantic_meta WHERE meta_key = ?'),
    upsertMeta: db.prepare(`
      INSERT INTO semantic_meta(meta_key, meta_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(meta_key) DO UPDATE SET
        meta_value = excluded.meta_value,
        updated_at = excluded.updated_at
    `),
    getDocRows: db.prepare(`
      SELECT chunk_id, chunk_text_hash, embedding_model_name
      FROM semantic_chunks
      WHERE doc_id = ?
      ORDER BY chunk_index ASC
    `),
    getDocChunkCount: db.prepare('SELECT COUNT(*) AS c FROM semantic_chunks WHERE doc_id = ?'),
    getAllChunkCount: db.prepare('SELECT COUNT(*) AS c FROM semantic_chunks'),
    upsertChunk: db.prepare(`
      INSERT INTO semantic_chunks(
        doc_id, chunk_id, chunk_index, start_char, end_char,
        chunk_text_hash, chunk_text_preview,
        embedding_model_name, embedding_vector, embedding_dim,
        created_at, updated_at
      ) VALUES (
        @docId, @chunkId, @chunkIndex, @startChar, @endChar,
        @chunkTextHash, @chunkTextPreview,
        @embeddingModelName, @embeddingVector, @embeddingDim,
        @createdAt, @updatedAt
      )
      ON CONFLICT(doc_id, chunk_id) DO UPDATE SET
        chunk_index = excluded.chunk_index,
        start_char = excluded.start_char,
        end_char = excluded.end_char,
        chunk_text_hash = excluded.chunk_text_hash,
        chunk_text_preview = excluded.chunk_text_preview,
        embedding_model_name = excluded.embedding_model_name,
        embedding_vector = COALESCE(excluded.embedding_vector, semantic_chunks.embedding_vector),
        embedding_dim = CASE
          WHEN excluded.embedding_vector IS NULL THEN semantic_chunks.embedding_dim
          ELSE excluded.embedding_dim
        END,
        updated_at = excluded.updated_at
    `),
    deleteDocChunksAll: db.prepare('DELETE FROM semantic_chunks WHERE doc_id = ?'),
    upsertDocState: db.prepare(`
      INSERT INTO semantic_doc_state(doc_id, doc_text_hash, chunk_count, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET
        doc_text_hash = excluded.doc_text_hash,
        chunk_count = excluded.chunk_count,
        updated_at = excluded.updated_at
    `),
    getDocState: db.prepare('SELECT doc_text_hash, chunk_count, updated_at FROM semantic_doc_state WHERE doc_id = ?'),
    getAllDocState: db.prepare('SELECT doc_id, doc_text_hash, chunk_count, updated_at FROM semantic_doc_state'),
    deleteDocState: db.prepare('DELETE FROM semantic_doc_state WHERE doc_id = ?'),
    selectEmbeddingsForModel: db.prepare(`
      SELECT doc_id, chunk_id, start_char, end_char, chunk_index,
             chunk_text_preview, embedding_vector, embedding_dim
      FROM semantic_chunks
      WHERE embedding_model_name = ?
        AND embedding_vector IS NOT NULL
    `)
  };

  const wrapped = {
    db,
    close() {
      db.close();
    },
    begin() {
      db.exec('BEGIN');
    },
    commit() {
      db.exec('COMMIT');
    },
    rollback() {
      db.exec('ROLLBACK');
    },
    getMeta(key) {
      const row = statements.getMeta.get(key);
      return row ? String(row.meta_value || '') : '';
    },
    setMeta(key, value) {
      statements.upsertMeta.run(key, String(value || ''), new Date().toISOString());
    },
    getDocChunkMap(docId) {
      const rows = statements.getDocRows.all(docId) || [];
      const map = new Map();
      rows.forEach((row) => {
        map.set(String(row.chunk_id), {
          hash: String(row.chunk_text_hash || ''),
          modelName: String(row.embedding_model_name || '')
        });
      });
      return map;
    },
    getDocChunkCount(docId) {
      const row = statements.getDocChunkCount.get(docId);
      return Number(row?.c || 0);
    },
    getTotalChunkCount() {
      const row = statements.getAllChunkCount.get();
      return Number(row?.c || 0);
    },
    upsertChunk(chunk, modelName, embeddingValues) {
      const now = new Date().toISOString();
      const buffer = Array.isArray(embeddingValues) ? toFloat32Buffer(embeddingValues) : null;
      statements.upsertChunk.run({
        docId: chunk.docId,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
        chunkTextHash: chunk.hash,
        chunkTextPreview: chunk.preview,
        embeddingModelName: modelName,
        embeddingVector: buffer,
        embeddingDim: Array.isArray(embeddingValues) ? embeddingValues.length : 0,
        createdAt: now,
        updatedAt: now
      });
    },
    deleteChunksNotIn(docId, chunkIds) {
      if (!Array.isArray(chunkIds) || chunkIds.length === 0) {
        statements.deleteDocChunksAll.run(docId);
        return;
      }
      const placeholders = chunkIds.map(() => '?').join(',');
      const stmt = db.prepare(`DELETE FROM semantic_chunks WHERE doc_id = ? AND chunk_id NOT IN (${placeholders})`);
      stmt.run(docId, ...chunkIds);
    },
    upsertDocState(docId, docTextHash, chunkCount) {
      statements.upsertDocState.run(docId, docTextHash, chunkCount, new Date().toISOString());
    },
    getDocState(docId) {
      const row = statements.getDocState.get(docId);
      if (!row) return null;
      return {
        docTextHash: String(row.doc_text_hash || ''),
        chunkCount: Number(row.chunk_count || 0),
        updatedAt: String(row.updated_at || '')
      };
    },
    getAllDocStates() {
      const rows = statements.getAllDocState.all() || [];
      return rows.map((row) => ({
        docId: String(row.doc_id || ''),
        docTextHash: String(row.doc_text_hash || ''),
        chunkCount: Number(row.chunk_count || 0),
        updatedAt: String(row.updated_at || '')
      }));
    },
    deleteDocState(docId) {
      statements.deleteDocState.run(docId);
    },
    getEmbeddingsForModel(modelName) {
      const rows = statements.selectEmbeddingsForModel.all(modelName) || [];
      return rows.map((row) => ({
        docId: String(row.doc_id || ''),
        chunkId: String(row.chunk_id || ''),
        chunkIndex: Number(row.chunk_index || 0),
        startChar: Number(row.start_char || 0),
        endChar: Number(row.end_char || 0),
        chunkTextPreview: String(row.chunk_text_preview || ''),
        embedding: fromFloat32Buffer(row.embedding_vector)
      }));
    },
    remapDocumentId(oldDocId, newDocId) {
      const oldId = String(oldDocId || '').trim();
      const newId = String(newDocId || '').trim();
      if (!oldId || !newId || oldId === newId) return false;

      const existingNew = statements.getDocState.get(newId);
      if (existingNew) return false;

      const row = statements.getDocState.get(oldId);
      if (!row) return false;

      db.prepare('UPDATE semantic_doc_state SET doc_id = ? WHERE doc_id = ?').run(newId, oldId);
      db.prepare(`
        UPDATE semantic_chunks
        SET
          doc_id = @newId,
          chunk_id = CASE
            WHEN instr(chunk_id, '::') > 0 THEN @newId || substr(chunk_id, instr(chunk_id, '::'))
            ELSE @newId || '::' || chunk_index
          END
        WHERE doc_id = @oldId
      `).run({ newId, oldId });
      return true;
    }
  };

  return wrapped;
}

module.exports = {
  openSemanticStore
};
