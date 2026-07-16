#!/usr/bin/env node
/**
 * build-unified.mjs
 *
 * Generates apps-script/unified-dashboard/Code.gs + Dashboard.html from:
 *   - captures/apps-script-source.json  (PromoOps Command Center source)
 *   - Inline YTD aggregation functions  (weekly-reports folder scanner)
 *   - Inline enhanced viewReports()     (Chart.js YTD analytics panel)
 *
 * Output files go to apps-script/unified-dashboard/ for historical reference.
 * The Control Tower deployment path has been retired.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CAPTURE = path.join(ROOT, 'captures', 'apps-script-source.json');
const OUT_DIR  = path.join(ROOT, 'apps-script', 'unified-dashboard');

mkdirSync(OUT_DIR, { recursive: true });

// ── Read captured source ───────────────────────────────────────────────────
const src = JSON.parse(readFileSync(CAPTURE, 'utf8'));
const files = src.files;
const codeFile      = files.find(f => f.name === 'Code');
const dashFile      = files.find(f => f.name === 'Dashboard');
const guestFile     = files.find(f => f.name === 'GuestPortal');
const manifestFile  = files.find(f => f.name === 'appsscript');

// ── Patch Code.gs ─────────────────────────────────────────────────────────
let codeGs = codeFile.source;

// 1. Make it standalone — replace bound-script getActiveSpreadsheet() with openById
codeGs = codeGs.replace(
  'const SS = SpreadsheetApp.getActiveSpreadsheet();',
  'const SS = SpreadsheetApp.openById("16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk");'
);

// 2. Fix doGet — keep page routing but load from this standalone script's files
// (already correct — uses HtmlService.createHtmlOutputFromFile which works standalone)

// 3. Append YTD analytics functions
const YTD_FUNCTIONS = `

// =============================================================================
// YTD ANALYTICS  —  reads weekly-report sheets from Drive folder
// =============================================================================

const WEEKLY_REPORT_PARENT_FOLDER_ID = '1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P';
const YTD_CACHE_KEY = 'ytd_unified_v1';
const YTD_CACHE_TTL = 600; // 10 minutes

/**
 * Called from client via google.script.run.serverGetYTD()
 * Returns { weeks: [...], generatedAt: ISO }
 */
function serverGetYTD() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(YTD_CACHE_KEY);
  if (hit) {
    try { return JSON.parse(hit); } catch(e) {}
  }
  var result = aggregateYTD_();
  try { cache.put(YTD_CACHE_KEY, JSON.stringify(result), YTD_CACHE_TTL); } catch(e) {}
  return result;
}

function clearYTDCache() {
  CacheService.getScriptCache().remove(YTD_CACHE_KEY);
  return 'cleared';
}

function aggregateYTD_() {
  var reports = discoverYTDReports_();
  var weeks = [];
  reports.forEach(function(file) {
    var w = parseYTDWeek_(file);
    if (w) weeks.push(w);
  });
  // Sort chronologically by weekNum+year
  weeks.sort(function(a, b) {
    if (a.year !== b.year) return a.year - b.year;
    return a.weekNum - b.weekNum;
  });
  return { weeks: weeks, generatedAt: new Date().toISOString() };
}

function discoverYTDReports_() {
  var folder = DriveApp.getFolderById(WEEKLY_REPORT_PARENT_FOLDER_ID);
  var result = [];
  // Check subfolders too (reports may be organised by month)
  function scanFolder(f) {
    var files = f.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (file.getMimeType() === MimeType.GOOGLE_SHEETS) result.push(file);
    }
    var subs = f.getFolders();
    while (subs.hasNext()) scanFolder(subs.next());
  }
  scanFolder(folder);
  return result;
}

/**
 * Parse one weekly-report Google Sheet.
 * Expected sheet name pattern: "W18 2026 (28 Apr - 4 May)"
 * Expected column layout (first tab):
 *   type | brand | region | staff | count | util | hours | month | warnings
 * Types: promo / banner / crm / new_game / staff
 */
