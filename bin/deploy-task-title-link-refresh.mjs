#!/usr/bin/env node
/**
 * Two fixes on Tasks page:
 * 1. Title becomes a clickable link to Source_Link (Slack thread URL) when present.
 * 2. Add refresh button + auto-refresh every 60s while Tasks page is visible.
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

// 1. Title cell — wrap in <a href> when Source_Link exists
const oldTitleCell = `'<td style="font-weight:500;max-width:260px">' + esc(t.Title || '—') + '</td>' +`;
const newTitleCell = `'<td style="font-weight:500;max-width:260px">' + (t.Source_Link ? '<a href="' + esc(t.Source_Link) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--muted)">' + esc(t.Title || '—') + ' <span style="font-size:10px;color:var(--muted)">↗</span></a>' : esc(t.Title || '—')) + '</td>' +`;

let count = 0;
while (dash.includes(oldTitleCell)) {
  dash = dash.replace(oldTitleCell, newTitleCell);
  count++;
  if (count > 5) break; // safety
}
console.log('✓ Title cells linked to Source_Link in', count, 'place(s)');

// 2. Add refresh button to Tasks header
const oldTasksHdr = `'<div class="card"><div class="card-hdr"><h3>All Tasks (' + tasks.length + ')</h3><div style="display:flex;align-items:center;gap:10px"><button class="hdr-btn" onclick="syncSlack()" style="background:#4a154b;font-size:11px;padding:6px 12px">🔄 Sync from Slack</button><span class="hint">Click column to sort</span></div></div>`;
const newTasksHdr = `'<div class="card"><div class="card-hdr"><h3>All Tasks (' + tasks.length + ')</h3><div style="display:flex;align-items:center;gap:10px"><button class="hdr-btn" onclick="renderTasks()" style="background:var(--card2);border:1px solid var(--border);color:var(--text);font-size:11px;padding:6px 12px">↻ Refresh</button><button class="hdr-btn" onclick="syncSlack()" style="background:#4a154b;font-size:11px;padding:6px 12px">🔄 Sync from Slack</button><span class="hint">Auto-refresh: 60s</span></div></div>`;

if (dash.includes(oldTasksHdr)) {
  dash = dash.replace(oldTasksHdr, newTasksHdr);
  console.log('✓ Refresh button added to Tasks header');
}

// 3. Auto-refresh every 60s while Tasks view is active
// Modify nav() to clear/start auto-refresh timer
const oldNavFn = `function nav(view) {
  S.view = view;
  document.querySelectorAll('.nav-item').forEach(function(el){
    el.classList.toggle('active', el.dataset.view === view);
  });`;

const newNavFn = `function nav(view) {
  S.view = view;
  document.querySelectorAll('.nav-item').forEach(function(el){
    el.classList.toggle('active', el.dataset.view === view);
  });
  // Auto-refresh on Tasks view
  if (window.__taskRefreshTimer) { clearInterval(window.__taskRefreshTimer); window.__taskRefreshTimer = null; }
  if (view === 'tasks') {
    window.__taskRefreshTimer = setInterval(function(){
      if (S.view === 'tasks' && document.visibilityState === 'visible') {
        if (typeof google === 'undefined') return;
        google.script.run.withSuccessHandler(function(t){
          S.tasks = t || [];
          // Re-render only if data changed (avoid scroll jump)
          var sig = (t || []).map(function(x){return x.Task_ID;}).join('|');
          if (sig !== window.__lastTaskSig) {
            window.__lastTaskSig = sig;
            renderTasksData(S.tasks);
          }
        }).serverGetTasks();
      }
    }, 60000);
  }`;

if (dash.includes(oldNavFn) && !dash.includes('__taskRefreshTimer')) {
  dash = dash.replace(oldNavFn, newNavFn);
  console.log('✓ Tasks page auto-refreshes every 60s when visible');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V38 + Title→Source_Link + auto-refresh ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Title link + refresh' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
