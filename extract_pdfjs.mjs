import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const file = process.argv[2];
const outFile = process.argv[3];
const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data }).promise;

const isCJK = ch => /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/.test(ch);

let output = '';
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const fs_ = Math.abs(it.transform[0]) || 10;
    items.push({
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      fs: fs_,
      str: it.str,
    });
  }
  // group into lines by y
  items.sort((a, b) => b.y - a.y);
  const lines = [];
  for (const it of items) {
    const tol = it.fs * 0.5;
    let placed = false;
    for (const ln of lines) {
      if (Math.abs(ln.y - it.y) < tol) { ln.items.push(it); placed = true; break; }
    }
    if (!placed) lines.push({ y: it.y, items: [it] });
  }
  output += `\n===== 第 ${p} 页 =====\n`;
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = null;
    let prevStr = '';
    for (const it of ln.items) {
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        const thresh = Math.max(it.fs, prevStr ? 10 : 0) * 0.18;
        const aCJK = isCJK(prevStr[prevStr.length - 1]);
        const bCJK = isCJK(it.str[0]);
        if (!aCJK && !bCJK && gap > it.fs * 0.1) text += ' ';
        else if (aCJK && !bCJK && gap > it.fs * 0.35) text += ' ';
        else if (!aCJK && bCJK && gap > it.fs * 0.35) text += ' ';
        else if (gap > it.fs * 0.4) text += ' ';
      }
      text += it.str;
      prevStr = it.str;
      prevEnd = it.x + it.w;
    }
    output += text + '\n';
  }
}

fs.writeFileSync(outFile, output, 'utf8');
console.log('done, pages =', doc.numPages);
