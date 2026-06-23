#!/usr/bin/env node
/**
 * V36: Fix version badge — was never visible because:
 *   1. renderView() calls h1.textContent = '...' which strips all child elements
 *      (including any previously-injected badge span) on every page nav + data refresh.
 *   2. The setTimeout patch fired once, but a subsequent renderView wipe removed it.
 *
 * Fix: patch renderView to re-insert the badge INLINE immediately after
 *      the textContent assignment, so every navigation keeps the badge.
 *
 * Also: remove the unreliable setTimeout badge; add a console.log at IIFE start.
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

// 1. Patch renderView: after textContent line, re-insert badge
const OLD_TEXTCONTENT = `  document.getElementById('hdr-title').textContent = titles[v] || v;`;
const NEW_TEXTCONTENT = `  document.getElementById('hdr-title').textContent = titles[v] || v;
  // V36: re-inject badge after every textContent wipe
  (function() {
    var _h = document.getElementById('hdr-title');
    if (_h && !_h.querySelector('.v-mark')) {
      _h.insertAdjacentHTML('beforeend', '<span class="v-mark" style="font-size:10px;color:#4cbfff;margin-left:8px;padding:3px 8px;background:rgba(76,191,255,0.18);border-radius:8px;border:1px solid #4cbfff;font-weight:600">V36 ✓</span>');
    }
  })();`;

if (dash.includes(OLD_TEXTCONTENT)) {
  dash = dash.replace(OLD_TEXTCONTENT, NEW_TEXTCONTENT);
  console.log('✓ renderView patched — badge re-injected on every nav');
} else {
  console.error('WARN: textContent line not found verbatim');
}

// 2. Replace the unreliable V35 setTimeout with a simple IIFE console.log
const v35SetTimeoutRe = /setTimeout\(function\(\) \{[\s\S]*?V35 LIVE[\s\S]*?\}, 1500\);/;
if (v35SetTimeoutRe.test(dash)) {
  dash = dash.replace(v35SetTimeoutRe,
    `console.log('%c[Dashboard V36 LIVE]', 'color:#4cbfff;font-weight:bold;font-size:14px');`
  );
  console.log('✓ V35 setTimeout replaced with V36 console.log');
} else {
  console.log('INFO: V35 setTimeout not found — skipping replacement');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V36: badge in renderView (survives textContent wipe) — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log('DEPLOY V' + v.versionNumber + ':');
console.log('  Apps Script → Deploy ▼ → Manage deployments');
console.log('  Pencil → Version ' + v.versionNumber + ' → Deploy');
console.log('  Open dashboard in fresh tab');
console.log('  Badge "V36 ✓" should appear next to every page title');
console.log('═══════════════════════════════════════════════════════');
