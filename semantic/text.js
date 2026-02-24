const crypto = require('crypto');

function canonicalizeText(input) {
  if (input == null) return '';
  const text = String(input);
  return text.replace(/\r\n?/g, '\n');
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

function getDocumentTextHash(docText) {
  return sha256Hex(canonicalizeText(docText));
}

module.exports = {
  canonicalizeText,
  sha256Hex,
  getDocumentTextHash
};
