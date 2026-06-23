#!/usr/bin/env node
/**
 * V33: Fix injected-script syntax error.
 * The previous injections had bare "=== ORCH_V2_INJECT_BEGIN ===" lines
 * INSIDE <script> blocks (markers were sliced from "/* === X === *\/"
 * but not re-wrapped in comments). That throws a SyntaxError on parse,
 * killing the entire IIFE — which is why date pill / KPI clicks / drawer
 * fix never took effect.
 *
 * Fix: wrap the markers as `// === ... ===` JS comments inside scripts.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// Find ALL bare marker lines in <script> blocks and wrap them in // comments.
// Markers like "=== ORCH_V2_INJECT_BEGIN ===" appear as plain text.
// We replace them with "// === ORCH_V2_INJECT_BEGIN ==="
//
// Strategy: walk through <script>...</script> sections and rewrite markers in there.
const scriptBlockRe = /<script>([\s\S]*?)<\/script>/g;
let changed = 0;
dash = dash.replace(scriptBlockRe, function(match, body) {
  const fixed = body.replace(/^([ \t]*)=== ([A-Z0-9_]+) ===\s*$/gm, '$1// === $2 ===');
  if (fixed !== body) changed++;
  return '<script>' + fixed + '</script>';
});
console.log(`Fixed ${changed} <script> block(s) with bare markers`);

// Also for <style> blocks — markers should be /* ... */ comments
const styleBlockRe = /<style>([\s\S]*?)<\/style>/g;
let cssChanged = 0;
dash = dash.replace(styleBlockRe, function(match, body) {
  const fixed = body.replace(/^([ \t]*)=== ([A-Z0-9_]+) ===\s*$/gm, '$1/* === $2 === */');
  if (fixed !== body) cssChanged++;
  return '<style>' + fixed + '</style>';
});
console.log(`Fixed ${cssChanged} <style> block(s) with bare markers`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V33: wrap bare === markers as JS/CSS comments (was syntax error) — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('\nThis is the root cause for ALL previous injections silently failing.');
console.log('After deploying V' + v.versionNumber + ', the dashboard should show:');
console.log('  - "V32" blue badge next to "Overview" title');
console.log('  - Clickable KPI cards (Completed/In Progress/At Risk navigate to Tasks)');
console.log('  - Clickable date pill (opens range popover)');
console.log('  - Task drawer opens on row click');
console.log('  - Reports page has Live BO Status section');
