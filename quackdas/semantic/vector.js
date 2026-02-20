function toFloat32Buffer(values) {
  const arr = Array.isArray(values) ? values : [];
  const buffer = Buffer.allocUnsafe(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buffer.writeFloatLE(Number(arr[i]) || 0, i * 4);
  }
  return buffer;
}

function fromFloat32Buffer(blob) {
  if (!blob) return [];
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buffer.length % 4 !== 0) return [];
  const out = new Array(buffer.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = buffer.readFloatLE(i * 4);
  }
  return out;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (!(normA > 0) || !(normB > 0)) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
  toFloat32Buffer,
  fromFloat32Buffer,
  cosineSimilarity
};
