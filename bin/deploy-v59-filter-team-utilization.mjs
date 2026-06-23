#!/usr/bin/env node
/**
 * V59 — Team Utilization: filter to real roster members + show data source.
 *
 *   • Cross-references Owner column from Task_Master against S.roster
 *     (loaded from Directory sheet → "Team Contact Details" tab).
 *   • Only owners present in the roster are displayed; "team", "Testbot",
 *     "Tesbot", "test", "bot" etc. are filtered out.
 *   • Team label comes from roster.position (e.g. "Promo Specialist")
 *     instead of inferring from dominant module.
 *   • Adds a small data-source footnote inside the Team Utilization card.
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

// ─── 1. Add helper: lookup in roster + filter non-people ─────────────────────
const HELPER_ANCHOR = `function __teamLabel_(modulesMap) {`;

const HELPER_BLOCK = `// Returns the roster entry for a name (case-insensitive, fuzzy first-name match)
function __findInRoster_(name) {
  if (!S.roster || !S.roster.length) return null;
  var lower = String(name).toLowerCase().trim();
  if (!lower) return null;
  // 1. Exact name or fullName match
  var hit = S.roster.find(function(r){
    var a = String(r.name || '').toLowerCase();
    var b = String(r.fullName || '').toLowerCase();
    return a === lower || b === lower;
  });
  if (hit) return hit;
  // 2. First-name match (e.g. "Wen" → "Wen Tan")
  hit = S.roster.find(function(r){
    var b = String(r.fullName || r.name || '').toLowerCase();
    return b.split(/\\s+/)[0] === lower || b.indexOf(lower) === 0;
  });
  return hit || null;
}

// Filter out non-person entries (bot/test/team etc.)
function __isRealPerson_(name) {
  var n = String(name).toLowerCase().trim();
  if (!n) return false;
  if (/^(team|bot|test|testbot|tesbot|promo_testbot|automation|tbd|n\\/a|none|unassigned|–|-|\\?)$/i.test(n)) return false;
  if (/\\bbot\\b|\\btest\\b/i.test(n)) return false;
  if (!/[a-z]/.test(n)) return false;
  return true;
}

`;

if (!dash.includes(HELPER_ANCHOR)) {
  console.error('✗ __teamLabel_ anchor not found');
  process.exit(1);
}
if (!dash.includes('function __findInRoster_')) {
  dash = dash.replace(HELPER_ANCHOR, HELPER_BLOCK + HELPER_ANCHOR);
  console.log('✓ Added __findInRoster_ + __isRealPerson_ helpers');
}

// ─── 2. Filter owners in renderReports_utilization_ ─────────────────────────
const OLD_OWNERS_BUILD = `  var owners = Object.keys(byOwner).map(function(k){
    var o = byOwner[k];
    var logged = Math.round(o.count * HOURS_PER_TASK * 10) / 10;
    var prevLogged = o.prevCount * HOURS_PER_TASK;
    var util = capacityPerOwner > 0 ? Math.round(logged / capacityPerOwner * 100) : 0;
    var workload = util >= 70 ? 'High' : util >= 40 ? 'Medium' : 'Low';
    var delta = __delta_(logged, prevLogged);
    return {
      name: o.name,
      team: __teamLabel_(o.modules),
      tasks: o.count,
      logged: logged,
      capacity: capacityPerOwner,
      utilization: Math.min(100, util),
      workload: workload,
      delta: delta,
      modules: o.modules,
    };
  }).sort(function(a,b){ return b.utilization - a.utilization; });`;

const NEW_OWNERS_BUILD = `  var owners = Object.keys(byOwner).filter(function(k){
    if (!__isRealPerson_(k)) return false;
    // If roster is loaded, require a match (otherwise show all real-looking names)
    if (S.roster && S.roster.length) return !!__findInRoster_(k);
    return true;
  }).map(function(k){
    var o = byOwner[k];
    var logged = Math.round(o.count * HOURS_PER_TASK * 10) / 10;
    var prevLogged = o.prevCount * HOURS_PER_TASK;
    var util = capacityPerOwner > 0 ? Math.round(logged / capacityPerOwner * 100) : 0;
    var workload = util >= 70 ? 'High' : util >= 40 ? 'Medium' : 'Low';
    var delta = __delta_(logged, prevLogged);
    var rosterEntry = __findInRoster_(o.name);
    var teamLabel = (rosterEntry && rosterEntry.position) ? rosterEntry.position
                  : (rosterEntry && rosterEntry.fullName && rosterEntry.fullName !== o.name) ? rosterEntry.fullName
                  : __teamLabel_(o.modules);
    var displayName = (rosterEntry && rosterEntry.name) ? rosterEntry.name : o.name;
    return {
      name: displayName,
      team: teamLabel,
      tasks: o.count,
      logged: logged,
      capacity: capacityPerOwner,
      utilization: Math.min(100, util),
      workload: workload,
      delta: delta,
      modules: o.modules,
    };
  }).sort(function(a,b){ return b.utilization - a.utilization; });`;

if (!dash.includes(OLD_OWNERS_BUILD)) {
  console.error('✗ owners build anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_OWNERS_BUILD, NEW_OWNERS_BUILD);
console.log('✓ Owners filtered to real roster members + use roster.position as team label');

// ─── 3. Also clean up the compact utilization card's "Top Owners" list ──────
// __utilizationStats_ doesn't currently filter; the compact card uses
// u.byOwner directly. Filter there too.
const OLD_BY_OWNER_LOOP = `  // By owner
  var byOwner = {};
  tasks.forEach(function(t){
    var raw = String(t.Owner || '');
    if (!raw) return;
    var name = typeof resolveOwnerNames_==='function' ? resolveOwnerNames_(raw) : raw;
    // Split compound owners
    name.split(/\\s*\\+\\s*/).forEach(function(n){
      n = n.trim();
      if (n) byOwner[n] = (byOwner[n] || 0) + 1;
    });
  });`;

const NEW_BY_OWNER_LOOP = `  // By owner — filter to real roster members only
  var byOwner = {};
  tasks.forEach(function(t){
    var raw = String(t.Owner || '');
    if (!raw) return;
    var name = typeof resolveOwnerNames_==='function' ? resolveOwnerNames_(raw) : raw;
    name.split(/\\s*\\+\\s*/).forEach(function(n){
      n = n.trim();
      if (!n) return;
      if (typeof __isRealPerson_ === 'function' && !__isRealPerson_(n)) return;
      if (typeof __findInRoster_ === 'function' && S.roster && S.roster.length) {
        var hit = __findInRoster_(n);
        if (!hit) return;
        n = hit.name || n;
      }
      byOwner[n] = (byOwner[n] || 0) + 1;
    });
  });`;

if (dash.includes(OLD_BY_OWNER_LOOP)) {
  dash = dash.replace(OLD_BY_OWNER_LOOP, NEW_BY_OWNER_LOOP);
  console.log('✓ __utilizationStats_ byOwner also filtered to roster');
}

// ─── 4. Add a small data-source footnote inside Team Utilization card ───────
const OLD_TEAM_HDR = `'<div style="padding:14px 16px;border-bottom:1px solid var(--border)">'
      +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Team Utilization</div>'
    +'</div>'`;

const NEW_TEAM_HDR = `'<div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'
      +'<div><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Team Utilization</div><div style="font-size:10px;color:var(--muted);margin-top:2px">Owner column in Task_Master × Directory roster · hours = tasks × 1.5h estimate</div></div>'
      +'<div style="font-size:10px;color:var(--muted)">' + owners.length + ' member' + (owners.length===1?'':'s') + '</div>'
    +'</div>'`;

if (dash.includes(OLD_TEAM_HDR)) {
  dash = dash.replace(OLD_TEAM_HDR, NEW_TEAM_HDR);
  console.log('✓ Team Utilization header now shows data source + member count');
}

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V59: filter Team Utilization to real roster members ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V59: roster filter',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
