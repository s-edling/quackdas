const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb, mapper = (_evt, ...args) => args) {
  if (typeof cb !== 'function') return () => {};
  const handler = (evt, ...args) => {
    const mapped = mapper(evt, ...args);
    if (Array.isArray(mapped)) cb(...mapped);
    else cb(mapped);
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  saveProject: (payload, opts) => ipcRenderer.invoke('project:save', payload, opts || {}),
  openLastUsedProject: () => ipcRenderer.invoke('project:openLastUsed'),
  getProjectInfo: () => ipcRenderer.invoke('project:getInfo'),
  createProjectBackup: (data, opts) => ipcRenderer.invoke('project:createBackup', data, opts || {}),
  listProjectBackups: (opts) => ipcRenderer.invoke('project:listBackups', opts || {}),
  restoreProjectBackup: (backupId, opts) => ipcRenderer.invoke('project:restoreBackup', backupId, opts || {}),
  hasProjectHandle: () => ipcRenderer.invoke('project:hasHandle'),
  clearProjectHandle: () => ipcRenderer.invoke('project:clearHandle'),
  onOpenQdpx: (cb) => subscribe('project:openQdpx', cb, (_evt, buffer) => [buffer]),
  requestOpenProject: () => ipcRenderer.invoke('project:open'),

  // Native file helpers (dialog-gated, no arbitrary path access)
  openProjectFile: () => ipcRenderer.invoke('file:openProjectFile'),
  openDocumentFile: () => ipcRenderer.invoke('file:openDocumentFile'),
  ocrGetStatus: () => ipcRenderer.invoke('ocr:getStatus'),
  ocrImage: (dataUrl, opts) => ipcRenderer.invoke('ocr:image', Object.assign({ dataUrl }, opts || {})),

  // IPC for menu actions
  onMenuAction: (cb) => subscribe('menu:action', cb, (_evt, action, payload) => [action, payload]),

  // Local semantic search tooling
  semanticGetAvailability: (opts) => ipcRenderer.invoke('semantic:getAvailability', opts || {}),
  semanticGetProjectSettings: () => ipcRenderer.invoke('semantic:getProjectSettings'),
  semanticSetProjectModel: (modelName) => ipcRenderer.invoke('semantic:setProjectModel', modelName),
  semanticSetGenerationModel: (modelName) => ipcRenderer.invoke('semantic:setGenerationModel', modelName),
  semanticGetIndexStatus: (payload) => ipcRenderer.invoke('semantic:getIndexStatus', payload || {}),
  semanticGetIndexingState: () => ipcRenderer.invoke('semantic:indexingState'),
  semanticStartIndexing: (payload) => ipcRenderer.invoke('semantic:startIndexing', payload || {}),
  semanticCancelIndexing: () => ipcRenderer.invoke('semantic:cancelIndexing'),
  semanticSearch: (payload) => ipcRenderer.invoke('semantic:search', payload || {}),
  semanticStartAsk: (payload) => ipcRenderer.invoke('semantic:startAsk', payload || {}),
  semanticCancelAsk: () => ipcRenderer.invoke('semantic:cancelAsk'),
  semanticGetAskState: () => ipcRenderer.invoke('semantic:askState'),
  onSemanticIndexProgress: (cb) => subscribe('semantic:indexProgress', cb, (_evt, payload) => [payload]),
  onSemanticIndexDone: (cb) => subscribe('semantic:indexDone', cb, (_evt, payload) => [payload]),
  onSemanticIndexError: (cb) => subscribe('semantic:indexError', cb, (_evt, payload) => [payload]),
  onSemanticAskRetrieved: (cb) => subscribe('semantic:askRetrieved', cb, (_evt, payload) => [payload]),
  onSemanticAskStream: (cb) => subscribe('semantic:askStream', cb, (_evt, payload) => [payload]),
  onSemanticAskPhase: (cb) => subscribe('semantic:askPhase', cb, (_evt, payload) => [payload]),
  onSemanticAskDone: (cb) => subscribe('semantic:askDone', cb, (_evt, payload) => [payload]),
  onSemanticAskError: (cb) => subscribe('semantic:askError', cb, (_evt, payload) => [payload])
});