function parseYTDWeek_(file) {
  try {
    var ss = SpreadsheetApp.openById(file.getId());
    // Prefer a sheet whose name looks like a week label; fall back to first
    var sheets = ss.getSheets();
    var sheet = sheets[0];
    for (var s = 0; s < sheets.length; s++) {
      if (/W\d+\s+\d{4}/.test(sheets[s].getName())) { sheet = sheets[s]; break; }
    }
    var sheetName = sheet.getName(); // e.g. "W18 2026 (28 Apr - 4 May)"
    var labelMatch = sheetName.match(/W(\d+)\s+(\d{4})\s*\(([^)]+)\)/);
    var weekNum   = labelMatch ? parseInt(labelMatch[1]) : 0;
    var year      = labelMatch ? parseInt(labelMatch[2]) : new Date().getFullYear();
    var dateRange = labelMatch ? labelMatch[3] : sheetName;

    var lr = sheet.getLastRow(), lc = sheet.getLastColumn();
    if (lr < 2 || lc < 1) return null;
    var raw = sheet.getRange(1, 1, lr, lc).getValues();
    var headers = raw[0].map(function(h) { return String(h).trim().toLowerCase(); });

    function col(name) { return headers.indexOf(name); }

    var iType    = col('type');   if (iType < 0) iType = col('metric');
    var iBrand   = col('brand');  if (iBrand < 0) iBrand = col('platform');
    var iRegion  = col('region');
    var iStaff   = col('staff');  if (iStaff < 0) iStaff = col('name');
    var iCount   = col('count');  if (iCount < 0) iCount = col('value');
    var iUtil    = col('util');   if (iUtil < 0) iUtil = col('utilization'); if (iUtil < 0) iUtil = col('utilisation');
    var iHours   = col('hours');
    var iMonth   = col('month');
    var iWarn    = col('warnings'); if (iWarn < 0) iWarn = col('warning');

    var promoTotal = 0, promoByBrand = {}, promoByRegion = {};
    var bannersTotal = 0, bannersByRegion = {};
    var crmTotal = 0, crmByBrand = {};
    var newGamesTotal = 0, newGamesByRegion = {};
    var staff = {};
    var warnings = [];
    var month = '';

    for (var i = 1; i < raw.length; i++) {
      var row = raw[i];
      var type   = iType >= 0   ? String(row[iType] || '').toLowerCase().trim()  : '';
      var brand  = iBrand >= 0  ? String(row[iBrand] || '').trim()  : '';
      var region = iRegion >= 0 ? String(row[iRegion] || '').trim() : '';
      var count  = iCount >= 0  ? Number(row[iCount] || 0) : 0;
      var util   = iUtil >= 0   ? Number(row[iUtil] || 0) : 0;
      var hours  = iHours >= 0  ? Number(row[iHours] || 0) : 0;
      var sname  = iStaff >= 0  ? String(row[iStaff] || '').trim() : '';
      var warn   = iWarn >= 0   ? String(row[iWarn] || '').trim() : '';
      var mo     = iMonth >= 0  ? String(row[iMonth] || '').trim() : '';

      if (mo && !month) month = mo;
      if (warn) warnings.push(warn);

      if (type === 'promo' || type === 'promo_code' || type === 'promotion' || type === 'promotions') {
        promoTotal += count;
        if (brand)  promoByBrand[brand]   = (promoByBrand[brand]   || 0) + count;
        if (region) promoByRegion[region] = (promoByRegion[region] || 0) + count;
      } else if (type === 'banner' || type === 'banners') {
        bannersTotal += count;
        if (region) bannersByRegion[region] = (bannersByRegion[region] || 0) + count;
      } else if (type === 'crm' || type === 'crm_assignment' || type === 'crm_assignments') {
        crmTotal += count;
        if (brand) crmByBrand[brand] = (crmByBrand[brand] || 0) + count;
      } else if (type === 'new_game' || type === 'new_games' || type === 'game' || type === 'games') {
        newGamesTotal += count;
        if (region) newGamesByRegion[region] = (newGamesByRegion[region] || 0) + count;
      } else if (type === 'staff' || type === 'utilization' || type === 'utilisation') {
        if (sname) staff[sname] = { util: util, hours: hours };
      }
    }

    return {
      label:            sheetName,
      weekNum:          weekNum,
      year:             year,
      dateRange:        dateRange,
      month:            month,
      promoTotal:       promoTotal,
      promoByBrand:     promoByBrand,
      promoByRegion:    promoByRegion,
      bannersTotal:     bannersTotal,
      bannersByRegion:  bannersByRegion,
      crmTotal:         crmTotal,
      crmByBrand:       crmByBrand,
      newGamesTotal:    newGamesTotal,
      newGamesByRegion: newGamesByRegion,
      staff:            staff,
      warnings:         warnings
    };
  } catch(e) {
    return null;
  }
}
`;

codeGs += YTD_FUNCTIONS;

writeFileSync(path.join(OUT_DIR, 'Code.gs'), codeGs, 'utf8');
console.log('✓ Code.gs written  (' + codeGs.length + ' chars)');

// ── Patch Dashboard.html ───────────────────────────────────────────────────
let dashHtml = dashFile.source;

// Build the new enhanced viewReports() function
const NEW_VIEW_REPORTS = `function viewReports(){
  // Show loading state while we fetch YTD data
  document.getElementById('content').innerHTML=
    '<div style="display:flex;align-items:center;justify-content:center;padding:60px;color:#6b7280">'+
    '<div style="text-align:center"><div class="spinner" style="width:40px;height:40px;border:3px solid #e5e7eb;border-top-color:#4f7cff;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px"></div>'+
    '<div>Loading YTD analytics…</div></div></div>';

  // Task KPIs (always available from STATE)
  var d=STATE.data, c=d.counts||{}, tasks=d.tasks||[];
  var taskSummaryHtml=
    '<div class="section-header" style="margin-bottom:12px"><h3 style="font-size:14px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em">Task Pipeline</h3></div>'+
    '<div class="kpi-grid" style="margin-bottom:24px">'+
      kpiCard('new','Total Tasks',tasks.length,'📋',null)+
      kpiCard('ready','Completed',c.Completed||0,'✓','Completed')+
      kpiCard('approval','In Pipeline',(c.New||0)+(c.Validating||0)+(c.Ready_To_Execute||0),'⚡',null)+
      kpiCard('clarif','Need Attention',(c.Need_Clarification||0)+(c.Waiting_Approval||0),'💬','Need_Clarification')+
      kpiCard('done','Guest Reqs',((d.guestRequests||[]).length),'📥',null)+
      kpiCard('fail','Failed',c.Failed_Escalated||0,'✕','Failed_Escalated')+
    '</div>';

  // Fetch YTD data from server
  google.script.run
    .withSuccessHandler(function(ytd){ renderYTD(taskSummaryHtml, ytd); })
    .withFailureHandler(function(err){
      document.getElementById('content').innerHTML=
        taskSummaryHtml+
        '<div class="card"><div class="card-body" style="color:#ef4444;padding:20px">'+
        'YTD data unavailable: '+esc(String(err.message||err))+'</div></div>';
      bindKpiCards();
    })
    .serverGetYTD();
}

