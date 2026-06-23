#!/usr/bin/env node
/**
 * V32: ensure date pill works via capture-phase listener,
 * and add a visible "v32 ready" mark for verification.
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

// Replace the date-pill binding code with a capture-phase delegator
const oldBind = `  // Bind click on .hdr-date
  function bindDatePill() {
    var pill = document.querySelector('.hdr-date');
    if (pill && !pill.dataset.popBound) {
      pill.onclick = openDatePop;
      pill.dataset.popBound = '1';
    }
  }
  bindDatePill();
  setInterval(bindDatePill, 1500);`;

const newBind = `  // Capture-phase delegator: handles re-renders too
  document.addEventListener('click', function(e) {
    if (!e.target || !e.target.closest) return;
    var hit = e.target.closest('.hdr-date');
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      openDatePop();
    }
  }, true);
  // Visible diagnostic
  setTimeout(function() {
    var t = document.querySelector('.hdr-title h1');
    if (t && !t.dataset.v32marked) {
      t.dataset.v32marked = '1';
      t.insertAdjacentHTML('beforeend', '<span style="font-size:10px;color:#4cbfff;margin-left:8px;padding:2px 6px;background:rgba(76,191,255,0.1);border-radius:8px">V32</span>');
    }
  }, 1500);`;

if (dash.includes(oldBind)) {
  dash = dash.replace(oldBind, newBind);
  console.log('Patched date-pill binding to capture-phase delegator + added V32 marker');
} else {
  console.log('Old bindDatePill pattern not found verbatim — diff may be needed');
  // Search for bindDatePill anywhere
  const idx = dash.indexOf('bindDatePill');
  if (idx >= 0) console.log('Found bindDatePill at index', idx);
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V32: date pill capture-phase + V32 marker — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
