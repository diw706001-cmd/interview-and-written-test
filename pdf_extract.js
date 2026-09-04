const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
const buf = fs.readFileSync(file);
const s = buf.toString('latin1');

// ---------- 1. parse objects ----------
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
    } else {
      dictStr = body;
    }
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

function getStreamContent(obj) {
  if (!obj || obj.raw == null) return null;
  if (isFlate(obj)) return inflate(obj.raw);
  // no filter: raw bytes directly
  return Buffer.from(obj.raw, 'latin1');
}

function dictHas(obj, key, val) {
  return obj && new RegExp('\\/' + key + '\\s*\\/' + val + '\\b').test(obj.dict);
}

// ---------- 2. ToUnicode CMap ----------
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
    if (c >= 0xd800 && c <= 0xdbff && i + 3 < bytes.length) {
      const c2 = (bytes[i + 2] << 8) | bytes[i + 3];
      if (c2 >= 0xdc00 && c2 <= 0xdfff) { out += String.fromCodePoint(((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000); i += 2; }
      else out += String.fromCharCode(c);
    } else out += String.fromCharCode(c);
  }
  return out;
}

function parseCMap(text) {
  const map = new Map();
  // bfchar: <src> <dst>
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
  // bfrange: each entry line is either "lo hi [list]" or "lo hi dst"
  const rangeRe = /(\d+)\s+beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = rangeRe.exec(text)) !== null) {
    const lines = m[2].split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const arrM = /^<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*\[([\s\S]*)\]$/.exec(line);
      if (arrM) {
        const loB = parseHexBytes(arrM[1]); const hiB = parseHexBytes(arrM[2]);
        const lo = (loB[0] << 8) | (loB[1] ?? 0);
        const hi = (hiB[0] << 8) | (hiB[1] ?? 0);
        const list = [];
        const itemRe = /<([0-9A-Fa-f\s]+)>/g;
        let it;
        while ((it = itemRe.exec(arrM[3])) !== null) list.push(bytesToUtf16BE(parseHexBytes(it[1])));
        for (let c = lo; c <= hi; c++) map.set(c, list[c - lo] || '');
        continue;
      }
      const singleM = /^<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>$/.exec(line);
      if (singleM) {
        const loB = parseHexBytes(singleM[1]); const hiB = parseHexBytes(singleM[2]);
        const lo = (loB[0] << 8) | (loB[1] ?? 0);
        const hi = (hiB[0] << 8) | (hiB[1] ?? 0);
        const dst = bytesToUtf16BE(parseHexBytes(singleM[3]));
        for (let c = lo; c <= hi; c++) map.set(c, dst);
      }
    }
  }
  return map;
}

// ---------- 3. font ToUnicode lookup ----------
const objects = parseObjects(s);
const fontToUnicode = new Map(); // fontObjId -> Map(code->str)
for (const id in objects) {
  const obj = objects[id];
  if (!obj) continue;
  if (dictHas(obj, 'Type', 'Font')) {
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(obj.dict);
    if (tu) {
      const tuObj = objects[tu[1]];
      const content = tuObj ? getStreamContent(tuObj) : null;
      if (content) fontToUnicode.set(+id, parseCMap(content.toString('latin1')));
    }
  }
}

// ---------- 4. tokenizer ----------
function tokenize(str) {
  const tokens = [];
  let i = 0;
  const n = str.length;
  const isWs = c => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\0';
  const isDelim = c => '()<>[]{}/%'.indexOf(c) !== -1;
  while (i < n) {
    const c = str[i];
    if (isWs(c)) { i++; continue; }
    if (c === '%') { const e = str.indexOf('\n', i); i = e === -1 ? n : e + 1; continue; }
    if (c === '(') {
      let depth = 0; let out = ''; let j = i;
      while (j < n) {
        const ch = str[j];
        if (ch === '\\') {
          const esc = str[j + 1];
          if (esc === 'n') out += '\n';
          else if (esc === 'r') out += '\r';
          else if (esc === 't') out += '\t';
          else if (esc === 'b') out += '\b';
          else if (esc === 'f') out += '\f';
          else if (esc === '(' || esc === ')' || esc === '\\') out += esc;
          else if (esc >= '0' && esc <= '7') {
            let octal = esc; let k = j + 2;
            while (k < n && octal.length < 3 && str[k] >= '0' && str[k] <= '7') { octal += str[k]; k++; }
            out += String.fromCharCode(parseInt(octal, 8)); j = k - 1;
          } else if (esc !== undefined) out += esc;
          j += 2; continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') { if (depth === 0) break; depth--; }
        out += ch;
        j++;
      }
      tokens.push({ t: 'str', v: out });
      i = j + 1; continue;
    }
    if (c === '<') {
      if (str[i + 1] === '<') { i += 2; continue; }
      const e = str.indexOf('>', i);
      tokens.push({ t: 'hex', v: str.slice(i + 1, e === -1 ? n : e) });
      i = (e === -1 ? n : e) + 1; continue;
    }
    if (c === '[') {
      const e = str.indexOf(']', i);
      tokens.push({ t: 'arr', v: str.slice(i + 1, e === -1 ? n : e) });
      i = (e === -1 ? n : e) + 1; continue;
    }
    if (c === ']' || c === '>' || c === '}' || c === '{') { i++; continue; }
    if (c === '/') {
      let j = i + 1;
      while (j < n && !isWs(str[j]) && !isDelim(str[j])) j++;
      tokens.push({ t: 'name', v: str.slice(i + 1, j) });
      i = j; continue;
    }
    let j = i;
    while (j < n && !isWs(str[j]) && !isDelim(str[j])) j++;
    const word = str.slice(i, j);
    if (/^-?\d+\.?\d*$/.test(word) || /^-?\.\d+$/.test(word)) tokens.push({ t: 'num', v: parseFloat(word) });
    else tokens.push({ t: 'op', v: word });
    i = j;
  }
  return tokens;
}

// ---------- 5. text decode ----------
function hexToBytes(hex) {
  const clean = hex.replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.substr(i, 2), 16));
  if (clean.length % 2 === 1) out.push(parseInt(clean[clean.length - 1], 16) * 16);
  return out;
}

