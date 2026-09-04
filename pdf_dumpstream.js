const fs = require('fs');
const zlib = require('zlib');
const s = fs.readFileSync(process.argv[2]).toString('latin1');
const id = process.argv[3];
const outFile = process.argv[4];

function parseObjects(s) {
  const objects = {};
  const re = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const oid = m[1];
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
    objects[oid] = { num: +m[1], gen: +m[2], dict: dictStr, raw };
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
const objects = parseObjects(s);
const o = objects[id];
if (!o || o.raw == null) { console.log('not found'); process.exit(1); }
const content = inflate(o.raw);
if (!content) { console.log('inflate failed'); process.exit(1); }
fs.writeFileSync(outFile, content.toString('latin1'));
console.log('wrote', content.length, 'bytes');
