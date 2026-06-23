#!/usr/bin/env node
/**
 * V58 — Guest role sees only the Promo Codes module
 *
 *  Behavior change: when S.user.role === 'guest', skip the guest portal and
 *  show the main dashboard with everything except Promo Codes hidden:
 *    - all sidebar nav-items except "Promo Codes" → display:none
 *    - all nav-section headers → display:none (so there's no MAIN/MANAGE clutter)
 *    - default view forced to 'promos'
 *    - hide the +New Task button and the date-range pill in the header
 *    - hide the Reports sub-list (it lives under Reports anyway)
 *
 *  Side-effects: showGuestPortal() is no longer called from startApp() for
 *  signed-in guests. The original guest portal (the public submission form)
 *  is still reachable via the "Continue as Guest" button on the login screen.
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

// ─── 1. startApp() — replace guest-portal short-circuit with guest UI mode ─
patch('startApp — guest sees promo-only dashboard',
  `function startApp() {
  // Role-gate
  if (S.user.role === 'guest') { showGuestPortal(); return; }

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
  }`,
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
  }`);

// ─── 2. Add the applyGuestUiMode_ helper ───────────────────────────────────
patch('Add applyGuestUiMode_ helper',
  `function doGoogleLogin() {`,
  `function applyGuestUiMode_() {
  // Hide every sidebar item except Promo Codes + all section headers
  document.querySelectorAll('.nav-item').forEach(function(el){
    if (el.dataset.view !== 'promos') el.style.display = 'none';
  });
  document.querySelectorAll('.nav-section').forEach(function(el){ el.style.display = 'none'; });
  // Hide Reports R# sub-list
  var rsub = document.getElementById('nav-reports-sub');
  if (rsub) rsub.style.display = 'none';
  // Hide header chrome that's not relevant for guests
  var dateBtn = document.querySelector('.hdr-date');
  if (dateBtn) dateBtn.style.display = 'none';
  var newTaskBtn = document.querySelector('#header .hdr-btn:not(.notif-btn)');
  if (newTaskBtn) newTaskBtn.style.display = 'none';
  // Force the view to Promo Codes
  setTimeout(function(){ if (typeof nav === 'function') nav('promos'); }, 60);
}

function doGoogleLogin() {`);

// ─── 3. Force renderView to fall back to promos for guests ──────────────────
patch('renderView — guest can only see promos',
  `function renderView(v) {
  const titles = {
    overview:'Overview', tasks:'Task Orchestration', promos:'Promo Codes',`,
  `function renderView(v) {
  if (S.user && S.user.role === 'guest' && v !== 'promos') v = 'promos';
  const titles = {
    overview:'Overview', tasks:'Task Orchestration', promos:'Promo Codes',`);

// Badge bump
patch('Badge V57 → V58', `>V57 ✓</span>`, `>V58 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V58 — guest sees only Promo Codes — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