function renderYTD(taskSummaryHtml, ytd){
  var weeks=ytd.weeks||[];
  if(!weeks.length){
    document.getElementById('content').innerHTML=
      taskSummaryHtml+'<div class="card"><div class="card-body" style="color:#6b7280;padding:20px">No weekly report data found.</div></div>';
    bindKpiCards();
    return;
  }

  // ── Compute YTD totals ────────────────────────────────────────────────
  var ytdPromo=0,ytdBanners=0,ytdCrm=0,ytdGames=0;
  var latestWeek=weeks[weeks.length-1];
  weeks.forEach(function(w){ ytdPromo+=w.promoTotal||0; ytdBanners+=w.bannersTotal||0; ytdCrm+=w.crmTotal||0; ytdGames+=w.newGamesTotal||0; });

  // Prev week for delta
  var prevWeek=weeks.length>1?weeks[weeks.length-2]:null;
  function delta(curr,prev){ if(!prev||!curr)return ''; var d=curr-prev; return d>=0?'<span style="color:#10b981">▲'+d+'</span>':'<span style="color:#ef4444">▼'+Math.abs(d)+'</span>'; }

  // ── KPI cards ─────────────────────────────────────────────────────────
  var ytdKpis='<div class="section-header" style="margin-bottom:12px"><h3 style="font-size:14px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em">YTD Performance — '+weeks.length+' weeks</h3></div>'+
    '<div class="kpi-grid" style="margin-bottom:24px">'+
      ytdKpiCard('Promo Codes','🎯',ytdPromo,latestWeek.promoTotal,delta(latestWeek.promoTotal, prevWeek&&prevWeek.promoTotal))+
      ytdKpiCard('Banners','🖼',ytdBanners,latestWeek.bannersTotal,delta(latestWeek.bannersTotal, prevWeek&&prevWeek.bannersTotal))+
      ytdKpiCard('CRM Assigns','📨',ytdCrm,latestWeek.crmTotal,delta(latestWeek.crmTotal, prevWeek&&prevWeek.crmTotal))+
      ytdKpiCard('New Games','🎮',ytdGames,latestWeek.newGamesTotal,delta(latestWeek.newGamesTotal, prevWeek&&prevWeek.newGamesTotal))+
    '</div>';

  // ── Chart helpers ──────────────────────────────────────────────────────
  var chartId=0;
  function cid(){ return 'ytd-chart-'+(++chartId); }
  function chartCard(title, canvasId, heightPx){
    return '<div class="card" style="margin-bottom:16px"><div class="card-header"><h3>'+esc(title)+'</h3></div>'+
      '<div class="card-body" style="padding:16px"><canvas id="'+canvasId+'" height="'+(heightPx||220)+'"></canvas></div></div>';
  }

  var trendId=cid(), brandId=cid(), bannerId=cid(), crmId=cid(), staffId=cid();
  var chartsHtml=
    '<div class="section-header" style="margin-bottom:12px"><h3 style="font-size:14px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em">Trends</h3></div>'+
    chartCard('Promo Codes — Weekly Trend', trendId, 200)+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">'+
      chartCard('Promo by Brand (Latest Week)', brandId, 240)+
      chartCard('Banners by Region (Latest Week)', bannerId, 240)+
    '</div>'+
    chartCard('CRM Assignments — Weekly Trend', crmId, 180)+
    chartCard('Staff Utilisation (Latest Week)', staffId, 200);

  // ── Warnings ──────────────────────────────────────────────────────────
  var allWarnings=[];
  weeks.forEach(function(w){ (w.warnings||[]).forEach(function(wn){ if(wn) allWarnings.push(w.label+': '+wn); }); });
  var warnHtml='';
  if(allWarnings.length){
    warnHtml='<div class="card" style="border-left:4px solid #f59e0b;margin-bottom:16px"><div class="card-header" style="background:#fffbeb"><h3 style="color:#d97706">⚠ Data Warnings ('+allWarnings.length+')</h3></div>'+
      '<div class="card-body"><ul style="margin:0;padding-left:20px;font-size:12px;color:#92400e">'+
      allWarnings.slice(0,10).map(function(w){ return '<li>'+esc(w)+'</li>'; }).join('')+
      (allWarnings.length>10?'<li>…and '+(allWarnings.length-10)+' more</li>':'')+
      '</ul></div></div>';
  }

  document.getElementById('content').innerHTML=
    taskSummaryHtml + ytdKpis + warnHtml + chartsHtml;
  bindKpiCards();

  // ── Render charts after DOM is ready ──────────────────────────────────
  setTimeout(function(){ drawYTDCharts(weeks, trendId, brandId, bannerId, crmId, staffId); }, 50);
}

