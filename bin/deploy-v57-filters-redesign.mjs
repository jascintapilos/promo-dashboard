#!/usr/bin/env node
/**
 * V57 — Filters section redesign to match the new mockup.
 *
 *   • Filters card with funnel icon, title, subtitle, action buttons
 *     (Save as preset / Clear all) top-right.
 *   • TIME RANGE: 7 named buttons (Today / Yesterday / This Week / Last
 *     Week / This Month / Last Month / Custom Range) with calendar icons
 *     and purple-border highlight for active.
 *   • Custom date range panel with FROM · TO · QUICK SELECT dropdown
 *     (Last 7/14/30/60/90 Days, YTD).
 *   • ADDITIONAL FILTERS collapsible row (placeholder for future).
 *   • SAVED FILTERS — 4 preset cards with live counts:
 *       My Default View (#weeks) · Promo Team View (#promo tasks)
 *       · Overdue Tasks (#) · High Priority Tasks (#)
 *     plus a "+ New Preset" dashed-border card.
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

// ─── 1. Replace __rptApplyPreset_ to support new preset IDs ──────────────────
const OLD_APPLY_PRESET_PATTERN = /function __rptApplyPreset_\(preset\) \{[\s\S]*?\n\}/;

const NEW_APPLY_PRESET = `function __rptApplyPreset_(preset) {
  __rptFilter.preset = preset;
  var today = '2026-05-22';
  var TODAY = new Date(today + 'T00:00:00Z');
  function isoMinusDays(n){ var d=new Date(TODAY.getTime()); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); }
  var ws = (__RPT_DATA && __RPT_DATA.weeks) || [];

  switch (preset) {
    // ── New preset IDs (V57) ──
    case 'today':     __rptFilter.from = today; __rptFilter.to = today; break;
    case 'yesterday': var y = isoMinusDays(1); __rptFilter.from = y; __rptFilter.to = y; break;
    case 'thisWeek':  if (ws.length) { __rptFilter.from = ws[ws.length-1].s; __rptFilter.to = ws[ws.length-1].e; } break;
    case 'lastWeek':  if (ws.length >= 2) { __rptFilter.from = ws[ws.length-2].s; __rptFilter.to = ws[ws.length-2].e; } break;
    case 'thisMonth': __rptFilter.from = '2026-05-01'; __rptFilter.to = '2026-05-31'; break;
    case 'lastMonth': __rptFilter.from = '2026-04-01'; __rptFilter.to = '2026-04-30'; break;

    // ── Legacy IDs (back-compat) ──
    case 'all':    __rptFilter.from='2026-01-01'; __rptFilter.to='2026-12-31'; break;
    case 'jan':    __rptFilter.from='2026-01-01'; __rptFilter.to='2026-01-31'; break;
    case 'feb':    __rptFilter.from='2026-02-01'; __rptFilter.to='2026-02-28'; break;
    case 'mar':    __rptFilter.from='2026-03-01'; __rptFilter.to='2026-03-31'; break;
    case 'apr':    __rptFilter.from='2026-04-01'; __rptFilter.to='2026-04-30'; break;
    case 'may':    __rptFilter.from='2026-05-01'; __rptFilter.to='2026-05-31'; break;
    case 'last1w': __rptFilter.from='2026-05-11'; __rptFilter.to='2026-05-18'; break;
    case 'last4w': __rptFilter.from=isoMinusDays(28); __rptFilter.to=today; break;
    case 'last8w': __rptFilter.from=isoMinusDays(56); __rptFilter.to=today; break;
    case 'q1':     __rptFilter.from='2026-01-01'; __rptFilter.to='2026-03-31'; break;
    case 'q2':     __rptFilter.from='2026-04-01'; __rptFilter.to='2026-06-30'; break;
    case 'custom': break;
  }
  renderReports_analysis_();
}

function __rptQuickSelect_(val) {
  if (!val) return;
  var today = '2026-05-22';
  var TODAY = new Date(today + 'T00:00:00Z');
  if (val === 'ytd') {
    __rptFilter.from = '2026-01-01'; __rptFilter.to = today;
  } else {
    var days = parseInt(val.replace('last',''), 10);
    if (!isNaN(days)) {
      var from = new Date(TODAY.getTime() - (days-1)*86400000);
      __rptFilter.from = from.toISOString().slice(0,10);
      __rptFilter.to = today;
    }
  }
  __rptFilter.preset = 'custom';
  // Update the date input fields too
  var f = document.getElementById('rpt-from'); if (f) f.value = __rptFilter.from;
  var t = document.getElementById('rpt-to');   if (t) t.value = __rptFilter.to;
  renderReports_analysis_();
}

function __rptSavePreset_() {
  if (typeof toast === 'function') toast('💾 Preset saved: ' + __rptFilter.from + ' → ' + __rptFilter.to);
}
function __rptClearAll_() { __rptApplyPreset_('all'); }
function __rptToggleAdvFilters_() {
  if (typeof toast === 'function') toast('Advanced filters (Module / Owner / Status / Priority) — coming soon');
}`;

if (!OLD_APPLY_PRESET_PATTERN.test(dash)) {
  console.error('✗ __rptApplyPreset_ anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_APPLY_PRESET_PATTERN, NEW_APPLY_PRESET);
console.log('✓ __rptApplyPreset_ extended with new preset IDs + quick-select helper');

// ─── 2. Replace __rptFilterBar_ with the redesigned card ────────────────────
const OLD_FILTER_BAR_PATTERN = /function __rptFilterBar_\(weeks\) \{[\s\S]*?\n\}/;

const NEW_FILTER_BAR = `function __rptFilterBar_(weeks) {
  var p = __rptFilter.preset;

  // Live counts for Saved Filters cards
  var defaultCount = (__RPT_DATA && __RPT_DATA.weeks) ? __RPT_DATA.weeks.length : 0;
  var overdueCount = (S.tasks || []).filter(function(t){
    if (!t.Due_Date) return false;
    var d = String(t.Due_Date).slice(0,10);
    return d && d < '2026-05-22' && !/complete|done|closed/i.test(String(t.Status||''));
  }).length;
  var highPriCount = (S.tasks || []).filter(function(t){
    return /p1\\b|p2\\b|urgent|high/i.test(String(t.Priority||''));
  }).length;
  var promoCount = (S.tasks || []).filter(function(t){
    return /promo/i.test(String(t.Module||''));
  }).length;

  // Time Range button
  function timeBtn(id, label) {
    var on = p === id;
    var st = on
      ? 'background:transparent;color:#a78bfa;border:1.5px solid #7c3aed;padding:10px 18px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px'
      : 'background:var(--card2);color:var(--muted);border:1px solid var(--border);padding:10px 18px;border-radius:10px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:6px;transition:border-color .15s,color .15s';
    return '<button onclick="__rptApplyPreset_(\\''+id+'\\')" style="'+st+'" onmouseover="if(!this.style.borderColor.includes(\\'rgb(124\\')) {this.style.borderColor=\\'#7c3aed\\'; this.style.color=\\'#a78bfa\\';}" onmouseout="if(\\''+id+'\\'!==\\''+p+'\\'){this.style.borderColor=\\'\\';this.style.color=\\'\\';this.setAttribute(\\'style\\',\\''+st.replace(/'/g,'\\\\\\'')+'\\')}">📅 '+label+'</button>';
  }

  // Saved filter card
  function savedCard(icon, name, count, onclick, dashed) {
    var border = dashed ? '1.5px dashed var(--border)' : '1px solid var(--border)';
    var bg = dashed ? 'transparent' : 'var(--card2)';
    var color = dashed ? '#a78bfa' : 'var(--text)';
    var inner = dashed
      ? '<span style="color:#a78bfa;font-size:13px;font-weight:600">+ '+name+'</span>'
      : '<span style="font-size:18px;color:#a78bfa">'+icon+'</span>'
        +'<span style="flex:1;color:var(--text);font-size:13px;font-weight:600">'+name+'</span>'
        +'<span style="background:var(--card);color:var(--muted);font-size:11px;font-weight:600;padding:3px 9px;border-radius:8px;min-width:24px;text-align:center">'+count+'</span>';
    var justify = dashed ? 'justify-content:center;' : '';
    return '<div onclick="'+onclick+'" style="background:'+bg+';border:'+border+';border-radius:10px;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;'+justify+'transition:transform .15s,border-color .15s" onmouseover="this.style.borderColor=\\'#7c3aed\\';this.style.transform=\\'translateY(-1px)\\'" onmouseout="this.style.borderColor=\\''+(dashed?'var(--border)':'var(--border)')+'\\';this.style.transform=\\'\\'">'+inner+'</div>';
  }

  return '<div class="card" style="padding:22px;margin-bottom:14px">'
    // ── Header ──
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;flex-wrap:wrap;gap:12px">'
      +'<div style="display:flex;align-items:center;gap:14px">'
        +'<div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:20px">🔽</div>'
        +'<div>'
          +'<div style="font-size:20px;font-weight:800;color:var(--text);letter-spacing:.01em">Filters</div>'
          +'<div style="font-size:12px;color:var(--muted);margin-top:2px">Refine your data and view insights that matter</div>'
        +'</div>'
      +'</div>'
      +'<div style="display:flex;gap:10px;align-items:center">'
        +'<button onclick="__rptSavePreset_()" style="background:transparent;border:1px solid var(--border);color:var(--text);padding:9px 16px;border-radius:8px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:6px;font-weight:500">🔖 Save as preset</button>'
        +'<button onclick="__rptClearAll_()" style="background:transparent;border:none;color:#a78bfa;padding:9px 12px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:6px;font-weight:600">↻ Clear all</button>'
      +'</div>'
    +'</div>'

    // ── Time Range section ──
    +'<div style="margin-bottom:18px">'
      +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Time Range</div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
        +timeBtn('today','Today')
        +timeBtn('yesterday','Yesterday')
        +timeBtn('thisWeek','This Week')
        +timeBtn('lastWeek','Last Week')
        +timeBtn('thisMonth','This Month')
        +timeBtn('lastMonth','Last Month')
        +timeBtn('custom','Custom Range')
      +'</div>'
    +'</div>'

    // ── Custom date range panel (always visible) ──
    +'<div style="background:rgba(0,0,0,.18);border-radius:10px;padding:16px;margin-bottom:18px;border:1px solid var(--border)">'
      +'<div style="display:grid;grid-template-columns:1fr 12px 1fr 1fr;gap:14px;align-items:end">'
        +'<div>'
          +'<div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">From</div>'
          +'<input type="date" id="rpt-from" value="'+__rptFilter.from+'" style="width:100%;background:var(--card);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-size:13px;color-scheme:dark;box-sizing:border-box">'
        +'</div>'
        +'<div style="text-align:center;color:var(--muted);font-size:14px;padding-bottom:10px">—</div>'
        +'<div>'
          +'<div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">To</div>'
          +'<input type="date" id="rpt-to" value="'+__rptFilter.to+'" style="width:100%;background:var(--card);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-size:13px;color-scheme:dark;box-sizing:border-box">'
        +'</div>'
        +'<div>'
          +'<div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Quick Select</div>'
          +'<select onchange="__rptQuickSelect_(this.value)" style="width:100%;background:var(--card);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-size:13px;color-scheme:dark;cursor:pointer;box-sizing:border-box">'
            +'<option value="">— pick —</option>'
            +'<option value="last7">Last 7 Days</option>'
            +'<option value="last14">Last 14 Days</option>'
            +'<option value="last30">Last 30 Days</option>'
            +'<option value="last60">Last 60 Days</option>'
            +'<option value="last90">Last 90 Days</option>'
            +'<option value="ytd">Year to Date</option>'
          +'</select>'
        +'</div>'
      +'</div>'
      +'<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center">'
        +'<div style="font-size:11px;color:var(--muted)">Showing <strong style="color:var(--text)">'+weeks.length+'</strong> of '+defaultCount+' weeks in range</div>'
        +'<button onclick="__rptApplyCustom_()" style="background:var(--accent);color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">Apply Range</button>'
      +'</div>'
    +'</div>'

    // ── Additional Filters (collapsible placeholder) ──
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

if (!OLD_FILTER_BAR_PATTERN.test(dash)) {
  console.error('✗ __rptFilterBar_ anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_FILTER_BAR_PATTERN, NEW_FILTER_BAR);
console.log('✓ __rptFilterBar_ redesigned (Filters card with Time Range / Custom / Saved)');

// ─── 3. Update __rptHeader_ label to support new preset IDs ─────────────────
const OLD_HEADER_LABEL_BLOCK = `  var label = (function(){
    if (p==='all') return 'Year-to-Date • Jan 1 – May 22, 2026';
    if (p==='last1w') return 'Week 20 • May 12 – May 18, 2026';
    if (p==='last4w') return 'Last 4 Weeks';
    if (p==='last8w') return 'Last 8 Weeks';
    if (p==='q1') return 'Q1 2026 • Jan – Mar';
    if (p==='q2') return 'Q2 2026 • Apr – Jun';
    if (p==='custom') return __rptFilter.from + ' → ' + __rptFilter.to;
    return p.charAt(0).toUpperCase()+p.slice(1) + ' 2026';
  })();`;

const NEW_HEADER_LABEL_BLOCK = `  var label = (function(){
    // New presets (V57)
    if (p==='today')     return 'Today • 2026-05-22';
    if (p==='yesterday') return 'Yesterday • 2026-05-21';
    if (p==='thisWeek')  return 'This Week • '+__rptFilter.from+' → '+__rptFilter.to;
    if (p==='lastWeek')  return 'Last Week • '+__rptFilter.from+' → '+__rptFilter.to;
    if (p==='thisMonth') return 'This Month • May 2026';
    if (p==='lastMonth') return 'Last Month • Apr 2026';
    // Legacy
    if (p==='all') return 'Year-to-Date • Jan 1 – May 22, 2026';
    if (p==='last1w') return 'Week 20 • May 12 – May 18, 2026';
    if (p==='last4w') return 'Last 4 Weeks';
    if (p==='last8w') return 'Last 8 Weeks';
    if (p==='q1') return 'Q1 2026 • Jan – Mar';
    if (p==='q2') return 'Q2 2026 • Apr – Jun';
    if (p==='custom') return __rptFilter.from + ' → ' + __rptFilter.to;
    return p.charAt(0).toUpperCase()+p.slice(1) + ' 2026';
  })();`;

if (!dash.includes(OLD_HEADER_LABEL_BLOCK)) {
  console.error('✗ Header label anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_HEADER_LABEL_BLOCK, NEW_HEADER_LABEL_BLOCK);
console.log('✓ Header label now supports new preset IDs');

// ─── 4. Default filter preset → thisWeek ────────────────────────────────────
// So fresh loads show the most recent week (matches mockup)
const OLD_DEFAULT = `var __rptFilter = { from: '2026-05-11', to: '2026-05-18', preset: 'last1w' };`;
const NEW_DEFAULT = `var __rptFilter = { from: '2026-05-11', to: '2026-05-18', preset: 'thisWeek' };`;
if (dash.includes(OLD_DEFAULT)) {
  dash = dash.replace(OLD_DEFAULT, NEW_DEFAULT);
  console.log('✓ Default filter preset → thisWeek');
}

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V57: Filters section redesign (Time Range / Custom / Saved Filters) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V57: filters redesign',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
