const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {
  electronAPI: {}
};
global.alert = () => {};
global.confirm = () => true;
global.appData = {
  theme: 'light',
  hasUnsavedChanges: false,
  documents: [],
  codes: [],
  cases: [],
  segments: [],
  folders: [],
  memos: []
};
global.saveData = () => {};
global.renderAll = () => {};
global.updateSaveStatus = () => {};
global.base64ToArrayBuffer = () => new ArrayBuffer(0);

const exportModule = require('../js/export.js');

test('applyImportedQdpx commits the opened path only after import succeeds', async () => {
  const events = [];
  global.appData = {
    theme: 'dark',
    hasUnsavedChanges: true,
    documents: [{ id: 'old_doc' }],
    codes: [],
    cases: [],
    segments: [],
    folders: [],
    memos: []
  };
  global.importFromQdpx = async () => {
    events.push('import');
    return {
      projectName: 'Imported',
      theme: '',
      documents: [{ id: 'doc_1', title: 'Imported doc', content: 'Alpha', created: '2025-01-01T00:00:00.000Z' }],
      codes: [],
      cases: [],
      segments: [],
      folders: [],
      memos: []
    };
  };
  global.normaliseProject = (project) => project;
  global.saveData = (options) => events.push(`save:${options?.markUnsaved}`);
  global.renderAll = () => events.push('render');
  global.updateSaveStatus = () => events.push('status');
  global.window.electronAPI = {
    commitOpenedProject: async (projectPath) => {
      events.push(`commit:${projectPath}`);
      return { ok: true, path: projectPath };
    },
    clearProjectHandle: async () => {
      events.push('clear');
      return { ok: true };
    }
  };

  const opened = await exportModule.applyImportedQdpx(new ArrayBuffer(8), {
    projectPath: '/tmp/imported-project.qdpx'
  });

  assert.equal(opened, true);
  assert.deepEqual(events, [
    'import',
    'save:false',
    'commit:/tmp/imported-project.qdpx',
    'render',
    'status'
  ]);
  assert.equal(global.appData.projectName, 'Imported');
  assert.equal(global.appData.theme, 'dark');
  assert.equal(global.appData.hasUnsavedChanges, false);
});

test('applyImportedQdpx leaves the current path uncommitted when import fails', async () => {
  const events = [];
  const alerts = [];
  global.appData = {
    theme: 'dark',
    hasUnsavedChanges: true,
    documents: [{ id: 'old_doc' }],
    codes: [],
    cases: [],
    segments: [],
    folders: [],
    memos: []
  };
  global.importFromQdpx = async () => {
    events.push('import');
    throw new Error('Corrupt QDPX');
  };
  global.normaliseProject = (project) => project;
  global.alert = (message) => alerts.push(String(message));
  const originalConsoleError = console.error;
  console.error = () => {};
  global.saveData = () => events.push('save');
  global.renderAll = () => events.push('render');
  global.updateSaveStatus = () => events.push('status');
  global.window.electronAPI = {
    commitOpenedProject: async (projectPath) => {
      events.push(`commit:${projectPath}`);
      return { ok: true, path: projectPath };
    },
    clearProjectHandle: async () => {
      events.push('clear');
      return { ok: true };
    }
  };

  const opened = await exportModule.applyImportedQdpx(new ArrayBuffer(8), {
    projectPath: '/tmp/bad-project.qdpx'
  });
  console.error = originalConsoleError;

  assert.equal(opened, false);
  assert.deepEqual(events, [
    'import',
    'clear'
  ]);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /Corrupt QDPX/);
  assert.equal(global.appData.documents[0].id, 'old_doc');
});
