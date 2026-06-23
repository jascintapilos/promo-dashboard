#!/usr/bin/env node
/**
 * V67 — Fix Utilization tab crash: undefined `tasks` reference.
 *
 *   V61 stripped `var tasks = __tasksInRange_()` from the function body,
 *   but left a downstream line that still uses `tasks`:
 *     tasks.forEach(function(t){ var m = t.Module || 'Other'; byModule[m]++ })
 *   This throws ReferenceError → entire utilization view fails to render
 *   → tab click "doesn't work".
 *
 *   Fix: declare `tasks` at the start of the function (same as we
 *   declared `prev` and `prevTasks` in V63).
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

// Add `var tasks = __tasksInRange_()` next to the existing prev/prevTasks block
const OLD = `  // V63: restore prev/prevTasks (removed in V61 by accident, broke util tab)
  var prev = __rptPrevPeriod_();
  var prevTasks = (S.tasks || []).filter(function(t){
    var d = String(t.Submitted_At || t.Assigned_At || t.Created_At || '').slice(0,10);
    return d && d >= prev.from && d <= prev.to;
  });`;

const NEW = `  // V63: restore prev/prevTasks (removed in V61 by accident, broke util tab)
  var prev = __rptPrevPeriod_();
  var prevTasks = (S.tasks || []).filter(function(t){
    var d = String(t.Submitted_At || t.Assigned_At || t.Created_At || '').slice(0,10);
    return d && d >= prev.from && d <= prev.to;
  });
  // V67: also restore tasks (used by byModule loop below) — same fix
  var tasks = __tasksInRange_();`;

if (!dash.includes(OLD)) {
  console.error('✗ V63 anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD, NEW);
console.log('✓ var tasks = __tasksInRange_() added at top of renderReports_utilization_');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V67: fix renderReports_utilization_ undefined `tasks` reference ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V67: util crash fix',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
