#!/usr/bin/env node
/**
 * V50 — Full Utilization Overview module under Reports.
 *
 *   • New sub-tab "🎯 Utilization" in the Reports tab bar.
 *   • The compact Utilization card in Executive Summary is now clickable
 *     and opens the new module.
 *   • New view renders matching the reference screenshot:
 *       – Big overall-utilization donut + 4 metric cards (capacity,
 *         scheduled members, logged hours, available hours) with WoW
 *         delta pills.
 *       – Workload Distribution bars (by module).
 *       – Time Breakdown donut (Focus / Meeting / Admin / Idle).
 *       – Team Utilization table — per-owner rows with util bar, hours,
 *         workload pill, trend sparkline + delta.
 *       – AI Insight banner + "View Full Report" CTA.
 *
 * Data: estimated from S.tasks (task count × HOURS_PER_TASK).
 *  HOURS_PER_TASK = 1.5h  |  WEEKLY_CAPACITY = 40h/person
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

// ─── 1. Update __rptTabBar_ to include Utilization tab ──────────────────────
const OLD_TAB_BAR = `function __rptTabBar_(active) {
  var a='padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;background:var(--accent);color:#fff';
  var i='padding:7px 14px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;background:var(--card2);color:var(--muted)';
  return '<div style="display:flex;gap:8px;margin-bottom:14px">'
    +'<button onclick="__rptNav_(\\'analysis\\')" style="'+(active==='analysis'?a:i)+'">📊 Executive Summary</button>'
    +'<button onclick="__rptNav_(\\'detail\\')" style="'+(active==='detail'?a:i)+'">📋 All Details</button>'
    +'<button onclick="__rptNav_(\\'files\\')" style="'+(active==='files'?a:i)+'">📁 Weekly Files</button>'
    +'</div>';
}`;

const NEW_TAB_BAR = `function __rptTabBar_(active) {
  var a='padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;background:var(--accent);color:#fff';
  var i='padding:7px 14px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;background:var(--card2);color:var(--muted)';
  return '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">'
    +'<button onclick="__rptNav_(\\'analysis\\')" style="'+(active==='analysis'?a:i)+'">📊 Executive Summary</button>'
    +'<button onclick="__rptNav_(\\'utilization\\')" style="'+(active==='utilization'?a:i)+'">👥 Utilization</button>'
    +'<button onclick="__rptNav_(\\'detail\\')" style="'+(active==='detail'?a:i)+'">📋 All Details</button>'
    +'<button onclick="__rptNav_(\\'files\\')" style="'+(active==='files'?a:i)+'">📁 Weekly Files</button>'
    +'</div>';
}`;

if (!dash.includes(OLD_TAB_BAR)) { console.error('✗ __rptTabBar_ anchor not found'); process.exit(1); }
dash = dash.replace(OLD_TAB_BAR, NEW_TAB_BAR);
console.log('✓ Tab bar: added Utilization sub-tab');

// ─── 2. Update __rptNav_ to handle 'utilization' tab ────────────────────────
const OLD_NAV = `function __rptNav_(tab) {
  __rptTab = tab;
  if (tab==='analysis') renderReports_analysis_();
  else if (tab==='detail') renderReports_detail_();
  else renderReports_files_(__cachedRptFiles);
}`;

const NEW_NAV = `function __rptNav_(tab) {
  __rptTab = tab;
  if (tab==='analysis') renderReports_analysis_();
  else if (tab==='utilization') renderReports_utilization_();
  else if (tab==='detail') renderReports_detail_();
  else renderReports_files_(__cachedRptFiles);
}`;

if (!dash.includes(OLD_NAV)) { console.error('✗ __rptNav_ anchor not found'); process.exit(1); }
dash = dash.replace(OLD_NAV, NEW_NAV);
console.log('✓ __rptNav_ handles utilization tab');

// ─── 3. Make the compact Utilization card clickable ─────────────────────────
// Wrap the card opening div with cursor:pointer + onclick
const OLD_UTIL_CARD_OPEN = `  return '<div class="card" style="padding:14px;margin:0;display:flex;flex-direction:column">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
      +'<div style="width:32px;height:32px;border-radius:8px;background:#ec489922;display:flex;align-items:center;justify-content:center;font-size:16px">👥</div>'
      +'<div style="font-size:14px;font-weight:700;color:var(--text)">Utilization</div>'
    +'</div>'`;

const NEW_UTIL_CARD_OPEN = `  return '<div class="card" onclick="__rptNav_(\\'utilization\\')" style="padding:14px;margin:0;display:flex;flex-direction:column;cursor:pointer;transition:transform .15s,box-shadow .15s" onmouseover="this.style.transform=\\'translateY(-2px)\\';this.style.boxShadow=\\'0 6px 18px rgba(236,72,153,.2)\\'" onmouseout="this.style.transform=\\'\\';this.style.boxShadow=\\'\\'">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;justify-content:space-between">'
      +'<div style="display:flex;align-items:center;gap:8px">'
        +'<div style="width:32px;height:32px;border-radius:8px;background:#ec489922;display:flex;align-items:center;justify-content:center;font-size:16px">👥</div>'
        +'<div style="font-size:14px;font-weight:700;color:var(--text)">Utilization</div>'
      +'</div>'
      +'<span style="font-size:14px;color:var(--muted)">→</span>'
    +'</div>'`;

if (!dash.includes(OLD_UTIL_CARD_OPEN)) { console.error('✗ Utilization card open anchor not found'); process.exit(1); }
dash = dash.replace(OLD_UTIL_CARD_OPEN, NEW_UTIL_CARD_OPEN);
console.log('✓ Utilization card is now clickable + arrow indicator');

// ─── 4. Add renderReports_utilization_ function ─────────────────────────────
// Insert just before renderReports_detail_
const UTIL_FN = `
// ─── UTILIZATION OVERVIEW module ────────────────────────────────────────────
function __weeklyCountsForOwner_(name, numWeeks) {
  // Returns array of per-week task counts for the last numWeeks
  if (numWeeks == null) numWeeks = 8;
  var weeks = [];
  var to   = new Date(__rptFilter.to   + 'T00:00:00Z');
  for (var i = numWeeks-1; i >= 0; i--) {
    var end   = new Date(to.getTime() - i*7*86400000);
    var start = new Date(end.getTime() - 6*86400000);
    weeks.push({ s: start.toISOString().slice(0,10), e: end.toISOString().slice(0,10), n: 0 });
  }
  (S.tasks || []).forEach(function(t){
    var raw = String(t.Owner || '');
    if (!raw) return;
    var n = (typeof resolveOwnerNames_ === 'function' ? resolveOwnerNames_(raw) : raw);
    var match = n.split(/\\s*\\+\\s*/).some(function(x){ return x.trim().toLowerCase() === name.toLowerCase(); });
    if (!match) return;
    var d = String(t.Submitted_At || t.Assigned_At || t.Created_At || '').slice(0,10);
    if (!d) return;
    for (var i = 0; i < weeks.length; i++) {
      if (d >= weeks[i].s && d <= weeks[i].e) { weeks[i].n++; break; }
    }
  });
  return weeks.map(function(w){ return w.n; });
}

