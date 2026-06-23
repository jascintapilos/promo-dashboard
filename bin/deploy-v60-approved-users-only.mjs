#!/usr/bin/env node
/**
 * V60 — Lock the dashboard to the approved Users list only
 *
 *  Current behaviour: any @thebrandingpeople.co email auto-resolves to
 *  'member' role even if they were never added. That means a teammate from
 *  another department could sign in and see the dashboard.
 *
 *  V60 changes:
 *    1. resolveRole_() now ONLY returns the role recorded in the Users sheet.
 *       Anyone not in the sheet → 'guest' (blocked).
 *    2. serverGetCurrentUser returns a richer payload {email, role, display,
 *       approved} so the client can show a friendly "Access denied" screen
 *       to authenticated-but-unapproved users — they know who to ask for
 *       access instead of staring at the bare login button.
 *    3. The login overlay grows an "access denied" panel that appears when
 *       Google says the user IS signed in but role === 'guest'. Includes a
 *       Switch Account link and the admin contact.
 *    4. Adding new approved members: existing Settings → Add User flow still
 *       works (serverSaveUser writes Email/Role/Name to the Users sheet).
 *       Admins can also seed it via the spreadsheet directly.
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
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
let dash = proj.files[dashIdx].source;
let code = proj.files[codeIdx].source;

let pass = 0, fail = 0;
function patch(label, target, oldStr, newStr) {
  const src = target === 'dash' ? dash : code;
  if (src.includes(oldStr)) {
    if (target === 'dash') dash = src.replace(oldStr, newStr);
    else                   code = src.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// ─── 1. Server: lock resolveRole_ to Users sheet entries only ───────────────
patch('resolveRole_ — Users sheet is the sole source of truth',
  'code',
  `function resolveRole_(email) {
  if (!email) return 'guest';
  try {
    const sheet = openSS_().getSheetByName('Users');
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).toLowerCase().trim() === email) {
          const r = String(data[i][1]).toLowerCase().trim();
          return r || 'member';
        }
      }
    }
  } catch (e) {}
  if (email.endsWith('@thebrandingpeople.co')) return 'member';
  return 'guest';
}`,
  `function resolveRole_(email) {
  if (!email) return 'guest';
  try {
    const sheet = openSS_().getSheetByName('Users');
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).toLowerCase().trim() === email) {
          const r = String(data[i][1]).toLowerCase().trim();
          return r || 'member';
        }
      }
    }
  } catch (e) {}
  // No automatic role for any domain — Users sheet is the only allow-list.
  return 'guest';
}`);

// ─── 2. Enrich serverGetCurrentUser payload with .approved flag ─────────────
patch('serverGetCurrentUser — return .approved flag',
  'code',
  `function serverGetCurrentUser() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  const role  = resolveRole_(email);
  const display = email
    ? toTitleCase_(email.split('@')[0].replace(/[._]/g, ' '))
    : 'Guest';
  return { email, role, display };
}`,
  `function serverGetCurrentUser() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  const role  = resolveRole_(email);
  const display = email
    ? toTitleCase_(email.split('@')[0].replace(/[._]/g, ' '))
    : 'Guest';
  return {
    email,
    role,
    display,
    approved: !!email && role !== 'guest',
    adminContact: 'jascintapilos@thebrandingpeople.co',
  };
}`);

// ─── 3. Client: enhance login overlay to show denial state ──────────────────
patch('Login overlay — add hidden Access Denied panel',
  'dash',
  `<div id="login-overlay">
  <div class="login-card">
    <div class="login-logo">🏢</div>
    <div class="login-title">Promo Control Tower</div>
    <div class="login-sub">2026 — The Branding People</div>
    <button class="login-google" onclick="doGoogleLogin()">
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Sign in with Google
    </button>
    <button class="login-guest" onclick="continueAsGuest()">Continue as Guest / Submit a Request</button>
    <div class="login-note">Staff must use their @thebrandingpeople.co account.<br>Guests can submit requests without signing in.</div>
  </div>
</div>`,
  `<div id="login-overlay">
  <div class="login-card" id="login-card-default">
    <div class="login-logo">🏢</div>
    <div class="login-title">Promo Control Tower</div>
    <div class="login-sub">2026 — The Branding People</div>
    <button class="login-google" onclick="doGoogleLogin()">
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Sign in with Google
    </button>
    <button class="login-guest" onclick="continueAsGuest()">Continue as Guest / Submit a Request</button>
    <div class="login-note">Approved staff only.<br>Guests can submit requests without signing in.</div>
  </div>

  <!-- Access denied panel (shown when user signed in but not on Users sheet) -->
  <div class="login-card" id="login-card-denied" style="display:none;border:1px solid var(--red);box-shadow:0 0 0 1px var(--red),0 8px 32px rgba(239,68,68,.2)">
    <div class="login-logo" style="background:rgba(239,68,68,.15);color:#ef4444">🚫</div>
    <div class="login-title">Access Denied</div>
    <div class="login-sub" id="denied-email" style="font-family:'SF Mono',monospace;color:var(--muted);margin-bottom:8px"></div>
    <div style="font-size:13px;color:var(--text);line-height:1.5;margin:10px 0 16px 0">
      Your email isn't on the approved users list.<br>
      Please contact your admin for access:<br>
      <a id="denied-admin" href="#" style="color:var(--accent);font-weight:600;text-decoration:none"></a>
    </div>
    <button class="login-google" onclick="switchAccount_()" style="background:var(--card2);color:var(--text);border:1px solid var(--border)">
      Switch Google Account
    </button>
    <button class="login-guest" onclick="continueAsGuest()">Continue as Guest / Submit a Request</button>
  </div>
</div>`);

// ─── 4. startApp — show denied panel for unapproved signed-in users ─────────
patch('startApp — branch on .approved (not just guest)',
  'dash',
  `function startApp() {
  // ── Auth gate: unauthenticated users see only the login screen ─────────
  if (!S.user || S.user.role === 'guest' || !S.user.email) {
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('bot-fab').style.display = 'none';
    return;
  }`,
  `function startApp() {
  // ── Auth gate ───────────────────────────────────────────────────────────
  // 1) Not signed in → show default login screen
  // 2) Signed in BUT not on approved list → show "Access Denied" screen
  // 3) Signed in AND approved → show the dashboard
  if (!S.user || !S.user.email) {
    showLoginCard_('default');
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('bot-fab').style.display = 'none';
    return;
  }
  if (S.user.role === 'guest' || S.user.approved === false) {
    document.getElementById('denied-email').textContent = S.user.email;
    var admin = S.user.adminContact || 'jascintapilos@thebrandingpeople.co';
    var ae = document.getElementById('denied-admin');
    if (ae) { ae.textContent = admin; ae.href = 'mailto:' + admin + '?subject=Promo%20Control%20Tower%20Access%20Request'; }
    showLoginCard_('denied');
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('bot-fab').style.display = 'none';
    return;
  }`);

// ─── 5. Add card-switch + switch-account helpers ────────────────────────────
patch('Add showLoginCard_ + switchAccount_ helpers',
  'dash',
  `function doGoogleLogin() {`,
  `function showLoginCard_(which) {
  var def = document.getElementById('login-card-default');
  var den = document.getElementById('login-card-denied');
  if (def) def.style.display = (which === 'denied') ? 'none' : '';
  if (den) den.style.display = (which === 'denied') ? '' : 'none';
}

function switchAccount_() {
  // Force Google to prompt account picker by visiting the logout URL then back
  var here = location.href.split('?')[0];
  location.href = 'https://accounts.google.com/Logout?continue=' + encodeURIComponent(here);
}

function doGoogleLogin() {`);

// Badge bump
patch('Badge V59 → V60', 'dash', `>V59 ✓</span>`, `>V60 ✓</span>`);

proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V60 — approved-users-only allow-list + Access Denied screen — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
