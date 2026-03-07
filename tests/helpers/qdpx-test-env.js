const { DOMParser: XmldomParser } = require('@xmldom/xmldom');

function getElementChildren(node) {
  const out = [];
  for (let child = node && node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) out.push(child);
  }
  return out;
}

function getDescendants(node) {
  const out = [];
  const stack = getElementChildren(node).reverse();
  while (stack.length > 0) {
    const current = stack.pop();
    out.push(current);
    const children = getElementChildren(current);
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return out;
}

function matchesSimpleTag(node, tagName) {
  if (!node || node.nodeType !== 1) return false;
  if (tagName === '*') return true;
  const actual = String(node.localName || node.tagName || '').toLowerCase();
  return actual === String(tagName || '').toLowerCase();
}

function parseSelector(selector) {
  const normalized = String(selector || '')
    .trim()
    .replace(/\s*>\s*/g, ' > ');
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const steps = [];
  let relation = 'descendant';

  if (tokens[0] === ':scope') {
    tokens.shift();
    relation = 'self';
    if (tokens[0] === '>') {
      tokens.shift();
      relation = 'child';
    }
  }

  tokens.forEach((token) => {
    if (token === '>') {
      relation = 'child';
      return;
    }
    steps.push({ relation, tagName: token });
    relation = 'descendant';
  });

  return steps;
}

function runSelector(root, selector) {
  let current = [root];
  const steps = parseSelector(selector);

  steps.forEach((step) => {
    const next = [];
    current.forEach((node) => {
      if (step.relation === 'self') {
        if (matchesSimpleTag(node, step.tagName)) next.push(node);
        return;
      }
      const pool = step.relation === 'child'
        ? getElementChildren(node)
        : getDescendants(node);
      pool.forEach((candidate) => {
        if (matchesSimpleTag(candidate, step.tagName)) next.push(candidate);
      });
    });
    current = next;
  });

  return current;
}

function installSelectorPolyfills(doc) {
  const docProto = Object.getPrototypeOf(doc);
  const elProto = Object.getPrototypeOf(doc.documentElement);

  if (!docProto.querySelectorAll) {
    docProto.querySelectorAll = function querySelectorAll(selectorList) {
      const selectors = String(selectorList || '').split(',').map((part) => part.trim()).filter(Boolean);
      const seen = new Set();
      const out = [];
      selectors.forEach((selector) => {
        runSelector(this, selector).forEach((node) => {
          if (seen.has(node)) return;
          seen.add(node);
          out.push(node);
        });
      });
      return out;
    };
  }

  if (!docProto.querySelector) {
    docProto.querySelector = function querySelector(selectorList) {
      return this.querySelectorAll(selectorList)[0] || null;
    };
  }

  if (!elProto.querySelectorAll) {
    elProto.querySelectorAll = docProto.querySelectorAll;
  }

  if (!elProto.querySelector) {
    elProto.querySelector = docProto.querySelector;
  }

  if (!elProto.closest) {
    elProto.closest = function closest(selector) {
      const tagName = String(selector || '').trim();
      let cursor = this;
      while (cursor && cursor.nodeType === 1) {
        if (matchesSimpleTag(cursor, tagName)) return cursor;
        cursor = cursor.parentNode;
      }
      return null;
    };
  }
}

class PatchedDomParser extends XmldomParser {
  parseFromString(source, mimeType) {
    const doc = super.parseFromString(source, mimeType);
    installSelectorPolyfills(doc);
    return doc;
  }
}

function installQdpxGlobals(stateModule) {
  globalThis.DOMParser = PatchedDomParser;
  globalThis.JSZip = require('../../js/jszip.min.js');
  globalThis.makeEmptyProject = stateModule.makeEmptyProject;
  globalThis.normalizePdfRegionShape = stateModule.normalizePdfRegionShape;
  globalThis.arrayBufferToBase64 = (buffer) => Buffer.from(new Uint8Array(buffer)).toString('base64');
  globalThis.base64ToArrayBuffer = (base64) => {
    const buffer = Buffer.from(base64, 'base64');
    const out = new Uint8Array(buffer.byteLength);
    out.set(buffer);
    return out.buffer;
  };
}

module.exports = {
  installQdpxGlobals
};
