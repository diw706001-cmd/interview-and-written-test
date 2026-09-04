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
const objects = parseObjects(s);

// Show all objects brief
console.log('=== All objects ===');
for (const id in objects) {
  const o = objects[id];
  const hasStream = o.raw != null;
  let info = o.dict.split('\n').join(' ').slice(0, 220);
  console.log(`obj ${id}: ${hasStream ? '[stream len=' + o.raw.length + '] ' : ''}${info}`);
}

// Show font objects' ToUnicode cmap beginning
console.log('\n=== Fonts / ToUnicode ===');
for (const id in objects) {
  const o = objects[id];
  if (o.dict.includes('/Type /Font')) {
    console.log('--- font obj', id, '---');
    const tu = /\/ToUnicode\s+(\d+)/.exec(o.dict);
    if (tu) {
      const tuObj = objects[tu[1]];
      const c = tuObj ? inflate(tuObj.raw) : null;
      if (c) {
        const txt = c.toString('latin1');
        console.log('ToUnicode len', txt.length);
        console.log('CMap head:', txt.slice(0, 400).replace(/\n/g, '\\n'));
        console.log('CMap tail:', txt.slice(-500).replace(/\n/g, '\\n'));
      }
    }
    console.log('dict:', o.dict.slice(0, 600).replace(/\n/g, ' '));
  }
}

// Page contents
console.log('\n=== Pages and their content streams ===');
for (const id in objects) {
  const o = objects[id];
  if (o.dict.includes('/Type /Page')) {
    console.log('--- page obj', id, '---');
    console.log('dict:', o.dict.replace(/\n/g, ' ').slice(0, 500));
    const singleC = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(o.dict);
    let refs = [];
    if (singleC) refs.push(singleC[1]);
    const arrC = /\/Contents\s+\[([^\]]*)\]/.exec(o.dict);
    if (arrC) {
      const re = /(\d+)\s+\d+\s+R/g; let cm;
      while ((cm = re.exec(arrC[1])) !== null) refs.push(cm[1]);
    }
    for (const ref of refs) {
      const cobj = objects[ref];
      const content = cobj ? inflate(cobj.raw) : null;
      if (content) {
        const t = content.toString('latin1');
        console.log(`content stream obj ${ref} len=${t.length}`);
        console.log('head:', JSON.stringify(t.slice(0, 1500)));
        console.log('tail:', JSON.stringify(t.slice(-800)));
      }
    }
  }
}
