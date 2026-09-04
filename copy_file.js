const fs = require('fs');
const path = require('path');

const srcDir = 'C:/Users/14782/Documents/xwechat_files/wxid_bntlsczak5sl22_7d42/msg/file/2026-09';
const dst = 'c:/Users/14782/CodeBuddy/20260903190443/exam_test.pdf';

const files = fs.readdirSync(srcDir);
const target = files.find(f => f.includes('笔试题目'));
if (!target) {
  console.log('NOT FOUND, files:', files.join('|'));
  process.exit(1);
}
console.log('found:', target);
fs.copyFileSync(path.join(srcDir, target), dst);
console.log('copied to', dst, fs.statSync(dst).size, 'bytes');