function decodeCodes(bytes, map) {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1];
    out += (map && map.get(code)) || '';
  }
  return out;
}

function extractText(streamContent, fontMap) {
  const txt = streamContent.toString('latin1');
  const tokens = tokenize(txt);
  const lines = [];
  let curLine = '';
  let curFont = null;
  let textMode = false;

  const flush = () => {
    if (curLine.trim().length > 0) lines.push(curLine);
    curLine = '';
  };
  const addBytes = (bytes) => {
    const map = curFont && fontMap ? fontMap[curFont] : null;
    curLine += decodeCodes(bytes, map);
  };
  const prevNums = (i, k) => {
    // return k numbers immediately before token i (tokens i-1 ... i-k are nums)
    const out = [];
    for (let j = 1; j <= k; j++) {
      const tk = tokens[i - j];
      if (tk && tk.t === 'num') out.unshift(tk.v);
      else return null;
    }
    return out;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'name') {
      const nxt = tokens[i + 1], nxt2 = tokens[i + 2];
      if (nxt && nxt.t === 'num' && nxt2 && nxt2.t === 'op' && nxt2.v === 'Tf') {
        curFont = tk.v; i += 2;
      }
      continue;
    }
    if (tk.t === 'str' || tk.t === 'hex') {
      const nxt = tokens[i + 1];
      if (nxt && nxt.t === 'op' && nxt.v === 'Tj') {
        const bytes = tk.t === 'hex' ? hexToBytes(tk.v) : (() => { const b = []; for (let k = 0; k < tk.v.length; k++) b.push(tk.v.charCodeAt(k) & 0xff); return b; })();
        addBytes(bytes);
        i++;
      }
      continue;
    }
    if (tk.t === 'arr') {
      const nxt = tokens[i + 1];
      if (nxt && nxt.t === 'op' && nxt.v === 'TJ') {
        const inner = tk.v;
        const parts = [];
        const partRe = /\(((?:[^()\\]|\\.)*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+\.?\d*)/g;
        let pm;
        while ((pm = partRe.exec(inner)) !== null) {
          if (pm[1] !== undefined) {
            const b = []; for (let k = 0; k < pm[1].length; k++) b.push(pm[1].charCodeAt(k) & 0xff);
            parts.push({ t: 'b', v: b });
          } else if (pm[2] !== undefined) parts.push({ t: 'b', v: hexToBytes(pm[2]) });
        }
        for (const p of parts) addBytes(p.v);
        i++;
      }
      continue;
    }
    if (tk.t === 'op') {
      switch (tk.v) {
        case 'Td': case 'TD': {
          const nums = prevNums(i, 2);
          if (nums && nums[1] !== 0) flush(); // vertical move -> new line
          break;
        }
        case 'Tm': {
          const nums = prevNums(i, 6);
          if (nums) flush();
          break;
        }
        case 'T*': flush(); break;
        case 'ET': flush(); break;
        case 'BT': flush(); break;
        default: break;
      }
    }
  }
  flush();
  return lines;
}

// ---------- 6. pages ----------
function getResourcesDict(obj) {
  // /Resources N 0 R  -> follow ref; /Resources <<..>> -> inline
  if (!obj) return null;
  const ref = /\/Resources\s+(\d+)\s+\d+\s+R/.exec(obj.dict);
  if (ref && objects[ref[1]]) return objects[ref[1]].dict;
  const inline = /\/Resources\s*<<([\s\S]*?)>>/.exec(obj.dict);
  return inline ? inline[1] : null;
}
const pageIds = Object.keys(objects).filter(id => dictHas(objects[id], 'Type', 'Page'));
let output = '';
let pageIdx = 0;
for (const pid of pageIds) {
  pageIdx++;
  const obj = objects[pid];
  const fontMap = {};
  const resDict = getResourcesDict(obj);
  if (resDict) {
    const fontsRe = /\/Font\s*<<([\s\S]*?)>>/;
    const fm = fontsRe.exec(resDict);
    if (fm) {
      const entryRe = /\/(\w+)\s+(\d+)\s+\d+\s+R/g;
      let em;
      while ((em = entryRe.exec(fm[1])) !== null) fontMap[em[1]] = fontToUnicode.get(+em[2]) || new Map();
    }
  }
  const contentsRefs = [];
  const singleC = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(obj.dict);
  if (singleC) contentsRefs.push(singleC[1]);
  const arrC = /\/Contents\s+\[([^\]]*)\]/.exec(obj.dict);
  if (arrC) {
    const re = /(\d+)\s+\d+\s+R/g; let cm;
    while ((cm = re.exec(arrC[1])) !== null) contentsRefs.push(cm[1]);
  }
  output += `\n===== 第 ${pageIdx} 页 =====\n`;
  for (const ref of contentsRefs) {
    const cobj = objects[ref];
    const content = cobj ? getStreamContent(cobj) : null;
    if (content) {
      const lines = extractText(content, fontMap);
      output += lines.join('\n') + '\n';
    }
  }
}

if (process.argv[3]) fs.writeFileSync(process.argv[3], output, 'utf8');
else console.log(output);
