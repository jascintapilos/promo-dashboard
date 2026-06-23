#!/usr/bin/env node
/**
 * V65 — Auto-refresh filter dates after sync loads new data.
 *
 *   Bug: __rptFilter has hardcoded from/to ('2026-05-11' → '2026-05-18').
 *   After Sync brings new weeks (W20, W21) into the cache, __RPT_DATA
 *   gets updated but the filter dates stay frozen, so the dashboard
 *   keeps showing the old W19 range.
 *
 *   Fix: in renderReports success handler, after replacing __RPT_DATA,
 *   re-apply the current preset so date-relative presets (thisWeek,
 *   lastWeek, last4w, etc.) re-compute their dates against the latest
 *   __RPT_DATA.weeks array.
 *
 *   Also: show a "Last synced N min ago" pill in the header so the
 *   user has explicit confirmation the cache is fresh.
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

// ─── 1. renderReports — refresh filter after data load ─────────────────────
const OLD_HANDLER = `    google.script.run
      .withSuccessHandler(function(d){
        if (d && d.weeks && d.weeks.length) { __RPT_DATA.weeks = d.weeks; __rptSyncedAt = d.syncedAt; }
        renderReports_analysis_();
      })
      .withFailureHandler(function(){ renderReports_analysis_(); })
      .serverGetWeeklyReportData();`;

const NEW_HANDLER = `    google.script.run
      .withSuccessHandler(function(d){
        if (d && d.weeks && d.weeks.length) {
          __RPT_DATA.weeks = d.weeks;
          __rptSyncedAt = d.syncedAt;
          // V65: auto-refresh date-relative presets so they pick up newest week
          var relPresets = ['thisWeek','lastWeek','today','yesterday','thisMonth','lastMonth','last1w','last4w','last8w','all','q1','q2'];
          if (relPresets.indexOf(__rptFilter.preset) >= 0) {
            __rptApplyPreset_(__rptFilter.preset);
            return; // applyPreset already re-renders
          }
        }
        renderReports_analysis_();
      })
      .withFailureHandler(function(){ renderReports_analysis_(); })
      .serverGetWeeklyReportData();`;

if (!dash.includes(OLD_HANDLER)) {
  console.error('✗ Weekly success handler anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_HANDLER, NEW_HANDLER);
console.log('✓ renderReports: filter dates auto-refresh after sync data loads');

// ─── 2. Show "last sync N min ago" pill in header ───────────────────────────
const OLD_SYNCED_DIV = `+'<div style="font-size:10px;color:var(--muted);margin-right:6px">'+(__rptSyncedAt ? '🕒 Synced ' + __formatMY_(__rptSyncedAt) : '⚠ Using cached data — click Sync')+'</div>'`;

const NEW_SYNCED_DIV = `+'<div style="font-size:10px;color:var(--muted);margin-right:6px">'+(__rptSyncedAt ? '🕒 Synced ' + __formatMY_(__rptSyncedAt) + ' · ' + __syncAgo_(__rptSyncedAt) : '⚠ Using cached data — click Sync')+'</div>'`;

if (dash.includes(OLD_SYNCED_DIV)) {
  dash = dash.replace(OLD_SYNCED_DIV, NEW_SYNCED_DIV);
  console.log('✓ Synced label now shows relative age');
}

// ─── 3. Add __syncAgo_ helper ───────────────────────────────────────────────
const ANCHOR_HELPER = `function __formatMYDate_(`;
const HELPER_FN = `function __syncAgo_(isoString) {
  if (!isoString) return '';
  var diff = Date.now() - new Date(isoString).getTime();
  var mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  var hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.round(hrs / 24);
  return days + 'd ago';
}

function __formatMYDate_(`;

if (!dash.includes('function __syncAgo_')) {
  dash = dash.replace(ANCHOR_HELPER, HELPER_FN);
  console.log('✓ Added __syncAgo_ helper');
}

// ─── 4. Add a small debug strip below sync banner showing what's loaded ─────
// In renderReports_analysis_, add a tiny line after the sync banner showing
// "N weeks in cache · filter covers W## – W##"
const OLD_CONTENT = `  content(
    __rptHeader_(weeks, prev)
    + __rptTabBar_('analysis')
    + __rptSyncBanner_()
    + __rptFilterBar_(weeks)`;

const NEW_CONTENT = `  // V65: small debug strip — confirms what's in cache + what's in filter
  var debugStrip = '<div style="font-size:10px;color:var(--muted);padding:6px 10px;margin-bottom:8px;background:rgba(255,255,255,.02);border-radius:4px;display:flex;justify-content:space-between"><span>📦 Cache: <strong>'+(__RPT_DATA.weeks?__RPT_DATA.weeks.length:0)+'</strong> weeks · '+(__WORK_HOURS_DATA && __WORK_HOURS_DATA.people ? Object.keys(__WORK_HOURS_DATA.people).length : 0)+' work-hours trackers</span><span>🔎 Filter: <strong>'+(weeks.length?weeks[0].w:'–')+' → '+(weeks.length?weeks[weeks.length-1].w:'–')+'</strong> ('+__rptFilter.from+' to '+__rptFilter.to+')</span></div>';

  content(
    __rptHeader_(weeks, prev)
    + __rptTabBar_('analysis')
    + __rptSyncBanner_()
    + debugStrip
    + __rptFilterBar_(weeks)`;

if (!dash.includes(OLD_CONTENT)) {
  console.error('✗ analysis content anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_CONTENT, NEW_CONTENT);
console.log('✓ Added cache + filter debug strip to analysis view');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V65: auto-refresh filter after sync + debug strip ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V65: filter refresh',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
