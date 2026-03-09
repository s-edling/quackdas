const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { electronAPI: {} };
global.document = {
  getElementById() {
    return { disabled: false };
  }
};
global.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};
global.scheduleProjectBackup = () => {};
global.syncDocumentCaseIdsFromCases = () => {};
global.resetProjectUiTransientState = () => {};
global.resetPdfProjectTransientState = () => {};
global.currentPdfState = {
  docId: null,
  currentPage: 1,
  pendingGoToPage: null
};

global.canonicalizeDocumentContent = (input) => String(input == null ? '' : input).replace(/\r\n?/g, '\n');

const state = require('../js/state.js');
const fieldnotes = require('../js/fieldnotes.js');
const { installQdpxGlobals } = require('./helpers/qdpx-test-env');
const { getObservationSidecarPaths } = require('../electron-main/online-observation.js');

global.normalizeFieldnoteDocument = fieldnotes.normalizeFieldnoteDocument;
global.makeEmptyFieldnoteData = fieldnotes.makeEmptyFieldnoteData;
global.serializeFieldnoteDataForStorage = fieldnotes.serializeFieldnoteDataForStorage;

installQdpxGlobals(state);

const qdpx = require('../js/qdpx.js');

test('normalizeFieldnoteDocument rebuilds note-only content from sessions', () => {
  const doc = {
    id: 'doc_fieldnote',
    title: 'Forum',
    type: 'fieldnote',
    content: '',
    metadata: {},
    fieldnoteData: {
      sessions: [
        {
          id: 'session_1',
          sessionDate: '2026-03-08',
          startedAt: '2026-03-08T09:00:00.000Z',
          heading: 'Forum — 2026-03-08 09:00',
          entries: [
            {
              id: 'entry_1',
              uuid: 'uuid-1',
              url: 'https://example.com/a',
              pageTitle: 'Thread A',
              timestamp: '2026-03-08T09:10:00.000Z',
              note: 'First note'
            },
            {
              id: 'entry_2',
              uuid: 'uuid-2',
              url: 'https://example.com/b',
              pageTitle: 'Thread B',
              timestamp: '2026-03-08T09:20:00.000Z',
              note: 'Second note'
            }
          ]
        }
      ]
    }
  };

  fieldnotes.normalizeFieldnoteDocument(doc);

  assert.equal(doc.content, 'First note\n\nSecond note');
  assert.equal(doc._fieldnoteTextRangesByEntryId.entry_1.start, 0);
  assert.equal(doc._fieldnoteTextRangesByEntryId.entry_1.end, 10);
  assert.equal(doc._fieldnoteTextRangesByEntryId.entry_2.start, 12);
});

test('QDPX export/import preserves fieldnote documents and structured session data', async () => {
  const project = state.normaliseProject({
    projectName: 'Fieldnote Project',
    documents: [
      {
        id: 'doc_fieldnote',
        title: 'Forum',
        type: 'fieldnote',
        content: '',
        metadata: {},
        created: '2026-03-08T09:00:00.000Z',
        lastAccessed: '2026-03-08T09:30:00.000Z',
        fieldnoteData: {
          sessions: [
            {
              id: 'session_1',
              sessionDate: '2026-03-08',
              startedAt: '2026-03-08T09:00:00.000Z',
              heading: 'Forum — 2026-03-08 09:00',
              entries: [
                {
                  id: 'entry_1',
                  uuid: 'uuid-1',
                  url: 'https://example.com/a',
                  pageTitle: 'Thread A',
                  timestamp: '2026-03-08T09:10:00.000Z',
                  note: 'Observed a reply chain',
                  screenshotPath: 'screenshots/uuid-1.png',
                  htmlPath: 'html/uuid-1.html'
                }
              ]
            }
          ]
        }
      }
    ],
    codes: [],
    segments: []
  });

  state.__setAppDataForTests(project);
  global.appData = state.__getAppDataForTests();

  const blob = await qdpx.exportToQdpx();
  const imported = state.normaliseProject(await qdpx.importFromQdpx(await blob.arrayBuffer()));

  assert.equal(imported.documents.length, 1);
  const doc = imported.documents[0];
  assert.equal(doc.type, 'fieldnote');
  assert.equal(doc.title, 'Forum');
  assert.equal(doc.content, 'Observed a reply chain');
  assert.equal(doc.fieldnoteData.sessions.length, 1);
  assert.equal(doc.fieldnoteData.sessions[0].entries.length, 1);
  assert.equal(doc.fieldnoteData.sessions[0].entries[0].uuid, 'uuid-1');
  assert.equal(doc.fieldnoteData.sessions[0].entries[0].screenshotPath, 'screenshots/uuid-1.png');
});

