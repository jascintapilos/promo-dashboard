#!/usr/bin/env node
/**
 * V60 — Exclude leadership roles (Team Leader, Manager, etc.) from the
 * Team Utilization view so only individual contributors are tracked.
 *
 * Wai Yip = Promotions Team Leader (real person in Directory, but her
 * stats shouldn't be lumped with the IC team workload analysis).
 *
 * Two filters:
 *   1. Position-based: skip if roster.position contains
 *      "leader|manager|director|head|chief|vp|cto|cfo|ceo".
 *   2. Explicit exclude list (__EXCLUDED_OWNERS_) for any other names
 *      Jascinta wants to hide later.
 */
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID     = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';

const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// ─── Update __isRealPerson_ + add __isLeadership_ + __EXCLUDED_OWNERS_ ───────
const OLD_HELPERS = `// Filter out non-person entries (bot/test/team etc.)
function __isRealPerson_(name) {
  var n = String(name).toLowerCase().trim();
  if (!n) return false;
  if (/^(team|bot|test|testbot|tesbot|promo_testbot|automation|tbd|n\\/a|none|unassigned|–|-|\\?)$/i.test(n)) return false;
  if (/\\bbot\\b|\\btest\\b/i.test(n)) return false;
  if (!/[a-z]/.test(n)) return false;
  return true;
}`;

const NEW_HELPERS = `// Names always hidden from team utilization (leadership / non-IC roles).
// Match is case-insensitive, against either short name or full name.
var __EXCLUDED_OWNERS_ = ['wai yip','kan wai yip','waiyip'];

// Position titles that mark a leadership role (filtered out automatically).
var __LEADERSHIP_RE_ = /\\b(leader|manager|director|head|chief|vp|cto|cfo|ceo|founder|partner)\\b/i;

function __isExcludedOwner_(name, rosterEntry) {
  var lower = String(name || '').toLowerCase().trim();
  for (var i = 0; i < __EXCLUDED_OWNERS_.length; i++) {
    if (lower === __EXCLUDED_OWNERS_[i]) return true;
  }
  if (rosterEntry) {
    var full = String(rosterEntry.fullName || '').toLowerCase();
    var pos  = String(rosterEntry.position || '');
    for (var j = 0; j < __EXCLUDED_OWNERS_.length; j++) {
      if (full === __EXCLUDED_OWNERS_[j]) return true;
    }
    if (pos && __LEADERSHIP_RE_.test(pos)) return true;
  }
  return false;
}

// Filter out non-person entries (bot/test/team etc.)
function __isRealPerson_(name) {
  var n = String(name).toLowerCase().trim();
  if (!n) return false;
  if (/^(team|bot|test|testbot|tesbot|promo_testbot|automation|tbd|n\\/a|none|unassigned|–|-|\\?)$/i.test(n)) return false;
  if (/\\bbot\\b|\\btest\\b/i.test(n)) return false;
  if (!/[a-z]/.test(n)) return false;
  return true;
}`;

if (!dash.includes(OLD_HELPERS)) {
  console.error('✗ __isRealPerson_ anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_HELPERS, NEW_HELPERS);
console.log('✓ Added __EXCLUDED_OWNERS_ list + __isExcludedOwner_ helper');

// ─── Apply exclusion in renderReports_utilization_ filter ───────────────────
const OLD_OWNERS_FILTER = `  var owners = Object.keys(byOwner).filter(function(k){
    if (!__isRealPerson_(k)) return false;
    // If roster is loaded, require a match (otherwise show all real-looking names)
    if (S.roster && S.roster.length) return !!__findInRoster_(k);
    return true;
  }).map(function(k){`;

const NEW_OWNERS_FILTER = `  var owners = Object.keys(byOwner).filter(function(k){
    if (!__isRealPerson_(k)) return false;
    var entry = (S.roster && S.roster.length) ? __findInRoster_(k) : null;
    if (S.roster && S.roster.length && !entry) return false;
    if (__isExcludedOwner_(k, entry)) return false;
    return true;
  }).map(function(k){`;

if (!dash.includes(OLD_OWNERS_FILTER)) {
  console.error('✗ owners filter anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_OWNERS_FILTER, NEW_OWNERS_FILTER);
console.log('✓ Owners filter now also excludes leadership / __EXCLUDED_OWNERS_');

// ─── Also apply exclusion in __utilizationStats_ byOwner loop ───────────────
const OLD_BY_OWNER_FILTER = `      if (typeof __isRealPerson_ === 'function' && !__isRealPerson_(n)) return;
      if (typeof __findInRoster_ === 'function' && S.roster && S.roster.length) {
        var hit = __findInRoster_(n);
        if (!hit) return;
        n = hit.name || n;
      }
      byOwner[n] = (byOwner[n] || 0) + 1;`;

const NEW_BY_OWNER_FILTER = `      if (typeof __isRealPerson_ === 'function' && !__isRealPerson_(n)) return;
      var hit = (typeof __findInRoster_ === 'function' && S.roster && S.roster.length) ? __findInRoster_(n) : null;
      if (S.roster && S.roster.length && !hit) return;
      if (typeof __isExcludedOwner_ === 'function' && __isExcludedOwner_(n, hit)) return;
      if (hit) n = hit.name || n;
      byOwner[n] = (byOwner[n] || 0) + 1;`;

if (dash.includes(OLD_BY_OWNER_FILTER)) {
  dash = dash.replace(OLD_BY_OWNER_FILTER, NEW_BY_OWNER_FILTER);
  console.log('✓ __utilizationStats_ byOwner also excludes leadership');
}

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V60: exclude leadership + Wai Yip from team utilization ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V60: exclude leadership',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nExcluded by name:    wai yip · kan wai yip · waiyip');
console.log('Excluded by role:    anyone whose Position contains leader/manager/director/head/chief/vp/c-suite/founder/partner');
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
