const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../js/state.js');
const { installQdpxGlobals } = require('./helpers/qdpx-test-env');

installQdpxGlobals(state);

const qdpx = require('../js/qdpx.js');

test('QDPX export/import round-trips rich project data', async () => {
  const project = state.normaliseProject({
    projectName: 'Roundtrip Project',
    lastSaveTime: '2025-02-01T10:00:00.000Z',
    documents: [
      {
        id: 'doc_text',
        title: 'Interview 1',
        type: 'text',
        content: 'Alpha Beta Gamma',
        richContentHtml: '<p><strong>Alpha</strong> Beta Gamma</p>',
        metadata: { participantId: 'P01', site: 'Stockholm' },
        created: '2025-02-01T09:00:00.000Z',
        lastAccessed: '2025-02-01T09:30:00.000Z',
        folderId: 'folder_1'
      },
      {
        id: 'doc_pdf',
        title: 'Scanned Report',
        type: 'pdf',
        content: 'Extracted PDF text',
        pdfData: Buffer.from('%PDF-1.4 fake').toString('base64'),
        pdfPages: [
          {
            pageNum: 1,
            width: 612,
            height: 792,
            ocr: true,
            textItems: [
              {
                text: 'Extracted',
                start: 0,
                end: 9,
                xNorm: 0.1,
                yNorm: 0.1,
                wNorm: 0.2,
                hNorm: 0.03
              },
              {
                text: 'PDF',
                start: 10,
                end: 13,
                xNorm: 0.32,
                yNorm: 0.1,
                wNorm: 0.08,
                hNorm: 0.03
              }
            ]
          }
        ],
        created: '2025-02-01T09:05:00.000Z',
        lastAccessed: '2025-02-01T09:35:00.000Z'
      }
    ],
    codes: [
      { id: 'code_parent', name: 'Parent', color: '#123456', description: 'Top level', created: '2025-02-01T09:00:00.000Z' },
      { id: 'code_child', name: 'Child', parentId: 'code_parent', color: '#654321', notes: 'Nested', created: '2025-02-01T09:01:00.000Z' }
    ],
    segments: [
      {
        id: 'seg_text',
        docId: 'doc_text',
        text: 'Alpha Beta',
        codeIds: ['code_parent'],
        startIndex: 0,
        endIndex: 10,
        created: '2025-02-01T09:10:00.000Z',
        modified: '2025-02-01T09:11:00.000Z'
      },
      {
        id: 'seg_pdf',
        docId: 'doc_pdf',
        text: 'Figure block',
        codeIds: ['code_child'],
        startIndex: 0,
        endIndex: 5,
        created: '2025-02-01T09:12:00.000Z',
        modified: '2025-02-01T09:13:00.000Z',
        pdfRegion: {
          pageNum: 2,
          xNorm: 0.1,
          yNorm: 0.2,
          wNorm: 0.3,
          hNorm: 0.4
        }
      }
    ],
    memos: [
      {
        id: 'memo_seg',
        type: 'segment',
        targetId: 'seg_text',
        codeId: 'code_parent',
        content: 'Important excerpt',
        tag: 'insight',
        created: '2025-02-01T09:15:00.000Z',
        edited: '2025-02-01T09:16:00.000Z'
      }
    ],
    folders: [
      {
        id: 'folder_1',
        name: 'Interviews',
        description: 'Primary interview docs',
        created: '2025-02-01T09:00:00.000Z',
        expanded: false
      }
    ],
    cases: [
      {
        id: 'case_1',
        name: 'Participant 1',
        linkedDocumentIds: ['doc_text'],
        attributes: { cohort: 'A' },
        created: '2025-02-01T09:00:00.000Z',
        modified: '2025-02-01T09:20:00.000Z'
      }
    ],
    variableDefinitions: [
      { id: 'var_1', name: 'cohort', type: 'Text' }
    ],
    codeViewPresets: [
      { id: 'preset_1', name: 'Focused', updated: '2025-02-01T09:25:00.000Z', state: { sort: 'count', collapsed: 'false' } }
    ]
  });

  state.__setAppDataForTests(project);
  globalThis.appData = state.__getAppDataForTests();

  const blob = await qdpx.exportToQdpx();
  const imported = state.normaliseProject(await qdpx.importFromQdpx(await blob.arrayBuffer()));

  assert.equal(imported.projectName, 'Roundtrip Project');
  assert.equal(imported.documents.length, 2);
  assert.equal(imported.codes.length, 2);
  assert.equal(imported.segments.length, 2);
  assert.equal(imported.folders.length, 1);
  assert.equal(imported.cases.length, 1);
  assert.equal(imported.codeViewPresets.length, 1);
  assert.equal(imported.documents.find((doc) => doc.id !== 'doc_text') !== undefined, true);

  const textDoc = imported.documents.find((doc) => doc.title === 'Interview 1');
  assert.equal(textDoc.metadata.participantId, 'P01');
  assert.equal(textDoc.folderId !== null, true);
  assert.match(textDoc.richContentHtml, /Alpha/);

  const pdfDoc = imported.documents.find((doc) => doc.title === 'Scanned Report');
  assert.equal(pdfDoc.type, 'pdf');
  assert.equal(typeof pdfDoc.pdfData, 'string');
  assert.equal(Array.isArray(pdfDoc.pdfPages), true);
  assert.equal(pdfDoc.pdfPages.length, 1);
  assert.equal(pdfDoc.pdfPages[0].ocr, true);
  assert.equal(pdfDoc.pdfPages[0].textItems[0].text, 'Extracted');

  const pdfSegment = imported.segments.find((segment) => segment.docId === pdfDoc.id);
  assert.equal(pdfSegment.pdfRegion.pageNum, 2);
  assert.equal(pdfSegment.pdfRegion.wNorm, 0.3);

  const memo = imported.memos[0];
  assert.equal(memo.tag, 'insight');
  assert.equal(Boolean(memo.codeId), true);

  const importedCase = imported.cases[0];
  assert.equal(importedCase.attributes.cohort, 'A');
  assert.deepEqual(importedCase.linkedDocumentIds, [textDoc.id]);
});