function ytdKpiCard(label, icon, ytdTotal, thisWeek, deltaHtml){
  return '<div class="kpi-card" style="cursor:default">'+
    '<div class="kpi-icon">'+icon+'</div>'+
    '<div class="kpi-body">'+
      '<div class="kpi-value">'+ytdTotal+'</div>'+
      '<div class="kpi-label">'+esc(label)+'</div>'+
      '<div style="font-size:11px;margin-top:4px;color:#6b7280">This week: '+thisWeek+' '+deltaHtml+'</div>'+
    '</div></div>';
}

function drawYTDCharts(weeks, trendId, brandId, bannerId, crmId, staffId){
  if(typeof Chart==='undefined'){ loadChartJs(function(){ drawYTDCharts(weeks,trendId,brandId,bannerId,crmId,staffId); }); return; }
  var labels=weeks.map(function(w){ return 'W'+w.weekNum; });
  var promoData=weeks.map(function(w){ return w.promoTotal||0; });
  var crmData=weeks.map(function(w){ return w.crmTotal||0; });
  var latestWeek=weeks[weeks.length-1];

  // Promo trend
  newChart(trendId,'line',labels,
    [{label:'Promo Codes',data:promoData,borderColor:'#4f7cff',backgroundColor:'rgba(79,124,255,.12)',tension:.3,fill:true,pointRadius:3}],
    {scales:{y:{beginAtZero:true}}});

  // Brand split (latest week)
  var brandKeys=Object.keys(latestWeek.promoByBrand||{});
  if(brandKeys.length){
    newChart(brandId,'bar',brandKeys,
      [{label:'Promo Codes',data:brandKeys.map(function(k){ return latestWeek.promoByBrand[k]||0; }),
        backgroundColor:'rgba(79,124,255,.7)',borderRadius:4}],
      {indexAxis:'y',scales:{x:{beginAtZero:true}}});
  }

  // Banners by region (latest week)
  var regKeys=Object.keys(latestWeek.bannersByRegion||{});
  if(regKeys.length){
    newChart(bannerId,'bar',regKeys,
      [{label:'Banners',data:regKeys.map(function(k){ return latestWeek.bannersByRegion[k]||0; }),
        backgroundColor:'rgba(16,185,129,.7)',borderRadius:4}],
      {scales:{y:{beginAtZero:true}}});
  }

  // CRM trend
  newChart(crmId,'bar',labels,
    [{label:'CRM Assignments',data:crmData,backgroundColor:'rgba(108,93,211,.7)',borderRadius:3}],
    {scales:{y:{beginAtZero:true}}});

  // Staff utilisation (latest week)
  var staffNames=Object.keys(latestWeek.staff||{});
  if(staffNames.length){
    newChart(staffId,'bar',staffNames,
      [{label:'Utilisation %',data:staffNames.map(function(n){ return latestWeek.staff[n].util||0; }),
        backgroundColor:'rgba(245,158,11,.7)',borderRadius:4}],
      {scales:{y:{beginAtZero:true,max:100}}});
  }
}

