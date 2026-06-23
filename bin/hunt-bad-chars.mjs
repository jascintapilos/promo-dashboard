// Hunt JS-string-breaking unicode chars in V69 dashboard.
import { readFileSync } from 'node:fs';
const html = readFileSync('tmp/v69_Dashboard.html', 'utf8');

// U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR terminate JS strings
// when content is injected via document.write (Apps Script's serving method).
let badLines = [];
[...html].forEach((c, i) => {
  const cp = c.codePointAt(0);
  if (cp === 0x2028 || cp === 0x2029 || (cp >= 0x80 && cp <= 0x9F) || cp === 0xFFFD) {
    badLines.push({ pos: i, cp });
  }
});
console.log('Bad chars found:', badLines.length);
badLines.slice(0, 20).forEach(b => {
  const before = html.slice(Math.max(0, b.pos - 40), b.pos);
  const after = html.slice(b.pos + 1, b.pos + 40);
  console.log(`  pos=${b.pos} cp=U+${b.cp.toString(16).toUpperCase()}`);
  console.log(`    before: ${JSON.stringify(before)}`);
  console.log(`    after:  ${JSON.stringify(after)}`);
});

// Also check raw file at the byte level
import { readFileSync as rfs } from 'node:fs';
const buf = rfs('tmp/v69_Dashboard.html');
console.log('\nByte length:', buf.length, 'Char length:', html.length);
// Any byte with value > 0x7F outside UTF-8 multibyte sequences would be suspicious
