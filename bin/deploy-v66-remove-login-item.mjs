#!/usr/bin/env node
/**
 * V66 — Remove the Log In sidebar item (only kept Log Out)
 *
 *  Log In doesn't make sense once you're already inside the dashboard.
 *  Log Out stays under System.
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

// Remove the Log In line, keep Log Out
patch('Remove Log In sidebar item',
  `      <div class="nav-item" data-section="system" onclick="doGoogleLogin()" id="nav-login" style="cursor:pointer"><span class="nav-icon">🔑</span>Log In</div>
      <div class="nav-item" data-section="system" onclick="logOut_()" id="nav-logout" style="cursor:pointer"><span class="nav-icon">🚪</span>Log Out</div>`,
  `      <div class="nav-item" data-section="system" onclick="logOut_()" id="nav-logout" style="cursor:pointer"><span class="nav-icon">🚪</span>Log Out</div>`);

// Badge bump
patch('Badge V65 → V66', `>V65 ✓</span>`, `>V66 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V66 — remove Log In sidebar item — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
