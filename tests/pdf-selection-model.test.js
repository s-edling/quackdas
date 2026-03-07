const test = require('node:test');
const assert = require('node:assert/strict');

const pdf = require('../js/pdf.js');

function unionRects(rects) {
  return rects.reduce((acc, rect) => ([
    Math.min(acc[0], rect[0]),
    Math.min(acc[1], rect[1]),
    Math.max(acc[2], rect[2]),
    Math.max(acc[3], rect[3])
  ]));
}

test('selection model maps a two-item line back to absolute document offsets including inserted spaces', () => {
  const doc = { content: 'Hello World' };
  const pageInfo = {
    pageNum: 1,
    width: 100,
    height: 100,
    textItems: [
      {
        text: 'Hello',
        start: 0,
        end: 5,
        transform: [10, 0, 0, 10, 10, 90],
        width: 25,
        height: 10
      },
      {
        text: 'World',
        start: 6,
        end: 11,
        transform: [10, 0, 0, 10, 40, 90],
        width: 28,
        height: 10
      }
    ]
  };

  const pageModel = pdf.buildPdfSelectionPageModelFromPageInfo(doc, pageInfo);
  assert.ok(pageModel);
  assert.equal(pageModel.chars.length, 10);

  const helloRect = unionRects(pageModel.chars.slice(0, 5).map((char) => char.rect));
  const helloSelection = pdf.getPdfSelectionRangeFromNormalizedRects(pageModel, [helloRect], doc);
  assert.deepEqual(helloSelection, {
    startIndex: 0,
    endIndex: 5,
    text: 'Hello'
  });

  const lineRect = unionRects(pageModel.chars.map((char) => char.rect));
  const lineSelection = pdf.getPdfSelectionRangeFromNormalizedRects(pageModel, [lineRect], doc);
  assert.deepEqual(lineSelection, {
    startIndex: 0,
    endIndex: 11,
    text: 'Hello World'
  });
});

test('selection model supports OCR-style normalized text item geometry', () => {
  const doc = { content: 'scan text' };
  const pageInfo = {
    pageNum: 1,
    width: 200,
    height: 100,
    ocr: true,
    textItems: [
      {
        text: 'scan',
        start: 0,
        end: 4,
        xNorm: 0.1,
        yNorm: 0.1,
        wNorm: 0.2,
        hNorm: 0.12
      },
      {
        text: 'text',
        start: 5,
        end: 9,
        xNorm: 0.34,
        yNorm: 0.1,
        wNorm: 0.18,
        hNorm: 0.12
      }
    ]
  };

  const pageModel = pdf.buildPdfSelectionPageModelFromPageInfo(doc, pageInfo);
  assert.ok(pageModel);
  assert.equal(pageModel.chars.length, 8);

  const rect = unionRects(pageModel.chars.map((char) => char.rect));
  const selection = pdf.getPdfSelectionRangeFromNormalizedRects(pageModel, [rect], doc);
  assert.deepEqual(selection, {
    startIndex: 0,
    endIndex: 9,
    text: 'scan text'
  });
});

test('selection model reconstructs legacy PDF item offsets when start/end are missing', () => {
  const doc = {
    content: 'Hello World',
    pdfPages: [
      {
        pageNum: 1,
        width: 100,
        height: 100,
        textItems: [
          {
            text: 'Hello',
            transform: [10, 0, 0, 10, 10, 90],
            width: 25,
            height: 10
          },
          {
            text: 'World',
            transform: [10, 0, 0, 10, 40, 90],
            width: 28,
            height: 10
          }
        ]
      }
    ]
  };

  const pageModel = pdf.buildPdfSelectionPageModelFromPageInfo(doc, doc.pdfPages[0]);
  assert.ok(pageModel);
  assert.equal(pageModel.chars.length, 10);

  const rect = unionRects(pageModel.chars.map((char) => char.rect));
  const selection = pdf.getPdfSelectionRangeFromNormalizedRects(pageModel, [rect], doc);
  assert.deepEqual(selection, {
    startIndex: 0,
    endIndex: 11,
    text: 'Hello World'
  });
});

test('text highlight rects merge per line for a coded PDF range', () => {
  const doc = { content: 'Hello World\nSecond line' };
  const pageInfo = {
    pageNum: 1,
    width: 100,
    height: 100,
    textItems: [
      {
        text: 'Hello',
        start: 0,
        end: 5,
        transform: [10, 0, 0, 10, 10, 90],
        width: 25,
        height: 10
      },
      {
        text: 'World',
        start: 6,
        end: 11,
        transform: [10, 0, 0, 10, 40, 90],
        width: 28,
        height: 10
      },
      {
        text: 'Second',
        start: 12,
        end: 18,
        transform: [10, 0, 0, 10, 10, 72],
        width: 32,
        height: 10
      },
      {
        text: 'line',
        start: 19,
        end: 23,
        transform: [10, 0, 0, 10, 46, 72],
        width: 20,
        height: 10
      }
    ]
  };

  const pageModel = pdf.buildPdfSelectionPageModelFromPageInfo(doc, pageInfo);
  assert.ok(pageModel);

  const rects = pdf.buildPdfTextHighlightRectsForRange(pageModel, 0, doc.content.length);
  assert.equal(rects.length, 2);
  assert.ok(rects[0][1] < rects[1][1]);
  assert.ok(rects[0][0] <= 0.1);
  assert.ok(rects[1][0] <= 0.1);
});

test('selection model keeps rotated text selectable', () => {
  const doc = { content: 'AB' };
  const pageInfo = {
    pageNum: 1,
    width: 100,
    height: 100,
    textItems: [
      {
        text: 'AB',
        start: 0,
        end: 2,
        transform: [0, 12, -12, 0, 50, 60],
        width: 24,
        height: 12
      }
    ]
  };

  const pageModel = pdf.buildPdfSelectionPageModelFromPageInfo(doc, pageInfo);
  assert.ok(pageModel);
  assert.equal(pageModel.chars.length, 2);

  const rect = unionRects(pageModel.chars.map((char) => char.rect));
  const selection = pdf.getPdfSelectionRangeFromNormalizedRects(pageModel, [rect], doc);
  assert.deepEqual(selection, {
    startIndex: 0,
    endIndex: 2,
    text: 'AB'
  });
});

test('selection refinement trims small geometry overshoot back to the selected born-digital PDF text', () => {
  const doc = {
    content: 'Prefix Vi har gemensamma intressen med löntagare världen över suffix'
  };

  const refined = pdf.refinePdfSelectionRangeWithSelectedText(
    doc,
    6,
    61,
    'Vi har gemensamma intressen med löntagare världen över'
  );

  assert.deepEqual(refined, {
    startIndex: 7,
    endIndex: 61,
    text: 'Vi har gemensamma intressen med löntagare världen över'
  });
});

test('selection refinement treats line-wrap whitespace as equivalent when matching nearby text', () => {
  const doc = {
    content: 'Det är roligt att så många internationella gäster är med i dag.'
  };

  const refined = pdf.refinePdfSelectionRangeWithSelectedText(
    doc,
    0,
    doc.content.length,
    'Det är roligt att så många internationella gäster\när med i dag.'
  );

  assert.deepEqual(refined, {
    startIndex: 0,
    endIndex: doc.content.length,
    text: doc.content
  });
});
