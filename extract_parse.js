const fs = require('fs');
const { PDFParse } = require('pdf-parse');

(async () => {
  const parser = new PDFParse({ data: fs.readFileSync(process.argv[2]) });
  try {
    const res = await parser.getText();
    let text = '';
    if (typeof res.text === 'string') text = res.text;
    else if (Array.isArray(res.pages)) text = res.pages.map(p => p.text || p.content || '').join('\n');
    else text = JSON.stringify(res, null, 2);
    text = text.split('').map(c => (c.charCodeAt(0) < 32 && c !== '\n' && c !== '\t') ? '' : c).join('');
    fs.writeFileSync(process.argv[3], text, 'utf8');
    console.log('ok, text chars:', text.length);
  } finally {
    await parser.destroy();
  }
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
