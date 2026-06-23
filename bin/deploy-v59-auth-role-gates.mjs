#!/usr/bin/env node
/**
 * V59 — Force login + role-gate sidebar sections
 *
 *  1. Login required — the login overlay stays visible until
 *     serverGetCurrentUser returns a non-guest role. Guests / unauthenticated
 *     users never see the dashboard at all; they're held on the login screen.
 *     (The "Continue as Guest" button still works for external request
 *     submission via showGuestPortal().)
 *
 *  2. Sidebar role gates — for everyone except admins, hide the entire
 *     MANAGE section (Approvals / CRM / Calendar) and ANALYTICS section
 *     (Performance / Reports + R1–R10 sub-list). Regular team members see
 *     only MAIN. Admins still see everything.
 *
 *  3. Tag each nav-section header with an id (#nav-sec-main / -manage /
 *     -analytics / -system) so JS can hide them cleanly. Also adds
 *     data-section="..." to each nav-item so JS can sweep them together.
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

// ─── 1. Tag nav sections + items with ids/data-section ──────────────────────
patch('Tag sidebar sections + items',
  `    <nav id="nav">
      <div class="nav-section">Main</div>
      <div class="nav-item active" data-view="overview" onclick="nav('overview')"><span class="nav-icon">🏠</span>Overview</div>
      <div class="nav-item" data-view="tasks" onclick="nav('tasks')"><span class="nav-icon">✅</span>Task Orchestration<span class="badge" id="badge-tasks" style="display:none">0</span></div>
      <div class="nav-item" data-view="promos" onclick="nav('promos')"><span class="nav-icon">🎯</span>Promo Codes</div>
      <div class="nav-item" data-view="banners" onclick="nav('banners')"><span class="nav-icon">🖼</span>Banners</div>
      <div class="nav-section">Manage</div>
      <div class="nav-item" data-view="approvals" onclick="nav('approvals')"><span class="nav-icon">✍</span>Approvals</div>
      <div class="nav-item" data-view="crm" onclick="nav('crm')"><span class="nav-icon">📨</span>CRM / Comms</div>
      <div class="nav-item" data-view="calendar" onclick="nav('calendar')"><span class="nav-icon">📅</span>Calendar</div>
      <div class="nav-section">Analytics</div>
      <div class="nav-item" data-view="performance" onclick="nav('performance')"><span class="nav-icon">📈</span>Performance</div>
      <div class="nav-item nav-item-expandable" data-view="reports" onclick="nav('reports')" id="nav-reports">`,
  `    <nav id="nav">
      <div class="nav-section" id="nav-sec-main">Main</div>
      <div class="nav-item active" data-view="overview" data-section="main" onclick="nav('overview')"><span class="nav-icon">🏠</span>Overview</div>
      <div class="nav-item" data-view="tasks" data-section="main" onclick="nav('tasks')"><span class="nav-icon">✅</span>Task Orchestration<span class="badge" id="badge-tasks" style="display:none">0</span></div>
      <div class="nav-item" data-view="promos" data-section="main" onclick="nav('promos')"><span class="nav-icon">🎯</span>Promo Codes</div>
      <div class="nav-item" data-view="banners" data-section="main" onclick="nav('banners')"><span class="nav-icon">🖼</span>Banners</div>
      <div class="nav-section" id="nav-sec-manage">Manage</div>
      <div class="nav-item" data-view="approvals" data-section="manage" onclick="nav('approvals')"><span class="nav-icon">✍</span>Approvals</div>
      <div class="nav-item" data-view="crm" data-section="manage" onclick="nav('crm')"><span class="nav-icon">📨</span>CRM / Comms</div>
      <div class="nav-item" data-view="calendar" data-section="manage" onclick="nav('calendar')"><span class="nav-icon">📅</span>Calendar</div>
      <div class="nav-section" id="nav-sec-analytics">Analytics</div>
      <div class="nav-item" data-view="performance" data-section="analytics" onclick="nav('performance')"><span class="nav-icon">📈</span>Performance</div>
      <div class="nav-item nav-item-expandable" data-view="reports" data-section="analytics" onclick="nav('reports')" id="nav-reports">`);

patch('Tag System section header',
  `      <div class="nav-section">System</div>
      <div class="nav-item" data-view="settings" onclick="nav('settings')" id="nav-settings"><span class="nav-icon">⚙</span>Settings</div>`,
  `      <div class="nav-section" id="nav-sec-system">System</div>
      <div class="nav-item" data-view="settings" data-section="system" onclick="nav('settings')" id="nav-settings"><span class="nav-icon">⚙</span>Settings</div>`);

// ─── 2. Enforce login + apply role gates in startApp ─────────────────────────
patch('startApp — force login + role-gate Manage/Analytics',
  `function startApp() {
  // Hide login, show app
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('bot-fab').style.display = 'flex';

  // Populate user info
  document.getElementById('sb-name').textContent   = S.user.display;
  document.getElementById('sb-role').textContent   = S.user.role;
  document.getElementById('sb-avatar').textContent = S.user.display.charAt(0).toUpperCase();

  // Hide settings for non-admin
  if (S.user.role !== 'admin') {
    const s = document.getElementById('nav-settings');
    if (s) s.style.display = 'none';
  }

  // ── Guest mode: only Promo Codes section is accessible ─────────────────
  if (S.user.role === 'guest') {
    applyGuestUiMode_();
  }`,
  `function startApp() {
  // ── Auth gate: unauthenticated users see only the login screen ─────────
  if (!S.user || S.user.role === 'guest' || !S.user.email) {
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('bot-fab').style.display = 'none';
    return;
  }

  // Hide login, show app
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('bot-fab').style.display = 'flex';

  // Populate user info
  document.getElementById('sb-name').textContent   = S.user.display;
  document.getElementById('sb-role').textContent   = S.user.role;
  document.getElementById('sb-avatar').textContent = S.user.display.charAt(0).toUpperCase();

  // ── Role-gate sidebar sections ──────────────────────────────────────────
  // Non-admin: hide Manage + Analytics (and their items). Admin sees all.
  if (S.user.role !== 'admin') {
    ['manage', 'analytics'].forEach(function(sec) {
      var hdr = document.getElementById('nav-sec-' + sec);
      if (hdr) hdr.style.display = 'none';
      document.querySelectorAll('.nav-item[data-section="' + sec + '"]').forEach(function(el){ el.style.display = 'none'; });
    });
    var rsub = document.getElementById('nav-reports-sub');
    if (rsub) rsub.style.display = 'none';
    var s = document.getElementById('nav-settings');
    if (s) s.style.display = 'none';
  }`);

// ─── 3. Also hide login overlay logic in the init / fallback path ───────────
patch('init fallback — keep login overlay for failed auth',
  `  google.script.run
    .withSuccessHandler(u => { S.user = u; startApp(); })
    .withFailureHandler(() => { S.user = { email:'', role:'guest', display:'Guest' }; startApp(); })
    .serverGetCurrentUser();
})();`,
  `  // Show login overlay by default until auth resolves
  var lo = document.getElementById('login-overlay');
  if (lo) lo.style.display = 'flex';
  google.script.run
    .withSuccessHandler(u => {
      S.user = u && u.email ? u : { email:'', role:'guest', display:'Guest' };
      startApp();
    })
    .withFailureHandler(() => { S.user = { email:'', role:'guest', display:'Guest' }; startApp(); })
    .serverGetCurrentUser();
})();`);

// ─── 4. Drop the guest-mode-shows-promos-only branch (V58) — replaced by full gate
patch('Remove V58 guest-promos-only branch (superseded by hard login gate)',
  `  // Hide settings for non-admin
  if (S.user.role !== 'admin') {
    const s = document.getElementById('nav-settings');
    if (s) s.style.display = 'none';
  }

  // ── Guest mode: only Promo Codes section is accessible ─────────────────
  if (S.user.role === 'guest') {
    applyGuestUiMode_();
  }`,
  ``);  // The V59 startApp already gates guests out, so this branch is dead.

// Badge bump
patch('Badge V58 → V59', `>V58 ✓</span>`, `>V59 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V59 — force login + hide Manage/Analytics for non-admin — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
