#!/usr/bin/env node
/**
 * V35: Make the diagnostic marker UNCONDITIONAL.
 *
 * Theory: V32/V33's marker code set dataset.v32marked='1' which prevents
 * future versions from re-marking. So even when V34 is loaded, the badge
 * stays as V32 (or invisible if cleared).
 *
 * Fix: always remove any previous marker badge and insert the new one.
 * Also add a console.log so it shows in DevTools regardless of DOM state.
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

// Replace the entire diagnostic block (matches the setTimeout marker)
const newMarker = `  setTimeout(function() {
    console.log('%c[Dashboard V35 LIVE]', 'color:#4cbfff;font-weight:bold');
    var t = document.querySelector('.hdr-title h1');
    if (t) {
      var existing = t.querySelector('.v-mark');
      if (existing) existing.remove();
      t.insertAdjacentHTML('beforeend', '<span class="v-mark" style="font-size:10px;color:#4cbfff;margin-left:8px;padding:3px 8px;background:rgba(76,191,255,0.18);border-radius:8px;border:1px solid #4cbfff;font-weight:600">V35 LIVE</span>');
    }
  }, 1500);`;

// Find the V34 marker setTimeout and replace with new
const v34MarkRe = /setTimeout\(function\(\) \{[^}]*v32marked[\s\S]*?V34 LIVE<\/span>'\);\s*\}\s*\}, 1500\);/;
if (v34MarkRe.test(dash)) {
  dash = dash.replace(v34MarkRe, newMarker);
  console.log('✓ Marker replaced');
} else {
  // Try simpler match: just the setTimeout with V34 LIVE inside
  const re2 = /setTimeout\(function\(\) \{[\s\S]*?V34 LIVE[\s\S]*?\}, 1500\);/;
  if (re2.test(dash)) {
    dash = dash.replace(re2, newMarker);
    console.log('✓ Marker replaced (regex 2)');
  } else {
    console.log('WARN: marker pattern not found — will be added after IIFE');
    // Inject before final closing of IIFE block
    const iifeEnd = dash.lastIndexOf('})();');
    if (iifeEnd >= 0) {
      dash = dash.slice(0, iifeEnd) + newMarker + '\n' + dash.slice(iifeEnd);
    }
  }
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V35: unconditional marker + DevTools log — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log('DEPLOY V' + v.versionNumber + ' AND VERIFY:');
console.log('═══════════════════════════════════════════════════════');
console.log('1. Apps Script → Deploy ▼ → Manage deployments');
console.log('2. Pencil on active deployment');
console.log('3. Pick Version ' + v.versionNumber + '');
console.log('4. Deploy → Done');
console.log('5. Open dashboard in NEW tab, F12 to open DevTools');
console.log('6. Look for: "[Dashboard V' + v.versionNumber + ' LIVE]" in Console (under sandboxFrame iframe)');
console.log('');
console.log('If V35 LIVE shows in console:');
console.log('  → JS injection works; badge should appear too. Refresh once more.');
console.log('If V35 LIVE does NOT show in console:');
console.log('  → Pasting the console error would let me see what is broken.');
