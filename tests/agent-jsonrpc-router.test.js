const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { ERROR_CODES, handleJsonRpcRequest, getMethodMap } = require('../agent/jsonrpc-router');

function makeApi() {
  return {
    project: {
      status: async () => ({ ok: true, kind: 'status' }),
      save: async (params) => ({ ok: true, saved: !!params.saveAs })
    },
    docs: {
      list: (params) => ([{ id: 'd1', include: !!params.includeContent }]),
      get: (params) => ({ id: params.doc_id }),
      update: (params) => ({ ok: true, doc_id: params.doc_id, revision: 1 }),
      jump: (params) => ({ ok: true, start_char: params.start_char })
    },
    codes: {
      list: () => ([{ id: 'c1' }]),
      create: (params) => ({ ok: true, name: params.name })
    },
    coding: {
      list: () => ([]),
      add: () => ({ ok: true, segment_id: 's1' }),
      remove: () => ({ ok: true, removed: true })
    },
    semantic: {
      status: async () => ({ ok: true }),
      models: async () => ({ ok: true, models: [] }),
      indexStart: async () => ({ ok: true, started: true }),
      indexCancel: async () => ({ ok: true, cancelled: true }),
      search: async (params) => ({ ok: true, query: params.query }),
      ask: async (params) => ({ ok: true, question: params.question }),
      askCancel: async () => ({ ok: true, cancelled: true }),
      askState: async () => ({ ok: true, state: { status: 'idle' } })
    }
  };
}

test('jsonrpc router dispatches valid method', async () => {
  const res = await handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 7,
    method: 'semantic.search',
    params: { query: 'test' }
  }, { api: makeApi() });

  assert.equal(res.jsonrpc, '2.0');
  assert.equal(res.id, 7);
  assert.equal(res.result.ok, true);
  assert.equal(res.result.query, 'test');
});

test('jsonrpc router rejects invalid envelope', async () => {
  const res = await handleJsonRpcRequest({ id: 1, method: 2 }, { api: makeApi() });
  assert.equal(res.error.code, ERROR_CODES.INVALID_REQUEST);
});

test('jsonrpc router rejects unknown method', async () => {
  const res = await handleJsonRpcRequest({ jsonrpc: '2.0', id: 'x', method: 'unknown.method' }, { api: makeApi() });
  assert.equal(res.error.code, ERROR_CODES.METHOD_NOT_FOUND);
});

test('jsonrpc router rejects non-object params', async () => {
  const res = await handleJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'docs.list', params: ['bad'] }, { api: makeApi() });
  assert.equal(res.error.code, ERROR_CODES.INVALID_PARAMS);
});

test('jsonrpc schema methods stay in sync with router methods', () => {
  const schemaPath = path.join(__dirname, '..', 'agent', 'jsonrpc-schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const schemaMethods = (schema?.properties?.methods?.required || []).slice().sort();
  const routerMethods = Object.keys(getMethodMap(makeApi())).sort();
  assert.deepEqual(schemaMethods, routerMethods);
});
