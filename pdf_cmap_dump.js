const fs = require('fs');
const zlib = require('zlib');
const buf = fs.readFileSync(process.argv[2]);
const s = buf.toString('latin1');

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
const objects = parseObjects(s);
for (const id of ['27', '32', '37']) {
  const o = objects[id];
  console.log('=== obj', id, '=== dict:', o ? o.dict.replace(/\n/g, ' ') : 'MISSING');
  if (!o || o.raw == null) continue;
  let content;
  if (isFlate(o)) content = inflate(o.raw);
  else content = Buffer.from(o.raw, 'latin1');
  if (!content) { console.log('inflate failed, raw head:', o.raw.slice(0, 100)); continue; }
  const t = content.toString('latin1');
  console.log('len', t.length);
  console.log(t.slice(0, 1500));
  console.log('...tail...');
  console.log(t.slice(-800));
}