test('normal save preserves packed-only fieldnote media imported from internal refs', async () => {
  const project = state.normaliseProject({
    projectName: 'Packed Fieldnote Project',
    documents: [
      {
        id: 'doc_fieldnote',
        title: 'Forum',
        type: 'fieldnote',
        content: '',
        metadata: {},
        created: '2026-03-08T09:00:00.000Z',
        lastAccessed: '2026-03-08T09:30:00.000Z',
        fieldnoteData: {
          sessions: [
            {
              id: 'session_1',
              sessionDate: '2026-03-08',
              startedAt: '2026-03-08T09:00:00.000Z',
              heading: 'Forum — 2026-03-08 09:00',
              entries: [
                {
                  id: 'entry_1',
                  uuid: 'uuid-1',
                  url: 'https://example.com/a',
                  pageTitle: 'Thread A',
                  timestamp: '2026-03-08T09:10:00.000Z',
                  note: 'Observed a reply chain',
                  screenshotPath: 'internal://legacy-entry.png',
                  htmlPath: 'internal://legacy-entry.html',
                  packedScreenshotDataUrl: 'data:image/png;base64,QUJD',
                  packedHtmlContent: '<html><body>snapshot</body></html>'
                }
              ]
            }
          ]
        }
      }
    ],
    codes: [],
    segments: []
  });

  state.__setAppDataForTests(project);
  global.appData = state.__getAppDataForTests();

  const blob = await qdpx.exportToQdpx();
  const imported = state.normaliseProject(await qdpx.importFromQdpx(await blob.arrayBuffer()));
  const importedEntry = imported.documents[0].fieldnoteData.sessions[0].entries[0];

  assert.match(importedEntry.screenshotPath, /^internal:\/\/.+\.png$/);
  assert.match(importedEntry.htmlPath, /^internal:\/\/.+\.html$/);
  assert.equal(importedEntry.packedScreenshotDataUrl, 'data:image/png;base64,QUJD');
  assert.equal(importedEntry.packedHtmlContent, '<html><body>snapshot</body></html>');
});

test('fieldnote asset resolution rejects non-local screenshot paths', () => {
  const doc = {
    metadata: {
      quackdasProjectPath: '/tmp/Project.qdpx'
    }
  };

  assert.equal(fieldnotes.resolveFieldnoteAssetPath(doc, 'https://example.com/image.png'), '');
  assert.equal(fieldnotes.resolveFieldnoteAssetPath(doc, 'file:///etc/passwd'), '');
  assert.equal(fieldnotes.resolveFieldnoteAssetPath(doc, 'internal://packed.png'), '');
  assert.equal(fieldnotes.resolveFieldnoteAssetPath(doc, '../screenshots/escape.png'), '');
});

test('normalizeFieldnoteEntry keeps only packed screenshot data URLs', () => {
  const safe = fieldnotes.normalizeFieldnoteEntry({
    packedScreenshotDataUrl: 'data:image/png;base64,QUJD'
  });
  const unsafe = fieldnotes.normalizeFieldnoteEntry({
    packedScreenshotDataUrl: 'file:///tmp/capture.png'
  });

  assert.equal(safe.packedScreenshotDataUrl, 'data:image/png;base64,QUJD');
  assert.equal(unsafe.packedScreenshotDataUrl, '');
});

test('fieldnote sidecar path resolution matches the main-process sidecar naming rules', () => {
  const projectPath = '/tmp/Interview: Notes?.qdpx';
  const sidecar = getObservationSidecarPaths(projectPath);
  const screenshotUrl = fieldnotes.resolveFieldnoteAssetPath({
    metadata: {
      quackdasProjectPath: projectPath
    }
  }, 'screenshots/entry-1.png');

  assert.equal(screenshotUrl, 'file:///tmp/.Interview--Notes-_media/screenshots/entry-1.png');
  assert.equal(sidecar.rootDir, '/tmp/.Interview--Notes-_media');
});

