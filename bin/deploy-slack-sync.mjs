#!/usr/bin/env node
/**
 * Add Slack sync to the clean dashboard.
 * - Appends Slack helpers + serverSyncSlackTasks to Code.gs
 * - Adds "🔄 Sync from Slack" button + UI to Tasks page in Dashboard.html
 */
import { readFileSync } from 'node:fs';
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
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let code = proj.files[codeIdx].source;
let dash = proj.files[dashIdx].source;

// 1. Append Slack sync snippet to Code.gs
const slackSnippet = readFileSync('tmp/slack-sync-snippet.gs', 'utf8');
if (!code.includes('serverSyncSlackTasks')) {
  code = code.trimEnd() + '\n\n' + slackSnippet;
  console.log('✓ Slack sync helpers appended to Code.gs');
}

// 2. Add "Sync from Slack" button to Tasks page
const oldTasksHdr = `'<div class="card"><div class="card-hdr"><h3>All Tasks (' + tasks.length + ')</h3><span class="hint">From Task_Master sheet</span></div>`;
const newTasksHdr = `'<div class="card"><div class="card-hdr"><h3>All Tasks (' + tasks.length + ')</h3><div style="display:flex;align-items:center;gap:10px"><button class="hdr-btn" onclick="syncSlack()" style="background:#4a154b;font-size:11px;padding:6px 12px">🔄 Sync from Slack</button><span class="hint">From Task_Master sheet</span></div></div>`;
if (dash.includes(oldTasksHdr)) {
  dash = dash.replace(oldTasksHdr, newTasksHdr);
  console.log('✓ Sync button added to Tasks page');
}

// 3. Add syncSlack() function to dashboard JS
const syncFnHook = `// ============================================================================
// PROMO CODES (Request Form)`;
const newSyncFn = `// ============================================================================
// SLACK SYNC
// ============================================================================
function syncSlack() {
  if (typeof google === 'undefined') { toast('Demo: would sync Slack'); return; }
  toast('🔄 Syncing Slack...');
  google.script.run
    .withSuccessHandler(function(r){
      if (r && r.success) {
        var msg = r.added === 0 ? 'No new Slack tasks' : '✓ Added ' + r.added + ' task' + (r.added>1?'s':'') + ' from Slack';
        toast(msg);
        if (r.added > 0) renderTasks();
      } else {
        toast('Error: ' + (r && r.error || 'unknown'));
      }
    })
    .withFailureHandler(function(e){ toast('Slack sync failed: ' + (e && e.message || e)); })
    .serverSyncSlackTasks();
}

// ============================================================================
// PROMO CODES (Request Form)`;
if (dash.includes(syncFnHook) && !dash.includes('function syncSlack')) {
  dash = dash.replace(syncFnHook, newSyncFn);
  console.log('✓ syncSlack() handler added to dashboard');
}

proj.files[codeIdx].source = code;
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed to HEAD');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V31 + Slack sync ' + new Date().toISOString(),
});
console.log('✓ Version ' + v.versionNumber + ' created');

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Slack sync' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