test('QDPX import rejects malformed archives and accepts backward-compatible selection/code forms', async () => {
  await assert.rejects(
    qdpx.importFromQdpx(Uint8Array.from(Buffer.from('not a zip')).buffer),
    /Invalid QDPX file|missing project\.qde|Corrupted zip|Can't read the data|zip file/i
  );

  const legacyXml = `<?xml version="1.0" encoding="UTF-8"?>
  <Project xmlns="urn:QDA-XML:project:1.0" name="Legacy import">
    <CodeBook>
      <Codes>
        <Code guid="code-guid" name="Legacy code" color="255,0,0" />
      </Codes>
    </CodeBook>
    <Sources>
      <TextSource guid="doc-guid" name="Legacy doc" plainTextPath="internal://doc.txt">
        <PlainTextSelection guid="seg-guid" startPosition="0" endPosition="6">
          <Coding>
            <CodeRef targetGUID="code-guid" />
          </Coding>
        </PlainTextSelection>
      </TextSource>
    </Sources>
    <Notes>
      <Note guid="memo-guid" quackdasCodeGUID="code-guid">
        <PlainTextContent>Legacy memo</PlainTextContent>
        <NoteRef targetGUID="seg-guid" />
      </Note>
    </Notes>
  </Project>`;

  const zip = new globalThis.JSZip();
  zip.file('project.qde', legacyXml);
  zip.file('sources/doc.txt', 'Legacy text body');

  const imported = state.normaliseProject(await qdpx.importFromQdpx(await zip.generateAsync({ type: 'arraybuffer' })));
  assert.equal(imported.projectName, 'Legacy import');
  assert.equal(imported.documents[0].content, 'Legacy text body');
  assert.deepEqual(imported.segments[0].codeIds.length, 1);
  assert.equal(imported.codes[0].color, '#ff0000');
  assert.equal(imported.memos[0].codeId, imported.codes[0].id);
});
