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
const objects = parseObjects(s);

// Summarize blocks of obj 27 CMap
for (const id of ['27', '32', '37']) {
  const o = objects[id];
  let content = isFlate(o) ? inflate(o.raw) : Buffer.from(o.raw, 'latin1');
  const t = content.toString('latin1');
  console.log('=== obj', id, 'len', t.length, '===');
  // count blocks
  const blocks = [...t.matchAll(/(\d+)\s+beginbf(char|range)/g)].map(m => ({ at: m.index, n: +m[1], kind: m[2] }));
  console.log('block count:', blocks.length);
  for (const b of blocks) console.log('  block at', b.at, 'count', b.n, 'kind', b.kind);
  // print region from 1500 to len-800 but summarized: show only block headers + surrounding 200 chars
  const mid = t.slice(1400, 3900);
  // show begin lines with context
  const lines = t.split('\n');
  const interesting = [];
  lines.forEach((ln, idx) => {
    if (/^\s*\d+\s+beginbf|^\s*<\d+>\s*<\d+>\s*<[0-9A-F]{4,}>/.test(ln) && !/\[/.test(ln)) {
      interesting.push('L' + idx + ': ' + ln.slice(0, 260));
    }
  });
  console.log(interesting.slice(0, 40).join('\n'));
  console.log('...');
}
