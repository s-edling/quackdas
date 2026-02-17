const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveProject: (data, opts) => ipcRenderer.invoke('project:save', data, opts || {}),
  openLastUsedProject: () => ipcRenderer.invoke('project:openLastUsed'),
  createProjectBackup: (data, opts) => ipcRenderer.invoke('project:createBackup', data, opts || {}),
  listProjectBackups: (opts) => ipcRenderer.invoke('project:listBackups', opts || {}),
  restoreProjectBackup: (backupId, opts) => ipcRenderer.invoke('project:restoreBackup', backupId, opts || {}),
  hasProjectHandle: () => ipcRenderer.invoke('project:hasHandle'),
  clearProjectHandle: () => ipcRenderer.invoke('project:clearHandle'),
  onOpenProject: (cb) => ipcRenderer.on('project:openData', (_evt, jsonText) => cb(jsonText)),
  onOpenQdpx: (cb) => ipcRenderer.on('project:openQdpx', (_evt, buffer) => cb(buffer)),
  requestOpenProject: () => ipcRenderer.invoke('project:open'),

  // Native file helpers (dialog-gated, no arbitrary path access)
  openProjectFile: () => ipcRenderer.invoke('file:openProjectFile'),
  openDocumentFile: () => ipcRenderer.invoke('file:openDocumentFile'),
  ocrImage: (dataUrl, opts) => ipcRenderer.invoke('ocr:image', Object.assign({ dataUrl }, opts || {})),

  // IPC for menu actions
  onMenuAction: (cb) => ipcRenderer.on('menu:action', (_evt, action, payload) => cb(action, payload))
});
