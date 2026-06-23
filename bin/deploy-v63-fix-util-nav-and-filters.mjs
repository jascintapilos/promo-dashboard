#!/usr/bin/env node
/**
 * V63 — Three fixes:
 *   1. Fix renderReports_utilization_ crash: V61 removed `prev` and
 *      `prevTasks` from the function scope but other lines still reference
 *      them, throwing ReferenceError → buttons click but page never
 *      navigates. Re-declare them at the top.
 *   2. Delete "ADDITIONAL FILTERS" and "SAVED FILTERS" sections from
 *      the Filters card (per user request).
 *   3. Reduce "Filters" title font-size from 20px → 14px (smaller, less
 *      shouty).
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

// ─── 1. Fix renderReports_utilization_ — restore prev + prevTasks ────────────
const OLD_UTIL_TOP = `function renderReports_utilization_() {
  __rptTab = 'utilization';

  var HOURS_PER_TASK = 1.5;
  var WEEKLY_CAPACITY = 40;
  var weeks = Math.max(1, __rptFilteredWeeks_().length);
  var capacityPerOwner = weeks * WEEKLY_CAPACITY;

  // V61: Owners come from Work Hours Tracker data (via __utilizationStats_)`;

const NEW_UTIL_TOP = `function renderReports_utilization_() {
  __rptTab = 'utilization';

  var HOURS_PER_TASK = 1.5;
  var WEEKLY_CAPACITY = 40;
  var weeks = Math.max(1, __rptFilteredWeeks_().length);
  var capacityPerOwner = weeks * WEEKLY_CAPACITY;

  // V63: restore prev/prevTasks (removed in V61 by accident, broke util tab)
  var prev = __rptPrevPeriod_();
  var prevTasks = (S.tasks || []).filter(function(t){
    var d = String(t.Submitted_At || t.Assigned_At || t.Created_At || '').slice(0,10);
    return d && d >= prev.from && d <= prev.to;
  });

  // V61: Owners come from Work Hours Tracker data (via __utilizationStats_)`;

if (!dash.includes(OLD_UTIL_TOP)) {
  console.error('✗ renderReports_utilization_ top anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_UTIL_TOP, NEW_UTIL_TOP);
console.log('✓ renderReports_utilization_: prev + prevTasks restored');

// ─── 2. Delete Additional Filters + Saved Filters sections ──────────────────
const OLD_ADDITIONAL_BLOCK = `    // ── Additional Filters (collapsible placeholder) ──
    +'<div style="margin-bottom:18px">'
      +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Additional Filters</div>'
      +'<div onclick="__rptToggleAdvFilters_()" style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:border-color .15s" onmouseover="this.style.borderColor=\\'#7c3aed\\'" onmouseout="this.style.borderColor=\\'var(--border)\\'">'
        +'<span style="font-size:18px;color:#a78bfa">🔽</span>'
        +'<div style="flex:1">'
          +'<div style="font-size:13px;color:var(--text);font-weight:600">Show additional filters</div>'
          +'<div style="font-size:11px;color:var(--muted);margin-top:2px">Project, Owner, Status, Priority, Department and more</div>'
        +'</div>'
        +'<span style="color:var(--muted);font-size:14px">▾</span>'
      +'</div>'
    +'</div>'

    // ── Saved Filters ──
    +'<div>'
      +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Saved Filters</div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">'
        +savedCard('🔖','My Default View',defaultCount,"__rptApplyPreset_('all')",false)
        +savedCard('🔖','Promo Team View',promoCount,"__rptToggleAdvFilters_()",false)
        +savedCard('🔖','Overdue Tasks',overdueCount,"nav('tasks')",false)
        +savedCard('🔖','High Priority Tasks',highPriCount,"nav('tasks')",false)
        +savedCard('','New Preset',0,"__rptSavePreset_()",true)
      +'</div>'
    +'</div>'

  +'</div>';
}`;

const NEW_ENDING = `  +'</div>';
}`;

if (!dash.includes(OLD_ADDITIONAL_BLOCK)) {
  console.error('✗ Additional/Saved Filters block anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_ADDITIONAL_BLOCK, NEW_ENDING);
console.log('✓ ADDITIONAL FILTERS and SAVED FILTERS sections removed');

// ─── 3. Reduce "Filters" title font-size: 20px → 14px ───────────────────────
const OLD_TITLE = `'<div style="font-size:20px;font-weight:800;color:var(--text);letter-spacing:.01em">Filters</div>'
          +'<div style="font-size:12px;color:var(--muted);margin-top:2px">Refine your data and view insights that matter</div>'`;

const NEW_TITLE = `'<div style="font-size:14px;font-weight:700;color:var(--text);letter-spacing:.01em">Filters</div>'
          +'<div style="font-size:11px;color:var(--muted);margin-top:1px">Refine your data and view insights that matter</div>'`;

if (!dash.includes(OLD_TITLE)) {
  console.error('✗ Filters title anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_TITLE, NEW_TITLE);
console.log('✓ Filters title shrunk: 20px → 14px');

// Also shrink the icon since the title is smaller
const OLD_ICON = `'<div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:20px">🔽</div>'`;
const NEW_ICON = `'<div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:14px">🔽</div>'`;
if (dash.includes(OLD_ICON)) {
  dash = dash.replace(OLD_ICON, NEW_ICON);
  console.log('✓ Filters icon proportionally shrunk: 44px → 32px');
}

// Reduce card padding too so it doesn't dwarf the smaller title
const OLD_CARD_PAD = `return '<div class="card" style="padding:22px;margin-bottom:14px">'`;
const NEW_CARD_PAD = `return '<div class="card" style="padding:14px 16px;margin-bottom:14px">'`;
if (dash.includes(OLD_CARD_PAD)) {
  dash = dash.replace(OLD_CARD_PAD, NEW_CARD_PAD);
  console.log('✓ Filters card padding tightened');
}

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V63: fix util nav crash + remove Additional/Saved Filters + shrink title ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V63: util nav + filters trim',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
