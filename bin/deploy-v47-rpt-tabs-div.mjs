#!/usr/bin/env node
/**
 * V47 — Reports tabs: switch <button> → <div role="button">
 *
 * Even with `appearance: none !important` and `background-color: var(--card)
 * !important`, the live page kept showing native button styling (light gray
 * background). That's likely because user-agent styles still set
 * `background-image: none` on initial paint, or the iframe sandbox is
 * applying its own override.
 *
 * Bulletproof fix: drop the <button> entirely. Use <div role="button"
 * tabindex="0" onclick=...>. No UA styling to fight.
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

// Replace <button class="rpt-tab"> → <div class="rpt-tab" role="button" tabindex="0">
patch('Tab element: <button> → <div role="button">',
  `    return '<button class="rpt-tab' + (active?' active':'') + '" onclick="selectReportModule_(\\''+m.id+'\\')">' +
      '<div class="rpt-tab-icon">' + m.icon + '</div>' +
      '<div class="rpt-tab-text"><div class="rpt-tab-label">' + m.label + '</div><div class="rpt-tab-sub">' + m.sub + '</div></div>' +
      '</button>';`,
  `    return '<div class="rpt-tab' + (active?' active':'') + '" role="button" tabindex="0" onclick="selectReportModule_(\\''+m.id+'\\')">' +
      '<div class="rpt-tab-icon">' + m.icon + '</div>' +
      '<div class="rpt-tab-text"><div class="rpt-tab-label">' + m.label + '</div><div class="rpt-tab-sub">' + m.sub + '</div></div>' +
      '</div>';`);

// Bump badge
patch('Badge V46 → V47', `>V46 ✓</span>`, `>V47 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V47 — tab <button> → <div> — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
