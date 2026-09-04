const fs = require('fs');
const zlib = require('zlib');
const s = fs.readFileSync(process.argv[2]).toString('latin1');

function parseObjects(s) {
  const objects = {};
  const re = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const id = m[1];
    let body = m[3];
    let dictStr = '', raw = null;
    const st = body.indexOf('stream');
    if (st !== -1) {
      dictStr = body.slice(0, st);
      let after = body.slice(st + 6);
      if (after.startsWith('\r\n')) after = after.slice(2);
      else if (after.startsWith('\n')) after = after.slice(1);
      const endIdx = after.indexOf('endstream');
      raw = after.slice(0, endIdx);
      if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    } else dictStr = body;
    objects[id] = { num: +m[1], gen: +m[2], dict: dictStr, raw };
  }
  return objects;
}
function inflate(raw) {
  const b = Buffer.from(raw, 'latin1');
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync, zlib.gunzipSync]) {
    try { return fn(b); } catch (e) {}
  }
  return null;
}
function isFlate(obj) {
  return /\/Filter\s*\/FlateDecode\b/.test(obj.dict) || /\/Filter\s*\[[^\]]*\/FlateDecode/.test(obj.dict);
}
function parseHexBytes(hexStr) {
  const clean = hexStr.replace(/\s+/g, '');
  const bytes = [];
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.substr(i, 2), 16));
  return bytes;
}
function bytesToUtf16BE(bytes) {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const c = (bytes[i] << 8) | bytes[i + 1];
    out += String.fromCharCode(c);
  }
  return out;
}
function parseCMap(text) {
  const map = new Map();
  const charRe = /(\d+)\s+beginbfchar([\s\S]*?)endbfchar/g;
  let m;
  while ((m = charRe.exec(text)) !== null) {
    const entryRe = /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>/g;
    let e;
    while ((e = entryRe.exec(m[2])) !== null) {
      const sb = parseHexBytes(e[1]);
      const src = sb.length === 2 ? (sb[0] << 8) | sb[1] : sb[0];
      map.set(src, bytesToUtf16BE(parseHexBytes(e[2])));
    }
  }
  const rangeRe = /(\d+)\s+beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = rangeRe.exec(text)) !== null) {
    const arrRe = /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*\[([^\]]*)\]/g;
    let e;
    while ((e = arrRe.exec(m[2])) !== null) {
      const loB = parseHexBytes(e[1]); const hiB = parseHexBytes(e[2]);
      const lo = (loB[0] << 8) | loB[1];
      const hi = (hiB[0] << 8) | hiB[1];
      const list = [];
      const itemRe = /<([0-9A-Fa-f\s]+)>/g;
      let it;
      while ((it = itemRe.exec(e[3])) !== null) list.push(bytesToUtf16BE(parseHexBytes(it[1])));
      for (let c = lo; c <= hi; c++) map.set(c, list[c - lo] || '');
    }
    const singleRe = /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>/g;
    while ((e = singleRe.exec(m[2])) !== null) {
      const loB = parseHexBytes(e[1]); const hiB = parseHexBytes(e[2]);
      const lo = (loB[0] << 8) | loB[1];
      const hi = (hiB[0] << 8) | hiB[1];
      const dst = bytesToUtf16BE(parseHexBytes(e[3]));
      for (let c = lo; c <= hi; c++) map.set(c, dst);
    }
  }
  return map;
}
const objects = parseObjects(s);
for (const id of ['6', '7', '8']) {
  const o = objects[id];
  if (!o) continue;
  const tu = /\/ToUnicode\s+(\d+)/.exec(o.dict);
  if (!tu) { console.log('font', id, 'no ToUnicode'); continue; }
  const tuObj = objects[tu[1]];
  let content = tuObj ? (isFlate(tuObj) ? inflate(tuObj.raw) : Buffer.from(tuObj.raw, 'latin1')) : null;
  if (!content) { console.log('font', id, 'no content'); continue; }
  const map = parseCMap(content.toString('latin1'));
  console.log('font', id, 'map size =', map.size, 'keys sample:', [...map.keys()].slice(0, 5).map(k => '0x' + k.toString(16)), '... last:', [...map.keys()].slice(-3).map(k => '0x' + k.toString(16)));
  for (const c of [0x14, 0x177, 0x178, 0x1d7, 0x1ec, 0xf6, 0x3]) {
    const v = map.get(c);
    if (v !== undefined) console.log('  code 0x' + c.toString(16) + ' ->', JSON.stringify(v));
  }
}
// also decode a real snippet: page3 content first text codes
