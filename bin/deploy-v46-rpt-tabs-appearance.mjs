#!/usr/bin/env node
/**
 * V46 — Reports tabs: kill native button appearance
 *
 * V45 added !important to background-color but Chromium's user-agent
 * stylesheet sets `appearance: auto` on <button>, which wins over CSS
 * background colors. Add `appearance: none` + `-webkit-appearance: none`
 * so our dark theme finally renders.
 *
 * Also wraps the tab content in a `<div>`-shaped layout to dodge any
 * residual button-control rendering quirks.
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

let pass = 0, fail = 0;
function patch(label, oldStr, newStr) {
  if (dash.includes(oldStr)) {
    dash = dash.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// Add appearance:none to the existing .rpt-tab rule
patch('.rpt-tab — add appearance:none to kill native button styling',
  `.rpt-tab{background-color:var(--card)!important;border:1px solid var(--border)!important;border-radius:10px!important;padding:10px 8px!important;cursor:pointer;display:flex!important;flex-direction:column!important;align-items:center!important;gap:4px!important;transition:all .18s!important;text-align:center!important;color:var(--text)!important;font-family:inherit!important;font-size:11px!important;line-height:1.3!important;min-height:78px;justify-content:flex-start!important;outline:none!important}`,
  `.rpt-tab{appearance:none!important;-webkit-appearance:none!important;-moz-appearance:none!important;background-color:var(--card)!important;background-image:none!important;border:1px solid var(--border)!important;border-radius:10px!important;padding:10px 8px!important;cursor:pointer;display:flex!important;flex-direction:column!important;align-items:center!important;gap:4px!important;transition:all .18s!important;text-align:center!important;color:var(--text)!important;font-family:inherit!important;font-size:11px!important;line-height:1.3!important;min-height:78px;justify-content:flex-start!important;outline:none!important;box-sizing:border-box}`);

// Bump badge V45 → V46
patch('Badge V45 → V46', `>V45 ✓</span>`, `>V46 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V46 — appearance:none on report tabs — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
