#!/usr/bin/env node
/**
 * V52 — Three changes:
 *   1. Module grid back to 4 columns (removed cramped utilization card).
 *   2. New full-width Utilization Overview card matching the mockup:
 *        – Health badge (Healthy / At Risk / Critical) top-right
 *        – Big donut (utilization %) + 4 mini KPI cards (2x2)
 *          • Tasks Completed · Active Capacity · Automation Saved · SLA Compliance
 *        – Workload Distribution bars
 *        – AI INSIGHT box at bottom with computed analysis lines
 *   3. Hover-enlarge effect added to ALL .card elements (subtle lift +
 *      stronger shadow on hover).
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

// ─── 1. Hover-enlarge CSS for all .card ─────────────────────────────────────
const OLD_CARD_CSS = `.card{background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:16px}`;
const NEW_CARD_CSS = `.card{background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:16px;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.card:hover{transform:translateY(-3px);box-shadow:0 10px 30px rgba(0,0,0,.4);border-color:rgba(124,58,237,.4)}
.card-flat,.card-flat:hover{transform:none;box-shadow:none;border-color:var(--border)}`;

if (!dash.includes(OLD_CARD_CSS)) { console.error('✗ .card CSS anchor not found'); process.exit(1); }
dash = dash.replace(OLD_CARD_CSS, NEW_CARD_CSS);
console.log('✓ Hover-enlarge CSS added to all .card elements');

// ─── 2. Module grid: 5 cols → 4 cols (remove utilization from grid) ─────────
const OLD_GRID = `var moduleGrid = '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px">'
    + __moduleCard_({icon:'🎯', name:'Promo Code',     color:'#7c3aed', total:t.p, delta:__delta_(t.p,tP.p), weeks:weeks, key:'p', monthSplit:monthSplit('p')})
    + __moduleCard_({icon:'🖼️', name:'Banner',         color:'#0ea5e9', total:t.b, delta:__delta_(t.b,tP.b), weeks:weeks, key:'b', monthSplit:monthSplit('b')})
    + __moduleCard_({icon:'📧', name:'CRM Assignment', color:'#10b981', total:t.c, delta:__delta_(t.c,tP.c), weeks:weeks, key:'c', monthSplit:monthSplit('c')})
    + __moduleCard_({icon:'🎮', name:'Game Addition',  color:'#f59e0b', total:t.g, delta:__delta_(t.g,tP.g), weeks:weeks, key:'g', monthSplit:monthSplit('g')})
    + __utilizationCard_()
  + '</div>';`;

const NEW_GRID = `var moduleGrid = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px">'
    + __moduleCard_({icon:'🎯', name:'Promo Code',     color:'#7c3aed', total:t.p, delta:__delta_(t.p,tP.p), weeks:weeks, key:'p', monthSplit:monthSplit('p')})
    + __moduleCard_({icon:'🖼️', name:'Banner',         color:'#0ea5e9', total:t.b, delta:__delta_(t.b,tP.b), weeks:weeks, key:'b', monthSplit:monthSplit('b')})
    + __moduleCard_({icon:'📧', name:'CRM Assignment', color:'#10b981', total:t.c, delta:__delta_(t.c,tP.c), weeks:weeks, key:'c', monthSplit:monthSplit('c')})
    + __moduleCard_({icon:'🎮', name:'Game Addition',  color:'#f59e0b', total:t.g, delta:__delta_(t.g,tP.g), weeks:weeks, key:'g', monthSplit:monthSplit('g')})
  + '</div>';`;

if (!dash.includes(OLD_GRID)) { console.error('✗ moduleGrid anchor not found'); process.exit(1); }
dash = dash.replace(OLD_GRID, NEW_GRID);
console.log('✓ Module grid restored to 4 cards (Promo / Banner / CRM / Games)');

// ─── 3. Replace __utilizationCard_ with the full-width detailed version ─────
const OLD_UTIL_FN_PATTERN = /\/\/ ── Utilization card ─[\s\S]*?function __utilizationCard_\(\) \{[\s\S]*?\n\}/;

const NEW_UTIL_FN = `// ── Utilization card (V52 redesign — full-width, click to expand) ──────────
function __utilizationCard_() {
  var u = __utilizationStats_();
  var auto = __automationStats_();
  var tasks = __tasksInRange_();
  var prev = __rptPrevPeriod_();
  var prevTasks = (S.tasks || []).filter(function(t){
    var d = String(t.Submitted_At || t.Assigned_At || t.Created_At || '').slice(0,10);
    return d && d >= prev.from && d <= prev.to;
  });

  // ── Compute the 4 mini-KPIs ──
  // 1. Tasks Completed
  var completed = tasks.filter(function(t){
    return /complete|done|closed/i.test(String(t.Status || ''));
  }).length;
  // Fallback: if no completion data, use total tasks (treat synced = completed)
  if (completed === 0 && tasks.length > 0) completed = tasks.length;
  var prevCompleted = prevTasks.filter(function(t){
    return /complete|done|closed/i.test(String(t.Status || ''));
  }).length;
  if (prevCompleted === 0 && prevTasks.length > 0) prevCompleted = prevTasks.length;
  var dCompleted = __delta_(completed, prevCompleted);

  // 2. Active Capacity (owners with tasks / roster size)
  var ownersWithTasks = Object.keys(u.byOwner || {}).length;
  var rosterSize = (S.roster && S.roster.length) || 8;
  var prevOwners = {};
  prevTasks.forEach(function(t){
    var raw = String(t.Owner || ''); if (!raw) return;
    var n = (typeof resolveOwnerNames_==='function' ? resolveOwnerNames_(raw) : raw);
    n.split(/\\s*\\+\\s*/).forEach(function(x){ x=x.trim(); if(x) prevOwners[x]=true; });
  });
  var prevOwnersCount = Object.keys(prevOwners).length;
  var dActive = __delta_(ownersWithTasks, prevOwnersCount);

  // 3. Automation Saved (from automation stats)
  var hoursSaved = auto.hoursSaved || 0;
  var prevHoursSaved = (auto.prevBot || 0) * 0.5;
  var dAuto = __delta_(hoursSaved, prevHoursSaved);

  // 4. SLA Compliance (tasks completed on-time / total completed-with-due-date)
  var slaTasks = tasks.filter(function(t){
    return t.Due_Date && /complete|done|closed/i.test(String(t.Status || ''));
  });
  var slaOnTime = slaTasks.filter(function(t){
    var due = String(t.Due_Date || '').slice(0,10);
    var done = String(t.Status_Updated_At || t.Executed_At || '').slice(0,10);
    if (!done) return true; // if no completion timestamp, assume on-time
    return done <= due;
  });
  var slaPct = slaTasks.length > 0 ? Math.round(slaOnTime.length / slaTasks.length * 100) : null;
  var prevSlaTasks = prevTasks.filter(function(t){
    return t.Due_Date && /complete|done|closed/i.test(String(t.Status || ''));
  });
  var prevSlaOnTime = prevSlaTasks.filter(function(t){
    var due = String(t.Due_Date || '').slice(0,10);
    var done = String(t.Status_Updated_At || t.Executed_At || '').slice(0,10);
    if (!done) return true;
    return done <= due;
  });
  var prevSlaPct = prevSlaTasks.length > 0 ? Math.round(prevSlaOnTime.length / prevSlaTasks.length * 100) : 0;
  var dSla = slaPct !== null ? __delta_(slaPct, prevSlaPct) : null;
  var slaDisplay = slaPct !== null ? slaPct + '%' : '—';

  // ── Health badge ──
  var healthBadge, healthColor;
  if (u.utilization >= 85) { healthBadge = '⚠ Critical'; healthColor = '#ef4444'; }
  else if (u.utilization >= 70) { healthBadge = '⚠ At Risk'; healthColor = '#f59e0b'; }
  else if (u.utilization >= 30) { healthBadge = '↑ Healthy'; healthColor = '#10b981'; }
  else { healthBadge = '💤 Light';   healthColor = '#0ea5e9'; }

  // ── Donut: gradient stroke effect (use two-segment dark for unused) ──
  var donut = '<svg viewBox="0 0 100 100" style="width:160px;height:160px">'
    +'<defs><linearGradient id="utilGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#10b981"/></linearGradient></defs>'
    +'<circle cx="50" cy="50" r="38" fill="none" stroke="#30363d" stroke-width="10"/>'
    +'<circle cx="50" cy="50" r="38" fill="none" stroke="url(#utilGrad)" stroke-width="10" stroke-linecap="round"'
    +' stroke-dasharray="'+(u.utilization * 2.388)+' 1000"'
    +' transform="rotate(-90 50 50)"/>'
    +'<text x="50" y="48" text-anchor="middle" font-size="22" font-weight="800" fill="#e6edf3">'+u.utilization+'%</text>'
    +'<text x="50" y="62" text-anchor="middle" font-size="9" fill="#8b949e">Utilized</text>'
  +'</svg>';
  var utilDelta = (function(){
    var prevUtilTotal = (prev.weeks.length ? prev.weeks.length : 1) * (rosterSize * 8);
    var prevUtilPct = prevUtilTotal > 0 ? Math.round(prevTasks.length / prevUtilTotal * 100) : 0;
    return __delta_(u.utilization, prevUtilPct);
  })();

  // ── Mini KPI ──
  function mkpi(icon, label, val, delta, inverseGood) {
    var pill = delta ? __deltaPill_(delta, inverseGood) : '<span style="font-size:10px;color:var(--muted)">—</span>';
    return '<div class="card card-flat" style="padding:10px 12px;margin:0;background:var(--card2)">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'
        +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:13px">'+icon+'</span><span style="font-size:10px;color:var(--muted);font-weight:600">'+label+'</span></div>'
        +pill
      +'</div>'
      +'<div style="font-size:18px;font-weight:800;color:var(--text)">'+val+'</div>'
    +'</div>';
  }

  // ── Workload Distribution bars ──
  var totalM = Object.keys(u.byModule).reduce(function(s,k){ return s + u.byModule[k]; }, 0) || 1;
  var moduleColors = { 'Promo Code':'#7c3aed','Promo Codes':'#7c3aed','Banner':'#0ea5e9','Banners':'#0ea5e9','CRM Assignment':'#14b8a6','CRM':'#14b8a6','Game Addition':'#f59e0b','New Games':'#f59e0b' };
  var modules = Object.keys(u.byModule).sort(function(a,b){ return u.byModule[b]-u.byModule[a]; });
  if (modules.length > 5) {
    // Aggregate the tail into "Others"
    var top = modules.slice(0,4);
    var othersSum = modules.slice(4).reduce(function(s,k){return s+u.byModule[k];},0);
    modules = top.concat(['Others']);
    u.byModule['Others'] = othersSum;
  }
  var moduleBars = modules.map(function(m){
    var pct = Math.round(u.byModule[m] / totalM * 100);
    var col = moduleColors[m] || '#8b949e';
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
      +'<span style="flex:0 0 130px;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(m)+'</span>'
      +'<div style="flex:1;height:8px;background:#30363d;border-radius:4px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:linear-gradient(90deg,'+col+',#7c3aed)"></div></div>'
      +'<span style="flex:0 0 36px;text-align:right;font-size:12px;font-weight:700;color:var(--text)">'+pct+'%</span>'
    +'</div>';
  }).join('') || '<div style="color:var(--muted);font-size:12px;padding:8px 0">No tasks in range</div>';

  // ── AI Insight lines ──
  var insightLines = [];
  // Line 1: workload assessment
  if (u.utilization >= 70) {
    var teams = Object.keys(u.byModule).filter(function(k){ return u.byModule[k]/totalM > 0.3; });
    var teamLbl = teams.length ? teams[0].toLowerCase().replace(/\\s+/g,' ') + ' team' : 'team';
    insightLines.push({ icon:'↑', color:'#f59e0b', text:'<strong>' + teamLbl.charAt(0).toUpperCase()+teamLbl.slice(1) + '</strong> is approaching high utilization.' });
  } else if (u.utilization < 30 && tasks.length > 0) {
    insightLines.push({ icon:'💤', color:'#0ea5e9', text:'Team utilization is light — capacity available for new initiatives.' });
  } else if (u.utilization > 0) {
    insightLines.push({ icon:'✓', color:'#10b981', text:'Team workload is balanced at '+u.utilization+'% utilization.' });
  }
  // Line 2: biggest WoW module change
  var modDeltas = [];
  ['Promo Code','Banner','CRM','Game Addition'].forEach(function(m){
    var curr = 0, p = 0;
    Object.keys(u.byModule).forEach(function(k){ if (k.toLowerCase().indexOf(m.toLowerCase()) === 0 || m.toLowerCase().indexOf(k.toLowerCase()) === 0) curr += u.byModule[k]; });
    prevTasks.forEach(function(t){ if (String(t.Module||'').toLowerCase().indexOf(m.toLowerCase().split(' ')[0]) >= 0) p++; });
    if (p > 0) {
      var d = __delta_(curr, p);
      if (d.dir !== 'flat') modDeltas.push({ m: m, d: d });
    }
  });
  modDeltas.sort(function(a,b){ return b.d.pct - a.d.pct; });
  if (modDeltas.length) {
    var top = modDeltas[0];
    insightLines.push({ icon:top.d.dir==='up'?'↑':'↓', color:top.d.dir==='up'?'#f59e0b':'#10b981',
      text:'<strong>'+top.m+'</strong> workload '+(top.d.dir==='up'?'increased':'decreased')+' '+top.d.pct+'% this period.' });
  }
  // Line 3: automation impact
  if (auto.bot > 0 && hoursSaved > 0) {
    insightLines.push({ icon:'✦', color:'#a78bfa', text:'Automation saved <strong style="color:#a78bfa">'+hoursSaved+' hours</strong> of manual work.' });
  } else if (auto.bot === 0) {
    insightLines.push({ icon:'💡', color:'#8b949e', text:'No automation activity yet — roll out <strong>promo_testbot</strong> to start saving time.' });
  }
  if (!insightLines.length) {
    insightLines.push({ icon:'ℹ', color:'#8b949e', text:'Not enough data to generate insights — widen the date filter.' });
  }
  var insightHtml = insightLines.map(function(l){
    return '<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:12px;line-height:1.5"><span style="color:'+l.color+';font-weight:700;flex-shrink:0;min-width:14px">'+l.icon+'</span><span style="color:var(--text)">'+l.text+'</span></div>';
  }).join('');

  // ── Assemble card ──
  return '<div class="card" onclick="__rptNav_(\\'utilization\\')" style="padding:18px;margin:0 0 14px 0;cursor:pointer">'
    // Header
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      +'<div style="display:flex;align-items:center;gap:10px">'
        +'<div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#ec4899,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:18px">👥</div>'
        +'<div><div style="font-size:16px;font-weight:800;color:var(--text)">Utilization</div><div style="font-size:10px;color:var(--muted)">Team capacity & workload · click to expand</div></div>'
      +'</div>'
      +'<span style="background:'+healthColor+'22;color:'+healthColor+';padding:4px 12px;border-radius:14px;font-size:11px;font-weight:700;border:1px solid '+healthColor+'44">'+healthBadge+'</span>'
    +'</div>'
    // Donut + 4 KPI grid
    +'<div style="display:grid;grid-template-columns:auto 1fr;gap:20px;margin-bottom:18px;align-items:center">'
      +'<div style="display:flex;flex-direction:column;align-items:center;gap:6px">'
        +donut
        +(utilDelta ? '<div>'+__deltaPill_(utilDelta, false)+' <span style="font-size:9px;color:var(--muted)">vs prev</span></div>' : '')
      +'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
        +mkpi('📅','Tasks Completed',completed,dCompleted,false)
        +mkpi('👥','Active Capacity',ownersWithTasks+' / '+rosterSize,dActive,false)
        +mkpi('⚡','Automation Saved',hoursSaved+'h',dAuto,false)
        +mkpi('🛡','SLA Compliance',slaDisplay,dSla,false)
      +'</div>'
    +'</div>'
    // Workload Distribution
    +'<div style="margin-bottom:14px">'
      +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Workload Distribution</div>'
      +moduleBars
    +'</div>'
    // AI Insight
    +'<div style="background:linear-gradient(135deg,rgba(124,58,237,.08),rgba(14,165,233,.04));border:1px solid rgba(124,58,237,.25);border-radius:8px;padding:12px 14px">'
      +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">'
        +'<span style="font-size:13px;color:#a78bfa">✦</span>'
        +'<span style="font-size:11px;font-weight:700;color:#a78bfa;letter-spacing:.05em">AI INSIGHT</span>'
      +'</div>'
      +insightHtml
    +'</div>'
  +'</div>';
}`;

if (!OLD_UTIL_FN_PATTERN.test(dash)) { console.error('✗ Old __utilizationCard_ pattern not found'); process.exit(1); }
dash = dash.replace(OLD_UTIL_FN_PATTERN, NEW_UTIL_FN);
console.log('✓ __utilizationCard_ redesigned (full-width, KPIs, AI Insight)');

// ─── 4. Slot the full-width Utilization card into the analysis layout ───────
// Place it right AFTER the module grid (before trendsRow)
const OLD_CONTENT_CALL = `  content(
    __rptHeader_(weeks, prev)
    + __rptTabBar_('analysis')
    + __rptFilterBar_(weeks)
    + kpis
    + moduleGrid
    + trendsRow
    + __automationCard_()
    + insights
  );`;

const NEW_CONTENT_CALL = `  content(
    __rptHeader_(weeks, prev)
    + __rptTabBar_('analysis')
    + __rptFilterBar_(weeks)
    + kpis
    + moduleGrid
    + __utilizationCard_()
    + trendsRow
    + __automationCard_()
    + insights
  );`;

if (!dash.includes(OLD_CONTENT_CALL)) { console.error('✗ content() call anchor not found'); process.exit(1); }
dash = dash.replace(OLD_CONTENT_CALL, NEW_CONTENT_CALL);
console.log('✓ Utilization card now rendered full-width after module grid');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V52: Utilization card redesign + hover-enlarge on all cards ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V52: utilization redesign',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