function __teamLabel_(modulesMap) {
  // Pick the dominant module for an owner, map to team label
  var maxK = '', maxV = 0;
  Object.keys(modulesMap).forEach(function(k){ if (modulesMap[k] > maxV) { maxV = modulesMap[k]; maxK = k; } });
  if (/promo/i.test(maxK)) return 'Promo Ops';
  if (/banner/i.test(maxK)) return 'Banner Team';
  if (/crm/i.test(maxK))   return 'CRM Team';
  if (/game/i.test(maxK))  return 'Game Team';
  if (/translat/i.test(maxK)) return 'Translation Team';
  return maxK || 'Team';
}

function __ownerColor_(name) {
  // Deterministic color from name
  var palette = ['#7c3aed','#0ea5e9','#10b981','#f59e0b','#ec4899','#14b8a6','#a78bfa','#22d3ee'];
  var h = 0; for (var i = 0; i < name.length; i++) h = (h*31 + name.charCodeAt(i)) & 0xffffff;
  return palette[Math.abs(h) % palette.length];
}

function __ownerInitials_(name) {
  var parts = String(name).trim().split(/\\s+/);
  if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
}

function renderReports_utilization_() {
  __rptTab = 'utilization';

  var HOURS_PER_TASK = 1.5;
  var WEEKLY_CAPACITY = 40;
  var weeks = Math.max(1, __rptFilteredWeeks_().length);
  var capacityPerOwner = weeks * WEEKLY_CAPACITY;

  // Aggregate by owner
  var tasks = __tasksInRange_();
  var prev  = __rptPrevPeriod_();
  var prevTasks = (S.tasks || []).filter(function(t){
    var d = String(t.Submitted_At || t.Assigned_At || t.Created_At || '').slice(0,10);
    return d && d >= prev.from && d <= prev.to;
  });

  var byOwner = {};
  tasks.forEach(function(t){
    var raw = String(t.Owner || ''); if (!raw) return;
    var n = (typeof resolveOwnerNames_ === 'function' ? resolveOwnerNames_(raw) : raw);
    n.split(/\\s*\\+\\s*/).forEach(function(x){
      x = x.trim(); if (!x) return;
      if (!byOwner[x]) byOwner[x] = { name: x, count: 0, prevCount: 0, modules: {} };
      byOwner[x].count++;
      var m = t.Module || 'Other'; byOwner[x].modules[m] = (byOwner[x].modules[m] || 0) + 1;
    });
  });
  prevTasks.forEach(function(t){
    var raw = String(t.Owner || ''); if (!raw) return;
    var n = (typeof resolveOwnerNames_ === 'function' ? resolveOwnerNames_(raw) : raw);
    n.split(/\\s*\\+\\s*/).forEach(function(x){
      x = x.trim(); if (!x) return;
      if (byOwner[x]) byOwner[x].prevCount++;
    });
  });

  // Compute per-owner metrics + sort by utilization desc
  var owners = Object.keys(byOwner).map(function(k){
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
  }).sort(function(a,b){ return b.utilization - a.utilization; });

  // Team-wide totals
  var teamSize = (S.roster && S.roster.length) || owners.length || 8;
  var totalLogged = owners.reduce(function(s,o){return s+o.logged;},0);
  var totalCapacity = teamSize * weeks * WEEKLY_CAPACITY;
  var overallUtil = totalCapacity > 0 ? Math.round(totalLogged / totalCapacity * 100) : 0;
  var availableHours = Math.max(0, totalCapacity - totalLogged);
  var scheduled = owners.length;

  // Prev period totals (for delta pills)
  var prevByOwner = {};
  prevTasks.forEach(function(t){
    var raw = String(t.Owner || ''); if (!raw) return;
    var n = (typeof resolveOwnerNames_ === 'function' ? resolveOwnerNames_(raw) : raw);
    n.split(/\\s*\\+\\s*/).forEach(function(x){
      x = x.trim(); if (!x) return;
      prevByOwner[x] = (prevByOwner[x] || 0) + 1;
    });
  });
  var prevTotalLogged = Object.keys(prevByOwner).reduce(function(s,k){ return s + prevByOwner[k] * HOURS_PER_TASK; }, 0);
  var prevScheduled = Object.keys(prevByOwner).length;
  var prevCapacity = teamSize * weeks * WEEKLY_CAPACITY;
  var prevAvailable = Math.max(0, prevCapacity - prevTotalLogged);

  var dCap   = __delta_(totalCapacity, prevCapacity);
  var dSched = __delta_(scheduled, prevScheduled);
  var dLog   = __delta_(totalLogged, prevTotalLogged);
  var dAvail = __delta_(availableHours, prevAvailable);

  // Module workload distribution
  var byModule = {};
  tasks.forEach(function(t){ var m = t.Module || 'Other'; byModule[m] = (byModule[m] || 0) + 1; });
  var totalMod = Object.keys(byModule).reduce(function(s,k){ return s + byModule[k]; }, 0) || 1;
  var moduleColors = { 'Promo Code':'#7c3aed', 'Promo Codes':'#7c3aed', 'Banner':'#0ea5e9', 'Banners':'#0ea5e9', 'CRM Assignment':'#14b8a6', 'CRM':'#14b8a6', 'Game Addition':'#f59e0b', 'New Games':'#f59e0b' };
  var moduleEntries = Object.keys(byModule).map(function(m){ return { m: m, n: byModule[m], pct: Math.round(byModule[m]/totalMod*100), col: moduleColors[m] || '#8b949e' }; }).sort(function(a,b){return b.n-a.n;});

  // Time breakdown — estimated using fixed proportions over scheduled hours
  var focusH   = Math.round(totalLogged * 10) / 10;
  var meetingH = Math.round(totalCapacity * 0.21 * 10) / 10;
  var adminH   = Math.round(totalCapacity * 0.13 * 10) / 10;
  var idleH    = Math.max(0, Math.round((totalCapacity - focusH - meetingH - adminH) * 10) / 10);
  var totalBreakdown = focusH + meetingH + adminH + idleH;
  function pctOf(v){ return totalBreakdown > 0 ? Math.round(v / totalBreakdown * 100) : 0; }

  // ── Build HTML ──
  // Header card
  var utilBadge = overallUtil >= 75 ? '<span style="background:#ef444433;color:#ef4444;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600">High</span>'
                 : overallUtil >= 40 ? '<span style="background:#7c3aed33;color:#a78bfa;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600">Moderate</span>'
                 : '<span style="background:#0ea5e933;color:#0ea5e9;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600">Light</span>';

  var bigDonut = __svgDonut_([overallUtil, 100-overallUtil], ['#7c3aed','#30363d'], overallUtil, 180);
  bigDonut = bigDonut.replace(/<text x="50" y="48"[^>]*>\\d+<\\/text>/, '<text x="50" y="48" text-anchor="middle" font-size="22" font-weight="800" fill="#e6edf3">'+overallUtil+'%</text>');
  bigDonut = bigDonut.replace(/<text x="50" y="64"[^>]*>Total<\\/text>/, '<text x="50" y="62" text-anchor="middle" font-size="8" fill="#8b949e">Overall</text>');

  function metricCard(icon, label, val, sub, delta, inverseGood) {
    var pill = delta ? __deltaPill_(delta, inverseGood) : '';
    return '<div style="flex:1;min-width:0">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
        +'<div style="width:28px;height:28px;border-radius:6px;background:#7c3aed22;display:flex;align-items:center;justify-content:center;font-size:14px">'+icon+'</div>'
        +'<div style="font-size:11px;color:var(--muted);font-weight:600">'+label+'</div>'
      +'</div>'
      +'<div style="font-size:22px;font-weight:800;color:var(--text);line-height:1.1">'+val+'</div>'
      +'<div style="font-size:10px;color:var(--muted);margin-bottom:4px">'+sub+'</div>'
      +'<div>'+pill+'</div>'
    +'</div>';
  }

  var topCard = '<div class="card" style="padding:18px;margin:0 0 14px 0">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">'
      +'<div style="display:flex;align-items:center;gap:12px">'
        +'<div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:22px">👥</div>'
        +'<div><div style="font-size:18px;font-weight:800;color:var(--text)">Utilization Overview</div><div style="font-size:11px;color:var(--muted)">Team capacity & workload analysis</div></div>'
      +'</div>'
      +'<div style="font-size:11px;color:var(--muted);background:var(--card2);border:1px solid var(--border);padding:6px 10px;border-radius:6px">📅 '+__RPT_DATA_LABEL_()+'</div>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">'
      +'<div style="display:flex;flex-direction:column;align-items:center;gap:6px">'
        +bigDonut
        +'<div style="font-size:11px;color:var(--muted)">Overall Utilization</div>'
        +utilBadge
      +'</div>'
      +'<div style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:18px;min-width:400px">'
        +metricCard('👥','Capacity',totalCapacity,'Total Hours',dCap,false)
        +metricCard('🕒','Scheduled',scheduled,'Team Members',dSched,false)
        +metricCard('⏱','Logged Hours',totalLogged+'h','Total this period',dLog,false)
        +metricCard('🔋','Available',Math.round(availableHours*10)/10+'h','Remaining',dAvail,true)
      +'</div>'
    +'</div>'
  +'</div>';

  // Workload Distribution + Time Breakdown row
  var modBars = moduleEntries.map(function(e){
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      +'<div style="width:14px;height:14px;border-radius:3px;background:'+e.col+';flex-shrink:0"></div>'
      +'<div style="flex:1;font-size:12px;color:var(--text)">'+esc(e.m)+'</div>'
      +'<div style="flex:3;height:8px;background:#30363d;border-radius:4px;overflow:hidden">'
        +'<div style="width:'+e.pct+'%;height:100%;background:linear-gradient(90deg,'+e.col+',#7c3aed)"></div>'
      +'</div>'
      +'<div style="width:36px;text-align:right;font-size:12px;font-weight:700;color:var(--text)">'+e.pct+'%</div>'
    +'</div>';
  }).join('') || '<div style="color:var(--muted);font-size:12px">No data in selected range</div>';

  var breakdownDonut = __svgDonut_([focusH, meetingH, adminH, idleH], ['#7c3aed','#0ea5e9','#14b8a6','#f59e0b'], Math.round(totalBreakdown*10)/10, 160);
  breakdownDonut = breakdownDonut.replace(/<text x="50" y="48"[^>]*>[\\d.]+<\\/text>/, '<text x="50" y="48" text-anchor="middle" font-size="16" font-weight="800" fill="#e6edf3">'+Math.round(totalBreakdown)+'h</text>');
  breakdownDonut = breakdownDonut.replace(/<text x="50" y="64"[^>]*>Total<\\/text>/, '<text x="50" y="62" text-anchor="middle" font-size="8" fill="#8b949e">Total</text>');

  function tbRow(color, label, val, pct) {
    return '<div style="display:flex;align-items:center;gap:10px;font-size:12px;padding:4px 0">'
      +'<div style="width:10px;height:10px;border-radius:50%;background:'+color+'"></div>'
      +'<div style="flex:1;color:var(--text)">'+label+'</div>'
      +'<div style="color:var(--text);font-weight:700">'+val+'h</div>'
      +'<div style="color:var(--muted);font-size:11px;width:42px;text-align:right">('+pct+'%)</div>'
    +'</div>';
  }

  var midRow = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">'
    +'<div class="card" style="padding:16px;margin:0">'
      +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px">Workload Distribution</div>'
      +modBars
    +'</div>'
    +'<div class="card" style="padding:16px;margin:0">'
      +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px">Time Breakdown</div>'
      +'<div style="display:flex;align-items:center;gap:16px">'
        +'<div style="flex-shrink:0">'+breakdownDonut+'</div>'
        +'<div style="flex:1">'
          +tbRow('#7c3aed','Focus Hours',focusH,pctOf(focusH))
          +tbRow('#0ea5e9','Meeting Hours',meetingH,pctOf(meetingH))
          +tbRow('#14b8a6','Admin Hours',adminH,pctOf(adminH))
          +tbRow('#f59e0b','Idle Hours',idleH,pctOf(idleH))
        +'</div>'
      +'</div>'
    +'</div>'
  +'</div>';

  // Team Utilization table
  var teamRows = owners.length ? owners.slice(0, 10).map(function(o){
    var col = __ownerColor_(o.name);
    var initials = __ownerInitials_(o.name);
    var utilBar = '<div style="flex:1;height:8px;background:#30363d;border-radius:4px;overflow:hidden;max-width:160px"><div style="width:'+o.utilization+'%;height:100%;background:linear-gradient(90deg,#10b981,#22d3ee)"></div></div>';
    var utilColor = o.utilization >= 70 ? '#10b981' : o.utilization >= 40 ? '#22d3ee' : '#0ea5e9';
    var wlPill = o.workload === 'High'
      ? '<span style="background:rgba(239,68,68,.15);color:#ef4444;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600">High</span>'
      : o.workload === 'Medium'
      ? '<span style="background:rgba(245,158,11,.15);color:#f59e0b;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600">Medium</span>'
      : '<span style="background:rgba(16,185,129,.15);color:#10b981;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600">Low</span>';

    var weeklySeries = __weeklyCountsForOwner_(o.name, 8);
    var sparkColor = (o.delta && o.delta.dir==='up') ? '#10b981' : (o.delta && o.delta.dir==='down') ? '#ef4444' : '#8b949e';
    var spark = __svgSparkline_(weeklySeries, sparkColor, 120, 24);
    var trendPill = __deltaPill_(o.delta, false);

    return '<tr style="border-bottom:1px solid var(--border)">'
      +'<td style="padding:12px 8px">'
        +'<div style="display:flex;align-items:center;gap:10px">'
          +'<div style="width:32px;height:32px;border-radius:50%;background:'+col+';color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">'+initials+'</div>'
          +'<div><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(o.name)+'</div><div style="font-size:10px;color:var(--muted)">'+esc(o.team)+'</div></div>'
        +'</div>'
      +'</td>'
      +'<td style="padding:12px 8px">'
        +'<div style="display:flex;align-items:center;gap:8px">'
          +'<span style="font-size:13px;font-weight:700;color:'+utilColor+';min-width:36px">'+o.utilization+'%</span>'
          +utilBar
        +'</div>'
      +'</td>'
      +'<td style="padding:12px 8px;font-size:12px;color:var(--text);white-space:nowrap"><strong>'+o.logged+'h</strong> <span style="color:var(--muted)">/ '+o.capacity+'h</span></td>'
      +'<td style="padding:12px 8px">'+wlPill+'</td>'
      +'<td style="padding:12px 8px;width:160px"><div style="display:flex;align-items:center;gap:10px"><div style="flex:1;max-width:120px">'+spark+'</div>'+trendPill+'</div></td>'
    +'</tr>';
  }).join('') : '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);font-size:12px">No team members with tasks in selected range</td></tr>';

  var teamTable = '<div class="card" style="padding:0;margin:0 0 14px 0">'
    +'<div style="padding:14px 16px;border-bottom:1px solid var(--border)">'
      +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Team Utilization</div>'
    +'</div>'
    +'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'
      +'<thead><tr style="border-bottom:1px solid var(--border);background:rgba(0,0,0,.15)">'
        +'<th style="padding:8px;text-align:left;font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase">Team Member</th>'
        +'<th style="padding:8px;text-align:left;font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase">Utilization</th>'
        +'<th style="padding:8px;text-align:left;font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase">Logged / Capacity</th>'
        +'<th style="padding:8px;text-align:left;font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase">Workload</th>'
        +'<th style="padding:8px;text-align:left;font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase">Trend (vs prev)</th>'
      +'</tr></thead>'
      +'<tbody>'+teamRows+'</tbody>'
    +'</table></div>'
  +'</div>';

  // AI Insight banner
  var highCount = owners.filter(function(o){ return o.workload === 'High'; }).length;
  var lowCount  = owners.filter(function(o){ return o.workload === 'Low'; }).length;
  var insight = '';
  if (highCount > 0 && lowCount > 0) insight = 'Team is unevenly loaded — <strong>'+highCount+' member'+(highCount===1?'':'s')+'</strong> at high capacity while <strong>'+lowCount+'</strong> are under-utilized. Consider rebalancing.';
  else if (highCount > 0) insight = 'Team is working at high capacity. Consider redistributing workload from <strong>'+highCount+' member'+(highCount===1?'':'s')+'</strong>.';
  else if (overallUtil < 30 && owners.length > 0) insight = 'Team utilization is low — capacity available for new initiatives or higher-throughput sprints.';
  else if (owners.length === 0) insight = 'No team members have tasks in the selected range — try widening the date filter.';
  else insight = 'Team workload is balanced across members at '+overallUtil+'% average utilization.';

  var aiBanner = '<div class="card" style="padding:14px 18px;margin:0;display:flex;align-items:center;justify-content:space-between;gap:14px;background:linear-gradient(90deg,rgba(124,58,237,.08),rgba(14,165,233,.04))">'
    +'<div style="display:flex;align-items:center;gap:12px">'
      +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:18px">⚡</span><span style="font-size:12px;font-weight:700;color:var(--accent)">AI Insight</span> <span style="background:var(--accent);color:#fff;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600">NEW</span></div>'
      +'<div style="font-size:12px;color:var(--text);line-height:1.4">'+insight+'</div>'
    +'</div>'
    +'<a class="btn" href="https://drive.google.com/drive/folders/1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P" target="_blank" style="text-decoration:none;font-size:11px;padding:8px 14px;background:var(--accent);color:#fff;border:none;white-space:nowrap">View Full Utilization Report →</a>'
  +'</div>';

  content(
    __rptHeader_(__rptFilteredWeeks_(), prev)
    + __rptTabBar_('utilization')
    + __rptFilterBar_(__rptFilteredWeeks_())
    + topCard
    + midRow
    + teamTable
    + aiBanner
  );
}

// Helper used by the utilization view title
function __RPT_DATA_LABEL_() {
  var p = __rptFilter.preset;
  if (p==='all') return 'All YTD';
  if (p==='last1w') return 'This Week';
  if (p==='last4w') return 'Last 4 Weeks';
  if (p==='last8w') return 'Last 8 Weeks';
  if (p==='q1') return 'Q1 2026';
  if (p==='q2') return 'Q2 2026';
  if (p==='custom') return __rptFilter.from + ' → ' + __rptFilter.to;
  return p.charAt(0).toUpperCase()+p.slice(1) + ' 2026';
}

`;

// Insert before renderReports_detail_
if (!dash.includes('function renderReports_detail_')) {
  console.error('✗ renderReports_detail_ anchor not found');
  process.exit(1);
}
if (!dash.includes('function renderReports_utilization_')) {
  dash = dash.replace('function renderReports_detail_', UTIL_FN + '\nfunction renderReports_detail_');
  console.log('✓ Added renderReports_utilization_ + helpers');
} else {
  console.log('… renderReports_utilization_ already present');
}

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V50: Utilization Overview module (linked from compact card) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V50: utilization overview module',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
