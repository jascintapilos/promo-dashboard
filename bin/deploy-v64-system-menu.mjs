#!/usr/bin/env node
/**
 * V64 — Hide the "Integrated" source bar + add Log In / Log Out to System
 *
 *  1. The bottom "Integrated: Google Sheets · Google Drive · Apps Script"
 *     strip → hidden (kept in the DOM for now in case we need it for debug,
 *     just display:none on the wrapper).
 *
 *  2. Sidebar → System section gets two new items:
 *     - 🔑 Log In   → triggers doGoogleLogin() / Google account picker
 *     - 🚪 Log Out  → drops the session (Google logout URL → back to /exec)
 *
 *     Both are always visible under System for any signed-in role.
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

// ─── 1. Hide the source bar via CSS ─────────────────────────────────────────
patch('Hide .source-bar (Integrated: Sheets · Drive · Apps Script)',
  `.source-bar{padding:10px 20px;border-top:1px solid var(--border);background:var(--sidebar);display:flex;align-items:center;gap:20px;overflow-x:auto;flex-shrink:0}`,
  `.source-bar{display:none}`);

// ─── 2. Add Log In + Log Out items under System ─────────────────────────────
patch('Sidebar System — add Log In + Log Out',
  `      <div class="nav-section" id="nav-sec-system">System</div>
      <div class="nav-item" data-view="settings" data-section="system" onclick="nav('settings')" id="nav-settings"><span class="nav-icon">⚙</span>Settings</div>`,
  `      <div class="nav-section" id="nav-sec-system">System</div>
      <div class="nav-item" data-view="settings" data-section="system" onclick="nav('settings')" id="nav-settings"><span class="nav-icon">⚙</span>Settings</div>
      <div class="nav-item" data-section="system" onclick="doGoogleLogin()" id="nav-login" style="cursor:pointer"><span class="nav-icon">🔑</span>Log In</div>
      <div class="nav-item" data-section="system" onclick="logOut_()" id="nav-logout" style="cursor:pointer"><span class="nav-icon">🚪</span>Log Out</div>`);

// ─── 3. Add logOut_ helper ──────────────────────────────────────────────────
patch('JS — add logOut_ helper (Google session drop)',
  `function switchAccount_() {
  // Force Google to prompt account picker by visiting the logout URL then back
  var here = location.href.split('?')[0];
  location.href = 'https://accounts.google.com/Logout?continue=' + encodeURIComponent(here);
}`,
  `function switchAccount_() {
  // Force Google to prompt account picker by visiting the logout URL then back
  var here = location.href.split('?')[0];
  location.href = 'https://accounts.google.com/Logout?continue=' + encodeURIComponent(here);
}

function logOut_() {
  // Same mechanism as switchAccount_, but with a confirm prompt
  if (!confirm('Log out of Promo Control Tower?')) return;
  var here = location.href.split('?')[0];
  location.href = 'https://accounts.google.com/Logout?continue=' + encodeURIComponent(here);
}`);

// Badge bump
patch('Badge V63 → V64', `>V63 ✓</span>`, `>V64 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V64 — hide source bar + System Log In/Log Out — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
