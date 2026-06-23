// Carefully scan V70 for the syntax bomb
import { readFileSync } from 'node:fs';
const html = readFileSync('tmp/v70_Dashboard.html', 'utf8');
const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

// 1. Find each block's line start in the HTML
const allLines = html.split('\n');
const starts = [];
let inBlk = false;
for (let i = 0; i < allLines.length; i++) {
  if (allLines[i].match(/<script[^>]*>/) && !inBlk) { inBlk = true; starts.push(i + 1); }
  if (allLines[i].includes('</script>') && inBlk) inBlk = false;
}
console.log('Block start lines in HTML:', starts);

// 2. Try parsing each block in strict mode
for (let i = 0; i < blocks.length; i++) {
  try { new Function('"use strict";' + blocks[i]); }
  catch (e) { console.log('Block', i, 'STRICT FAIL:', e.message); }
}

// 3. Bracket balance with proper escape handling
const code = blocks.join('\n');
let depth = { '(': 0, '[': 0, '{': 0 };
let templateDepth = 0;
let inStr = null, inCmt = null;
const open = '([{';
const close = ')]}';
const pair = { ')': '(', ']': '[', '}': '{' };
for (let i = 0; i < code.length; i++) {
  const c = code[i];
  const p = i > 0 ? code[i - 1] : '';
  // count backslashes before c to determine if escaped
  let bs = 0;
  for (let j = i - 1; j >= 0 && code[j] === '\\'; j--) bs++;
  const escaped = (bs % 2) === 1;
  if (inStr) {
    if (inStr === '`' && c === '$' && code[i + 1] === '{') { templateDepth++; i++; continue; }
    if (c === inStr && !escaped) inStr = null;
    continue;
  }
  if (inCmt === '*') { if (c === '*' && code[i + 1] === '/') { inCmt = null; i++; } continue; }
  if (inCmt === '/') { if (c === '\n') inCmt = null; continue; }
  if (c === '/' && code[i + 1] === '/') { inCmt = '/'; i++; continue; }
  if (c === '/' && code[i + 1] === '*') { inCmt = '*'; i++; continue; }
  if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
  if (open.includes(c)) depth[c]++;
  if (close.includes(c)) depth[pair[c]]--;
}
console.log('Final depth:', depth, 'templateDepth:', templateDepth);
console.log('In string at end?', inStr);
console.log('In comment at end?', inCmt);
