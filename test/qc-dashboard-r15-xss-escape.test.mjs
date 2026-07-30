import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// R15: ensure every innerHTML site in public/qc-hub/app.js that interpolates
// BO- / server-derived text (findings, brand, code, brand.label) uses
// escapeHtml() around that interpolation. This is a static-source audit rather
// than a runtime DOM test because Playwright + real BO fixtures already cover
// the render pipeline; this test locks the escape pattern in so a future edit
// can't silently re-open the XSS surface Codex flagged in the readiness pass.

const APP_JS_PATH = path.resolve(process.cwd(), 'public/qc-hub/app.js');
const src = readFileSync(APP_JS_PATH, 'utf8');

function findLine(needle) {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return { line: i + 1, text: lines[i] };
  }
  return null;
}

test('escapeHtml() exists and covers &, <, >, ", \'', () => {
  const helper = findLine('function escapeHtml(');
  assert.ok(helper, 'escapeHtml helper must exist');
  // The regex signature we look for is stable — five HTML entity substitutions
  assert.match(src, /'&':\s*'&amp;'/);
  assert.match(src, /'<':\s*'&lt;'/);
  assert.match(src, /'>':\s*'&gt;'/);
  assert.match(src, /'"':\s*'&quot;'/);
  assert.match(src, /"'":\s*'&#39;'/);
});

test('renderPills escapes r.brand + r.code + resultKey', () => {
  // Extract the renderPills template literal
  const match = src.match(/function renderPills\([\s\S]*?\}\)\.join\(''\);/);
  assert.ok(match, 'renderPills body must be present');
  const body = match[0];
  assert.match(body, /escapeHtml\(r\.brand\)/, 'r.brand not escaped');
  assert.match(body, /escapeHtml\(r\.code\)/, 'r.code not escaped');
  assert.match(body, /escapeHtml\(key\)/, 'resultKey not escaped in data-key attribute');
});

test('findings innerHTML escapes f.severity + f.message', () => {
  // Extract just the block around `$('findings').innerHTML`
  const match = src.match(/\$\('findings'\)\.innerHTML = data\.findings\.map[\s\S]*?\|\| '<div class="muted">No findings<\/div>';/);
  assert.ok(match, 'findings innerHTML block must be present');
  const body = match[0];
  assert.match(body, /escapeHtml\(f\.severity\)/, 'f.severity not escaped');
  assert.match(body, /escapeHtml\(f\.message\)/, 'f.message not escaped — Codex-flagged blocker regression');
});

test('renderDetailsTable escapes result.brand + column.label', () => {
  const match = src.match(/function renderDetailsTable\([\s\S]*?\}\s*\n\}/);
  assert.ok(match, 'renderDetailsTable body must be present');
  const body = match[0];
  assert.match(body, /escapeHtml\(result\.brand\)/, 'result.brand not escaped');
  assert.match(body, /escapeHtml\(column\.label\)/, 'column.label not escaped');
});

test('renderBrands chip block escapes brand.id + brand.label', () => {
  // Whole-file substring assertions — regex was too fragile against nested
  // template literals + backtick continuation.
  assert.ok(src.includes('escapeHtml(brand.id)'), 'brand.id escape missing');
  assert.ok(src.includes('escapeHtml(brand.label)'), 'brand.label escape missing');
});

test('brandAddSelect options escape b.id + b.label', () => {
  assert.ok(src.includes('escapeHtml(b.id)'), 'b.id escape missing');
  assert.ok(src.includes('escapeHtml(b.label)'), 'b.label escape missing');
});

test('loadHistory escapes brand + code + qc_result + timestamp', () => {
  const match = src.match(/\$\('historyRows'\)\.innerHTML = state\.historyRows\.map[\s\S]*?\}\)\.join\(''\);/);
  assert.ok(match, 'loadHistory row map must be present');
  const body = match[0];
  assert.match(body, /escapeHtml\(r\.brand \|\| ''\)/, 'history r.brand not escaped');
  assert.match(body, /escapeHtml\(r\.code \|\| ''\)/, 'history r.code not escaped');
  assert.match(body, /escapeHtml\(r\.qc_result \|\| ''\)/, 'history r.qc_result not escaped');
  // Timestamp is processed via .replace + .slice but must still pass through escapeHtml
  assert.match(body, /escapeHtml\(\(r\.timestamp/, 'history timestamp not escaped');
});

test('R15 payload sanity — the helper actually neutralizes <img onerror=...>', () => {
  // Reproduce the helper's behavior via a tiny inline copy so the assertion
  // is portable (the real function isn't exported from a browser module).
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  })[c]);
  const attack = `<img src=x onerror="alert('xss')">`;
  const safe = escapeHtml(attack);
  assert.equal(safe, `&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;`);
  // Also: no literal < in output
  assert.ok(!/</.test(safe));
});
