#!/usr/bin/env node
/**
 * V41 — Three fixes deployed to the production project (1Zw5W9...):
 *
 * 1. Task title → Slack permalink (built from t.Source field).
 *    Previously linked to t.Source_Link which holds template URLs.
 *    Source format: 'slack:<ts>:<extra>' → builds Slack deep-link.
 *
 * 2. serverSyncSlackTasks → also writes Source_Link = Slack permalink
 *    so new synced tasks populate the column going forward.
 *
 * 3. serverGetWeeklyReports → DriveApp (native Shared Drive access).
 *    UrlFetchApp+Drive API was returning empty on this Shared Drive.
 *
 * 4. Reports section → Analysis first (Jan–May data) + File browser tab.
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
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let code = proj.files[codeIdx].source;
let dash = proj.files[dashIdx].source;

let ok = 0, warn = 0;
function patch(label, src, oldStr, newStr) {
  if (!src.includes(oldStr)) { console.error('✗ ' + label); warn++; return src; }
  console.log('✓ ' + label);
  ok++;
  return src.replace(oldStr, newStr);
}

// ─── FIX 1: Task title — replace Source_Link href with Slack URL from Source ─
dash = patch('Task title → Slack permalink from t.Source',
  dash,
  `'<td style="font-weight:500;max-width:260px">' + (t.Source_Link ? '<a href="' + esc(t.Source_Link) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--muted)">' + esc(t.Title || '—') + ' <span style="font-size:10px;color:var(--muted)">↗</span></a>' : esc(t.Title || '—')) + '</td>' +`,
  `'<td style="font-weight:500;max-width:260px">' + (function(){ var _s=String(t.Source||''); if(_s.indexOf('slack:')!==0) return esc(t.Title||'—'); var _ts=(_s.split(':')[1]||'').replace('.',''); var _ch=/promo/i.test(t.Module||'')?'C09LT8W2D70':'C07KKVD1GTE'; var _u='https://the-company-team-hub.slack.com/archives/'+_ch+'/p'+_ts; return '<a href="'+esc(_u)+'" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--muted)">'+esc(t.Title||'—')+' <span style="font-size:10px;color:var(--muted)">↗</span></a>'; }()) + '</td>' +`
);

// ─── FIX 2: serverSyncSlackTasks — write Source_Link = Slack permalink ────────
code = patch('serverSyncSlackTasks writes Source_Link',
  code,
  `          var row = headers.map(function(h){
            if (h === 'Task_ID') return id;
            if (h === 'Created_At' || h === 'Updated_At') return now;
            if (h === 'Assigned_At') return assignedAt;
            return t[h] !== undefined ? t[h] : '';
          });`,
  `          t.Source_Link = 'https://the-company-team-hub.slack.com/archives/' + ch.id + '/p' + String(msg.ts||'').replace('.','');
          var row = headers.map(function(h){
            if (h === 'Task_ID') return id;
            if (h === 'Created_At' || h === 'Updated_At') return now;
            if (h === 'Assigned_At') return assignedAt;
            return t[h] !== undefined ? t[h] : '';
          });`
);

// ─── FIX 3: serverGetWeeklyReports → DriveApp ─────────────────────────────────
const OLD_GET_REPORTS = `function serverGetWeeklyReports() {
  // Lists all weekly report Sheet files inside the monthly subfolders.
  // Uses Drive REST API via UrlFetchApp because it's in a Shared Drive
  // (Apps Script's DriveApp doesn't always handle shared drives well).
  function fetch_(url) {
    var token = ScriptApp.getOAuthToken();
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    return JSON.parse(res.getContentText());
  }
  function listChildren(parentId, mimeFilter) {
    var q = "'" + parentId + "' in parents and trashed=false";
    if (mimeFilter) q += " and mimeType='" + mimeFilter + "'";
    var url = 'https://www.googleapis.com/drive/v3/files'
      + '?q=' + encodeURIComponent(q)
      + '&fields=' + encodeURIComponent('files(id,name,mimeType,modifiedTime)')
      + '&orderBy=modifiedTime+desc'
      + '&pageSize=100'
      + '&supportsAllDrives=true&includeItemsFromAllDrives=true';
    var data = fetch_(url);
    return (data && data.files) || [];
  }
  try {
    var all = [];
    // 1. List monthly subfolders
    var months = listChildren(WEEKLY_REPORT_FOLDER_ID, 'application/vnd.google-apps.folder');
    // 2. For each month, list weekly sheet files
    months.forEach(function(m){
      var sheets = listChildren(m.id, 'application/vnd.google-apps.spreadsheet');
      sheets.forEach(function(s){
        all.push({
          id: s.id,
          name: s.name,
          month: m.name,
          modifiedTime: s.modifiedTime,
          openUrl: 'https://docs.google.com/spreadsheets/d/' + s.id + '/edit',
          embedUrl: 'https://docs.google.com/spreadsheets/d/' + s.id + '/preview',
        });
      });
    });
    // Sort all by modifiedTime desc
    all.sort(function(a,b){ return String(b.modifiedTime).localeCompare(String(a.modifiedTime)); });
    return all;
  } catch (e) {
    Logger.log('serverGetWeeklyReports error: ' + e.message);
    return [];
  }
}`;

const NEW_GET_REPORTS = `function serverGetWeeklyReports() {
  // DriveApp natively handles Shared Drive folders — no UrlFetchApp needed.
  try {
    var all = [];
    var rootFolder = DriveApp.getFolderById(WEEKLY_REPORT_FOLDER_ID);
    var monthIt = rootFolder.getFolders();
    while (monthIt.hasNext()) {
      var mf = monthIt.next();
      var mName = mf.getName();
      var fIt = mf.getFilesByType(MimeType.GOOGLE_SHEETS);
      while (fIt.hasNext()) {
        var f = fIt.next();
        all.push({
          id:           f.getId(),
          name:         f.getName(),
          month:        mName,
          modifiedTime: f.getLastUpdated().toISOString(),
          openUrl:      'https://docs.google.com/spreadsheets/d/' + f.getId() + '/edit',
          embedUrl:     'https://docs.google.com/spreadsheets/d/' + f.getId() + '/preview',
        });
      }
    }
    all.sort(function(a,b){ return String(b.modifiedTime).localeCompare(String(a.modifiedTime)); });
    return all;
  } catch (e) {
    Logger.log('serverGetWeeklyReports error: ' + e.message);
    return [];
  }
}`;

code = patch('serverGetWeeklyReports → DriveApp', code, OLD_GET_REPORTS, NEW_GET_REPORTS);

// ─── FIX 4: Replace entire Reports JS section ─────────────────────────────────
// Markers used when the Drive-folder version was deployed (V40)
const RPT_START_MARKER = '// ============================================================================\n// REPORTS — Weekly Report files from Drive\n// ============================================================================';
const RPT_END_MARKER   = '\n// ============================================================================\n// SETTINGS';

const rptStartIdx = dash.indexOf(RPT_START_MARKER);
const rptEndIdx   = dash.indexOf(RPT_END_MARKER, rptStartIdx);

if (rptStartIdx < 0 || rptEndIdx < 0) {
  console.error('✗ Reports section markers not found  (start=' + rptStartIdx + ' end=' + rptEndIdx + ')');
  warn++;
} else {
  // Weekly data captured via Sheets API on 2026-05-22
  // W15 had an API quota error during read → shown as null (—) in table
  const NEW_REPORTS_SECTION = `// ============================================================================
// REPORTS — Jan–May 2026 Analysis + Drive file browser
// ============================================================================
var __RPT_DATA = {
  weeks:[
    {w:'W01',d:'02–09 Jan',mo:'Jan',p:48,b:32,c:0,g:11},
    {w:'W02',d:'12–16 Jan',mo:'Jan',p:73,b:2,c:0,g:9},
    {w:'W03',d:'19–23 Jan',mo:'Jan',p:125,b:18,c:0,g:10},
    {w:'W04',d:'26–30 Jan',mo:'Jan',p:327,b:47,c:0,g:8},
    {w:'W05',d:'02–06 Feb',mo:'Feb',p:58,b:23,c:0,g:11},
    {w:'W06',d:'09–13 Feb',mo:'Feb',p:69,b:8,c:0,g:10},
    {w:'W07',d:'16–20 Feb',mo:'Feb',p:2,b:0,c:0,g:9},
    {w:'W08',d:'23–27 Feb',mo:'Feb',p:66,b:30,c:0,g:9},
    {w:'W09',d:'02–06 Mar',mo:'Mar',p:12,b:28,c:0,g:10},
    {w:'W10',d:'09–13 Mar',mo:'Mar',p:66,b:15,c:0,g:8},
    {w:'W11',d:'16–20 Mar',mo:'Mar',p:30,b:8,c:0,g:8},
    {w:'W12',d:'23–27 Mar',mo:'Mar',p:12,b:51,c:29,g:7},
    {w:'W13',d:'30 Mar–03 Apr',mo:'Apr',p:7,b:52,c:31,g:10},
    {w:'W14',d:'06–10 Apr',mo:'Apr',p:32,b:4,c:31,g:9},
    {w:'W15',d:'13–17 Apr',mo:'Apr',p:null,b:null,c:null,g:null},
    {w:'W16',d:'20–24 Apr',mo:'Apr',p:50,b:2,c:194,g:1},
    {w:'W17',d:'27 Apr–01 May',mo:'May',p:57,b:22,c:155,g:3},
    {w:'W18',d:'04–08 May',mo:'May',p:184,b:37,c:102,g:13},
    {w:'W19',d:'11–18 May',mo:'May',p:107,b:6,c:66,g:7},
  ],
  months:[
    {m:'Jan',p:573,b:99,c:0,g:38},
    {m:'Feb',p:195,b:61,c:0,g:39},
    {m:'Mar',p:120,b:102,c:29,g:33},
    {m:'Apr',p:89,b:58,c:256,g:20},
    {m:'May',p:348,b:65,c:323,g:23},
  ],
};
var __rptTab = 'analysis';
var __cachedRptFiles = null;
var __selectedReportId = null;

function __rptKpi_(label, val, sub, col) {
  return '<div class="card" style="padding:14px;margin:0"><div style="font-size:24px;font-weight:800;color:'+col+'">'+val+'</div><div style="font-size:12px;font-weight:600;color:var(--text);margin:2px 0">'+label+'</div><div style="font-size:10px;color:var(--muted)">'+sub+'</div></div>';
}
function __rptTabBar_(active) {
  var a='flex:1;padding:7px 10px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;background:var(--accent);color:#fff';
  var i='flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;background:var(--card2);color:var(--muted)';
  return '<div style="display:flex;gap:8px;margin-bottom:14px">'
    +'<button onclick="__rptNav_(\\'analysis\\')" style="'+(active==='analysis'?a:i)+'">📊 Analysis</button>'
    +'<button onclick="__rptNav_(\\'files\\')" style="'+(active==='files'?a:i)+'">📁 Weekly Files</button>'
    +'</div>';
}
function __rptNav_(tab) {
  __rptTab = tab;
  if (tab==='analysis') renderReports_analysis_();
  else renderReports_files_(__cachedRptFiles);
}

function renderReports() {
  // Show analysis instantly (static data), load file list in background
  renderReports_analysis_();
  if (typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(f){ __cachedRptFiles = f; })
      .withFailureHandler(function(){   __cachedRptFiles = []; })
      .serverGetWeeklyReports();
  }
}

function renderReports_analysis_() {
  __rptTab = 'analysis';
  var mo = __RPT_DATA.months;
  var maxP = Math.max.apply(null, mo.map(function(m){ return m.p; }));
  var maxB = Math.max.apply(null, mo.map(function(m){ return m.b; }));
  var maxC = Math.max.apply(null, mo.map(function(m){ return m.c; }));

  var chart = mo.map(function(m){
    var pp = maxP>0 ? Math.round(m.p/maxP*100) : 0;
    var bp = maxB>0 ? Math.round(m.b/maxB*100) : 0;
    var cp = maxC>0 ? Math.round(m.c/maxC*100) : 0;
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
      +'<div style="width:30px;font-size:11px;font-weight:700;color:var(--muted)">'+m.m+'</div>'
      +'<div style="flex:1">'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'
          +'<div style="height:12px;width:'+pp+'%;min-width:2px;background:var(--accent);border-radius:2px"></div>'
          +'<span style="font-size:11px;color:var(--text)">'+m.p+' promos</span></div>'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'
          +'<div style="height:8px;width:'+bp+'%;min-width:2px;background:#0ea5e9;border-radius:2px"></div>'
          +'<span style="font-size:10px;color:var(--muted)">'+m.b+' banners</span></div>'
        +'<div style="display:flex;align-items:center;gap:6px">'
          +'<div style="height:8px;width:'+cp+'%;min-width:2px;background:#10b981;border-radius:2px"></div>'
          +'<span style="font-size:10px;color:var(--muted)">'+m.c+' CRM</span></div>'
      +'</div>'
      +'<div style="width:52px;text-align:right;font-size:10px;color:var(--muted)">🎮 '+m.g+'</div>'
    +'</div>';
  }).join('');

  var wkRows = __RPT_DATA.weeks.map(function(w){
    var na = w.p===null;
    var hi = !na && w.p>=100;
    return '<tr style="border-bottom:1px solid var(--border)'+(na?';opacity:.5':'')+'">'
      +'<td style="padding:5px 8px;font-family:monospace;font-size:10px;color:var(--muted)">'+w.w+'</td>'
      +'<td style="padding:5px 8px;font-size:11px;color:var(--muted);white-space:nowrap">'+w.d+'</td>'
      +'<td style="padding:5px 8px;text-align:right;font-size:12px;font-weight:'+(hi?'700':'400')+';color:'+(hi?'var(--accent)':'var(--text)')+'">'+( na?'—':w.p)+'</td>'
      +'<td style="padding:5px 8px;text-align:right;font-size:12px;color:var(--text)">'+( na?'—':w.b)+'</td>'
      +'<td style="padding:5px 8px;text-align:right;font-size:12px;color:var(--text)">'+( na?'—':w.c)+'</td>'
      +'<td style="padding:5px 8px;text-align:right;font-size:12px;color:var(--text)">'+( na?'—':w.g)+'</td>'
      +'</tr>';
  }).join('');

  var tp=0,tb=0,tc=0,tg=0;
  mo.forEach(function(m){tp+=m.p;tb+=m.b;tc+=m.c;tg+=m.g;});

  content(
    __rptTabBar_('analysis')
    +'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">'
      +__rptKpi_('Promo Codes', tp, 'Jan–May 2026', 'var(--accent)')
      +__rptKpi_('Banners', tb, 'Jan–May 2026', '#0ea5e9')
      +__rptKpi_('CRM Campaigns', tc, 'Jan–May 2026', '#10b981')
      +__rptKpi_('New Games Added', tg, 'Jan–May 2026', '#f59e0b')
    +'</div>'
    +'<div class="card" style="margin-bottom:16px">'
      +'<div class="card-hdr"><h3>📅 Monthly Activity</h3><span style="font-size:11px;color:var(--muted)">Jan–May 2026</span></div>'
      +'<div style="padding:14px 16px">'+chart+'</div>'
    +'</div>'
    +'<div class="card">'
      +'<div class="card-hdr"><h3>📋 Weekly Breakdown</h3><span style="font-size:10px;color:var(--muted)">W15 (13–17 Apr) data unavailable — API quota during read</span></div>'
      +'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'
        +'<thead><tr style="border-bottom:2px solid var(--border)">'
          +'<th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted)">WK</th>'
          +'<th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted)">DATES</th>'
          +'<th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--accent)">PROMOS</th>'
          +'<th style="padding:6px 8px;text-align:right;font-size:10px;color:#0ea5e9">BANNERS</th>'
          +'<th style="padding:6px 8px;text-align:right;font-size:10px;color:#10b981">CRM</th>'
          +'<th style="padding:6px 8px;text-align:right;font-size:10px;color:#f59e0b">GAMES</th>'
        +'</tr></thead>'
        +'<tbody>'+wkRows+'</tbody>'
        +'<tfoot><tr style="border-top:2px solid var(--border)">'
          +'<td colspan="2" style="padding:7px 8px;font-size:11px;font-weight:700">YTD TOTAL (W01–W19)</td>'
          +'<td style="padding:7px 8px;text-align:right;font-size:14px;font-weight:800;color:var(--accent)">'+tp+'</td>'
          +'<td style="padding:7px 8px;text-align:right;font-size:14px;font-weight:800;color:#0ea5e9">'+tb+'</td>'
          +'<td style="padding:7px 8px;text-align:right;font-size:14px;font-weight:800;color:#10b981">'+tc+'</td>'
          +'<td style="padding:7px 8px;text-align:right;font-size:14px;font-weight:800;color:#f59e0b">'+tg+'</td>'
        +'</tr></tfoot>'
      +'</table></div>'
    +'</div>'
  );
}

function renderReports_files_(files) {
  __rptTab = 'files';
  var tb = __rptTabBar_('files');
  if (!files || !files.length) {
    content(tb + '<div class="empty">📭 No weekly reports found in Drive folder.<br>'
      +'<button class="btn" onclick="__rptNav_(\\'files\\')" style="margin-top:8px">↻ Try again</button>'
      +'&nbsp;<a href="https://drive.google.com/drive/folders/1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P" target="_blank" style="color:var(--accent)">Open Drive folder →</a></div>');
    return;
  }
  var byMonth = {};
  files.forEach(function(f){ var m=f.month||'Other'; if(!byMonth[m]) byMonth[m]=[]; byMonth[m].push(f); });
  if (!__selectedReportId || !files.find(function(f){ return f.id===__selectedReportId; })) {
    __selectedReportId = files[0].id;
  }
  var sel = files.find(function(f){ return f.id===__selectedReportId; });

  var sidebar = '<div style="display:flex;flex-direction:column;gap:10px">';
  Object.keys(byMonth).forEach(function(mo){
    sidebar += '<div><div style="font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;padding:6px 10px">'+esc(mo)+'</div>';
    byMonth[mo].forEach(function(f){
      var on = f.id===__selectedReportId;
      sidebar += '<div onclick="selectReport_(\''+esc(f.id)+'\')" style="padding:7px 10px;border-radius:6px;cursor:pointer;font-size:11px;background:'+(on?'var(--pill-bg)':'transparent')+';color:'+(on?'var(--accent)':'var(--text)')+';border-left:3px solid '+(on?'var(--accent)':'transparent')+';margin-bottom:2px">'
        +'<div style="font-weight:600;margin-bottom:2px">'+esc(f.name)+'</div>'
        +'<div style="font-size:10px;color:var(--muted)">'+String(f.modifiedTime||'').slice(0,10)+'</div>'
        +'</div>';
    });
    sidebar += '</div>';
  });
  sidebar += '</div>';

  content(tb
    +'<div class="card" style="margin:0;height:calc(100vh - 150px);display:flex;flex-direction:column">'
      +'<div class="card-hdr" style="flex-shrink:0">'
        +'<h3>📊 '+esc(sel.name)+'</h3>'
        +'<div style="display:flex;gap:8px">'
          +'<a class="btn" href="'+esc(sel.openUrl)+'" target="_blank" style="text-decoration:none">↗ Open in tab</a>'
          +'<button class="btn" onclick="renderReports()">↻ Refresh</button>'
        +'</div>'
      +'</div>'
      +'<div style="display:flex;flex:1;overflow:hidden">'
        +'<div style="width:230px;border-right:1px solid var(--border);overflow-y:auto;padding:8px;flex-shrink:0">'+sidebar+'</div>'
        +'<div style="flex:1;background:#fff;overflow:hidden"><iframe src="'+esc(sel.embedUrl)+'" style="width:100%;height:100%;border:0" allow="autoplay"></iframe></div>'
      +'</div>'
    +'</div>'
  );
}

function selectReport_(id) {
  __selectedReportId = id;
  renderReports_files_(__cachedRptFiles || []);
}

function renderReportsData(files) {
  // Legacy success handler kept for compatibility
  __cachedRptFiles = files;
}`;

  dash = dash.slice(0, rptStartIdx) + NEW_REPORTS_SECTION + dash.slice(rptEndIdx);
  console.log('✓ Reports section → Analysis + File browser tabs');
  ok++;
}

// ─── Push + promote ──────────────────────────────────────────────────────────
console.log(`\n${ok} patches applied, ${warn} warnings`);
if (warn > 0) { console.error('Stopping — fix warnings first.'); process.exit(1); }

proj.files[codeIdx].source = code;
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V41: Slack title + DriveApp reports + Jan–May analysis — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V41: title links + analysis',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
