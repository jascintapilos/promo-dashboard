#!/usr/bin/env node
/**
 * V70b — Fix the two roster helpers that missed anchors in V70:
 *   • Add rosterNames_() + refreshOwnerDropdowns_() helpers (the dashboard
 *     calls refreshOwnerDropdowns_ on boot, so they must exist).
 *   • Rewrite getOwnerOptions_() to use the live roster as primary source.
 *   • Strip the stale fallback `S.tasks` block at the tail of populateOwnerFilter_().
 *
 * Then bump version + auto-promote.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';
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

// 1. Replace getOwnerOptions_() body to use rosterNames_ (and add the
//    rosterNames_ + refreshOwnerDropdowns_ helpers above it).
patch('Add rosterNames_ + refreshOwnerDropdowns_ + rewrite getOwnerOptions_',
  `// ── Owner roster helper (drives Edit-Task datalist) ──────────────────────────
function getOwnerOptions_() {
  var seed = ['Jascinta Pilos','Wai Yip','Sarah P.','Karan T.','Daniel P.','Mimi','Lexa','jascinta.pilos@thebrandingpeople.co','waiyip@thebrandingpeople.co'];
  var live = (window.S && Array.isArray(window.S.tasks))
    ? window.S.tasks.map(function(t){return String(t.Owner||'').trim();}).filter(Boolean)
    : [];
  var seen = {}, out = [];
  seed.concat(live).forEach(function(v){
    var k = v.toLowerCase();
    if (v && !seen[k]) { seen[k] = true; out.push(v); }
  });
  return out.sort();
}`,
  `// ── Roster helpers (single source of truth: S.roster from Directory) ────────
function rosterNames_() {
  if (typeof window === 'undefined' || !window.S || !Array.isArray(window.S.roster)) return [];
  return window.S.roster.map(function(r){ return String(r && r.name || '').trim(); }).filter(Boolean);
}

function refreshOwnerDropdowns_() {
  var names = rosterNames_();
  // Tasks page filter dropdown
  var sel = document.getElementById('task-owner');
  if (sel) {
    var cur = sel.value || '';
    sel.innerHTML = '<option value="">All members</option>' +
      names.slice().sort().map(function(o){return '<option value="' + o + '">' + o + '</option>';}).join('');
    if (cur && names.indexOf(cur) >= 0) sel.value = cur;
  }
  // Edit-Task modal datalist if open
  var dl = document.getElementById('t-owner-list');
  if (dl) dl.innerHTML = names.map(function(o){return '<option value="'+o+'">';}).join('');
}

// ── Owner options for Edit-Task datalist (sources from Directory roster) ────
function getOwnerOptions_() {
  var fromRoster = rosterNames_();
  if (fromRoster.length) return fromRoster.slice().sort();
  // Fallback: use whatever owners are present on existing tasks
  var live = (window.S && Array.isArray(window.S.tasks))
    ? window.S.tasks.map(function(t){return String(t.Owner||'').trim();}).filter(Boolean)
    : [];
  var seen = {}, out = [];
  live.forEach(function(v){
    var k = v.toLowerCase();
    if (v && !seen[k]) { seen[k] = true; out.push(v); }
  });
  return out.sort();
}`);

// 2. Strip the duplicated old populateOwnerFilter_ tail (lines 1166-1175 of
//    pre-patch state) so populateOwnerFilter_ no longer re-builds owners from
//    S.tasks after we already filled `names` from roster.
patch('Strip stale populateOwnerFilter_ tail',
  `    names = Object.keys(seen);
  }
  var sel = document.getElementById('task-owner');
  if (!sel || !S.tasks) return;
  var cur = sel.value;
  var owners = S.tasks.map(function(t){return t.Owner||'';})
    .filter(function(v,i,a){return v && a.indexOf(v) === i;})
    .sort();
  sel.innerHTML = '<option value="">All members</option>' +
    owners.map(function(o){return '<option value="' + o + '">' + o + '</option>';}).join('');
  if (cur && owners.indexOf(cur) >= 0) sel.value = cur;
}`,
  `    names = Object.keys(seen);
  }
  var sel = document.getElementById('task-owner');
  if (!sel) return;
  var cur = sel.value;
  var sorted = names.slice().sort();
  sel.innerHTML = '<option value="">All members</option>' +
    sorted.map(function(o){return '<option value="' + o + '">' + o + '</option>';}).join('');
  if (cur && sorted.indexOf(cur) >= 0) sel.value = cur;
}`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

if (fail > 0) {
  console.error('❌ Some patches missed their anchors — aborting version bump');
  process.exit(1);
}

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V70 (b) — Roster helpers + dynamic Create-New + KB + remove Progress — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'Promoted V' + v.versionNumber + ' via API — ' + new Date().toISOString(),
  },
});
console.log(`✓ Promoted live: V${promo.deploymentConfig.versionNumber}`);
