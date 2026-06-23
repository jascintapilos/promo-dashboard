import fs from 'fs';

const xml = fs.readFileSync('captures/sheet-extracted/xl/worksheets/sheet6.xml', 'utf8');
const ssxml = fs.readFileSync('captures/sheet-extracted/xl/sharedStrings.xml', 'utf8');

const ssRe = /<si>([\s\S]*?)<\/si>/g;
const ss = [];
let m;
while ((m = ssRe.exec(ssxml)) !== null) {
  ss.push(
    m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#10;/g, '\n')
      .replace(/&#13;/g, '\r'),
  );
}

function readRow(r) {
  const re = new RegExp(`<row r="${r}">([\\s\\S]*?)<\\/row>`);
  const match = xml.match(re);
  if (!match) return null;
  const body = match[1];
  const cellRe = /<c\s+([^>]+?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const cells = {};
  let cm;
  while ((cm = cellRe.exec(body)) !== null) {
    const attrs = cm[1];
    const inner = cm[2] || '';
    const rMatch = attrs.match(/r="([A-Z]+)(\d+)"/);
    const tMatch = attrs.match(/t="([^"]+)"/);
    const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
    const isMatch = inner.match(/<is><t[^>]*>([\s\S]*?)<\/t><\/is>/);
    if (!rMatch) continue;
    const t = tMatch ? tMatch[1] : null;
    let value = null;
    if (vMatch) value = t === 's' ? ss[parseInt(vMatch[1])] : vMatch[1];
    else if (isMatch) value = isMatch[1];
    cells[rMatch[1]] = value;
  }
  return cells;
}

for (const r of [1, 2, 3, 43]) {
  const row = readRow(r);
  console.log(`\n--- Row ${r} ---`);
  if (!row) {
    console.log('(not found)');
    continue;
  }
  const keys = Object.keys(row).sort((a, b) => {
    const numA = a.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
    const numB = b.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
    return numA - numB;
  });
  for (const k of keys) {
    const v = row[k] || '';
    console.log(`  ${k}: ${JSON.stringify(v).slice(0, 100)}`);
  }
}
