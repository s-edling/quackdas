/**
 * Quackdas JSON-RPC router for agent API.
 * This module is transport-agnostic and does not alter UI state by itself.
 */

const JSONRPC_VERSION = '2.0';

const ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
});

function buildSuccess(id, result) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id: id == null ? null : id,
    result
  };
}

function buildError(id, code, message, data) {
  const error = { code, message: String(message || 'Unknown error') };
  if (data !== undefined) error.data = data;
  return {
    jsonrpc: JSONRPC_VERSION,
    id: id == null ? null : id,
    error
  };
}

function toParamsObject(params) {
  if (params == null) return {};
  if (typeof params !== 'object' || Array.isArray(params)) {
    throw new TypeError('JSON-RPC params must be an object for Quackdas methods.');
  }
  return params;
}

function getMethodMap(api) {
  return {
    'project.status': () => api.project.status(),
    'project.save': (params) => api.project.save(params),

    'docs.list': (params) => api.docs.list(params),
    'docs.get': (params) => api.docs.get(params),
    'docs.update': (params) => api.docs.update(params),
    'docs.jump': (params) => api.docs.jump(params),

    'codes.list': () => api.codes.list(),
    'codes.create': (params) => api.codes.create(params),

    'coding.list': (params) => api.coding.list(params),
    'coding.add': (params) => api.coding.add(params),
    'coding.remove': (params) => api.coding.remove(params),

    'semantic.status': () => api.semantic.status(),
    'semantic.models': () => api.semantic.models(),
    'semantic.index.start': (params) => api.semantic.indexStart(params),
    'semantic.index.cancel': () => api.semantic.indexCancel(),
    'semantic.search': (params) => api.semantic.search(params),
    'semantic.ask': (params) => api.semantic.ask(params),
    'semantic.ask.cancel': () => api.semantic.askCancel(),
    'semantic.ask.state': () => api.semantic.askState()
  };
}

async function handleJsonRpcRequest(request, options = {}) {
  const api = options.api || (typeof window !== 'undefined' ? window.quackdasAgent : null);
  if (!api) {
    return buildError(request?.id ?? null, ERROR_CODES.INTERNAL_ERROR, 'quackdasAgent API is unavailable.');
  }

  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return buildError(null, ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC request object.');
  }

  const id = request.id ?? null;
  if (request.jsonrpc !== JSONRPC_VERSION || typeof request.method !== 'string') {
    return buildError(id, ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC envelope. Expected jsonrpc="2.0" and method string.');
  }

  const methodMap = getMethodMap(api);
  const handler = methodMap[request.method];
  if (!handler) {
    return buildError(id, ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${request.method}`);
  }

  let params;
  try {
    params = toParamsObject(request.params);
  } catch (err) {
    return buildError(id, ERROR_CODES.INVALID_PARAMS, err?.message || String(err));
  }

  try {
    const result = await handler(params);
    return buildSuccess(id, result);
  } catch (err) {
    return buildError(id, ERROR_CODES.INTERNAL_ERROR, err?.message || String(err));
  }
}

const exported = {
  JSONRPC_VERSION,
  ERROR_CODES,
  handleJsonRpcRequest,
  getMethodMap
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = exported;
}
if (typeof window !== 'undefined') {
  window.quackdasJsonRpc = Object.assign({}, window.quackdasJsonRpc || {}, exported);
}
