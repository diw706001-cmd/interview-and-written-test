const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
const buf = fs.readFileSync(file);
const s = buf.toString('latin1');

console.log('=== Header ===');
console.log(s.slice(0, 100));

console.log('\n=== Counts ===');
const objCount = (s.match(/\d+ \d+ obj/g) || []).length;
console.log('objects:', objCount);
console.log('Filter/FlateDecode count:', (s.match(/FlateDecode/g) || []).length);
console.log('stream count:', (s.match(/stream\r?\n/g) || []).length);
console.log('ToUnicode count:', (s.match(/ToUnicode/g) || []).length);
console.log('FontFile count:', (s.match(/FontFile2/g) || []).length);
console.log('Image (XObject) count:', (s.match(/\/Subtype\s*\/Image/g) || []).length);
console.log('Tj operators:', (s.match(/Tj\b/g) || []).length);
console.log('TJ operators:', (s.match(/\[/g) || []).length);
console.log('BT count:', (s.match(/BT/g) || []).length);
console.log('Contains "电脑"? bytes:', buf.includes(Buffer.from('电脑', 'utf8')));
console.log('Contains "考试"? bytes:', buf.includes(Buffer.from('考试', 'utf8')));

// List object types
console.log('\n=== Object dictionary types ===');
const objRe = /(\d+) \d+ obj\s*(<<[\s\S]*?>>)?\s*(stream)?/g;
let m;
const types = new Map();
while ((m = objRe.exec(s)) !== null) {
  const dict = m[2] || '';
  let t = (dict.match(/\/Type\s*\/(\w+)/) || [])[1] || 'dict';
  let sub = (dict.match(/\/Subtype\s*\/(\w+)/) || [])[1] || '';
  const key = sub || t;
  types.set(key, (types.get(key) || 0) + 1);
}
for (const [k, v] of types) console.log(k, v);