var _chartJsLoaded=false, _chartJsCbs=[];
function loadChartJs(cb){
  if(_chartJsLoaded){ cb(); return; }
  _chartJsCbs.push(cb);
  if(_chartJsCbs.length>1) return; // already loading
  var s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
  s.onload=function(){ _chartJsLoaded=true; _chartJsCbs.forEach(function(fn){ fn(); }); _chartJsCbs=[]; };
  document.head.appendChild(s);
}

var _charts={};
function newChart(id, type, labels, datasets, opts){
  var canvas=document.getElementById(id);
  if(!canvas) return;
  if(_charts[id]){ _charts[id].destroy(); delete _charts[id]; }
  _charts[id]=new Chart(canvas,{
    type:type,
    data:{labels:labels, datasets:datasets},
    options:Object.assign({responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:datasets.length>1}},animation:{duration:400}}, opts||{})
  });
}`;

// Replace the old viewReports() function in the Dashboard HTML
// Find the exact function boundary
const viewReportsStart = dashHtml.indexOf('function viewReports(){');
const barChartStart    = dashHtml.indexOf('function barChart(obj){');

if (viewReportsStart < 0 || barChartStart < 0) {
  console.error('Could not locate viewReports() / barChart() in Dashboard.html — aborting.');
  process.exit(1);
}

// We replace from viewReports start up to (but not including) barChart
dashHtml =
  dashHtml.slice(0, viewReportsStart) +
  NEW_VIEW_REPORTS + '\n' +
  dashHtml.slice(barChartStart);

// Add @keyframes spin (needed for loading spinner) before </style>
const spinKeyframes = `
@keyframes spin { to { transform: rotate(360deg); } }
`;
dashHtml = dashHtml.replace('</style>', spinKeyframes + '</style>');

writeFileSync(path.join(OUT_DIR, 'Dashboard.html'), dashHtml, 'utf8');
console.log('✓ Dashboard.html written  (' + dashHtml.length + ' chars)');

// ── Write GuestPortal.html ─────────────────────────────────────────────────
writeFileSync(path.join(OUT_DIR, 'GuestPortal.html'), guestFile.source, 'utf8');
console.log('✓ GuestPortal.html written  (' + guestFile.source.length + ' chars)');

// ── Write appsscript.json ──────────────────────────────────────────────────
// Must include script.projects scope for API deployment
const manifest = {
  timeZone: 'Asia/Singapore',
  dependencies: {},
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: {
    executeAs: 'USER_DEPLOYING',
    access: 'ANYONE_ANONYMOUS'
  },
  oauthScopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/script.external_request'
  ]
};
writeFileSync(path.join(OUT_DIR, 'appsscript.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('✓ appsscript.json written');

console.log('\nAll files written to:', OUT_DIR);
console.log('\nThe Control Tower deployment path has been retired; these files are not deployed.');