test('deleting one observation entry removes its own image coding and remaps later text coding', () => {
  const project = state.normaliseProject({
    projectName: 'Fieldnote Project',
    documents: [
      {
        id: 'doc_fieldnote',
        title: 'Forum',
        type: 'fieldnote',
        content: '',
        metadata: {},
        created: '2026-03-08T09:00:00.000Z',
        lastAccessed: '2026-03-08T09:30:00.000Z',
        fieldnoteData: {
          sessions: [
            {
              id: 'session_1',
              sessionDate: '2026-03-08',
              startedAt: '2026-03-08T09:00:00.000Z',
              heading: 'Forum — 2026-03-08 09:00',
              entries: [
                {
                  id: 'entry_1',
                  uuid: 'uuid-1',
                  url: 'https://example.com/a',
                  pageTitle: 'Thread A',
                  timestamp: '2026-03-08T09:10:00.000Z',
                  note: 'Alpha'
                },
                {
                  id: 'entry_2',
                  uuid: 'uuid-2',
                  url: 'https://example.com/b',
                  pageTitle: 'Thread B',
                  timestamp: '2026-03-08T09:20:00.000Z',
                  note: 'Beta',
                  screenshotPath: 'screenshots/uuid-2.png'
                },
                {
                  id: 'entry_3',
                  uuid: 'uuid-3',
                  url: 'https://example.com/c',
                  pageTitle: 'Thread C',
                  timestamp: '2026-03-08T09:30:00.000Z',
                  note: 'Gamma'
                }
              ]
            }
          ]
        }
      }
    ],
    codes: [],
    segments: []
  });

  state.__setAppDataForTests(project);
  global.appData = state.__getAppDataForTests();
  global.saveHistory = () => {};
  global.saveData = () => {};
  global.pruneInvalidSegmentCodeMemos = () => {};

  const doc = global.appData.documents[0];
  fieldnotes.normalizeFieldnoteDocument(doc);

  const alphaRange = doc._fieldnoteTextRangesByEntryId.entry_1;
  const betaRange = doc._fieldnoteTextRangesByEntryId.entry_2;
  const gammaRange = doc._fieldnoteTextRangesByEntryId.entry_3;

  global.appData.segments = [
    {
      id: 'seg_alpha',
      docId: doc.id,
      startIndex: alphaRange.start,
      endIndex: alphaRange.end,
      text: doc.content.slice(alphaRange.start, alphaRange.end),
      codeIds: ['code_a']
    },
    {
      id: 'seg_beta_image',
      docId: doc.id,
      text: '[Fieldnote image: entry_2]',
      fieldnoteImageId: 'entry_2',
      startIndex: 0,
      endIndex: 1,
      codeIds: ['code_b']
    },
    {
      id: 'seg_gamma',
      docId: doc.id,
      startIndex: gammaRange.start,
      endIndex: gammaRange.end,
      text: doc.content.slice(gammaRange.start, gammaRange.end),
      codeIds: ['code_c']
    }
  ];

  fieldnotes.deleteObservationEntryFromProject({
    fieldsite: 'Forum',
    uuid: 'uuid-2'
  });

  assert.equal(doc.content, 'Alpha\n\nGamma');
  assert.deepEqual(
    global.appData.segments.map((segment) => ({
      id: segment.id,
      fieldnoteImageId: segment.fieldnoteImageId || '',
      startIndex: segment.startIndex,
      endIndex: segment.endIndex,
      text: segment.text,
      codeIds: segment.codeIds
    })),
    [
      {
        id: 'seg_alpha',
        fieldnoteImageId: '',
        startIndex: 0,
        endIndex: 5,
        text: 'Alpha',
        codeIds: ['code_a']
      },
      {
        id: 'seg_gamma',
        fieldnoteImageId: '',
        startIndex: 7,
        endIndex: 12,
        text: 'Gamma',
        codeIds: ['code_c']
      }
    ]
  );
});

test('fieldnote QDPX helpers reject oversized declared text entries before reading', async () => {
  await assert.rejects(
    () => qdpx.readZipTextEntryWithSafety({
      _data: { uncompressedSize: qdpx.QDPX_MAX_SINGLE_SOURCE_BYTES + 1 },
      async() {
        throw new Error('should not read');
      }
    }, 'fieldnote source "Forum"', { bytes: 0 }),
    /per-file safety limit/i
  );
});

test('fieldnote QDPX helpers account for packed screenshot bytes in expanded-read safety', async () => {
  const base64 = await qdpx.readZipBinaryBase64EntryWithSafety({
    _data: { uncompressedSize: 4 },
    async(type) {
      assert.equal(type, 'uint8array');
      return new Uint8Array([0x51, 0x55, 0x41, 0x43]);
    }
  }, 'fieldnote screenshot "internal://entry.png"', { bytes: qdpx.QDPX_MAX_EXPANDED_READ_BYTES - 4 });

  assert.equal(base64, 'UVVBQw==');

  await assert.rejects(
    () => qdpx.readZipBinaryBase64EntryWithSafety({
      _data: { uncompressedSize: 8 },
      async() {
        return new Uint8Array(8);
      }
    }, 'fieldnote screenshot "internal://entry.png"', { bytes: qdpx.QDPX_MAX_EXPANDED_READ_BYTES - 4 }),
    /decompressed content exceeds safety limit/i
  );
});
