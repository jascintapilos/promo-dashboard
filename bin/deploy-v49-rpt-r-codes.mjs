#!/usr/bin/env node
/**
 * V49 — Reports: rename modules R1–R10 + simplify section titles
 *
 * Tab label becomes the R-code (R1, R2, …). The descriptive name moves into
 * the subtitle line for context. Each module's body header collapses from
 * "⚡ Operational Performance" to "R1 — Operational Performance".
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
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

let pass = 0, fail = 0;
function patch(label, oldStr, newStr) {
  if (dash.includes(oldStr)) {
    dash = dash.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// ─── Rewrite REPORT_MODULES with R-codes ─────────────────────────────────────
patch('REPORT_MODULES — R1 to R10 codes',
  `var REPORT_MODULES = [
  { id:'ops',     icon:'⚡', label:'Operational',     sub:'Daily / Weekly / Monthly summary' },
  { id:'promo',   icon:'🎯', label:'Promo Performance', sub:'Cost · ROI · Launch' },
  { id:'auto',    icon:'🤖', label:'Automation & AI',  sub:'Auto-run health · Hours saved' },
  { id:'team',    icon:'👥', label:'Team Productivity', sub:'Utilization · Workload · Burnout' },
  { id:'action',  icon:'📌', label:'Action & Meetings', sub:'Open AIs · Meeting effectiveness' },
  { id:'sla',     icon:'⏱',  label:'SLA & Delay',       sub:'Compliance · Root cause' },
  { id:'request', icon:'📨', label:'Request Analytics', sub:'Volume · Quality · Source' },
  { id:'sop',     icon:'📚', label:'SOP & Knowledge',   sub:'Gap report · Usage' },
  { id:'exec',    icon:'👑', label:'Executive Intel',   sub:'1-min exec summary' },
  { id:'ai',      icon:'✨', label:'Future AI',         sub:'Predictive · Forecast' },
];`,
  `var REPORT_MODULES = [
  { id:'ops',     code:'R1',  icon:'⚡', label:'R1',  sub:'Operational' },
  { id:'promo',   code:'R2',  icon:'🎯', label:'R2',  sub:'Promo Performance' },
  { id:'auto',    code:'R3',  icon:'🤖', label:'R3',  sub:'Automation & AI' },
  { id:'team',    code:'R4',  icon:'👥', label:'R4',  sub:'Team Productivity' },
  { id:'action',  code:'R5',  icon:'📌', label:'R5',  sub:'Action & Meetings' },
  { id:'sla',     code:'R6',  icon:'⏱',  label:'R6',  sub:'SLA & Delay' },
  { id:'request', code:'R7',  icon:'📨', label:'R7',  sub:'Request Analytics' },
  { id:'sop',     code:'R8',  icon:'📚', label:'R8',  sub:'SOP & Knowledge' },
  { id:'exec',    code:'R9',  icon:'👑', label:'R9',  sub:'Executive Intel' },
  { id:'ai',      code:'R10', icon:'✨', label:'R10', sub:'Future AI' },
];`);

// ─── Make label bigger since it's now just a short code ──────────────────────
patch('Tab label — bigger code, smaller subtitle',
  `        '<div style="font-size:11px;font-weight:600;color:' + labelColor + ';margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + m.label + '</div>' +
        '<div style="font-size:9px;color:#8b949e;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + m.sub + '</div>' +`,
  `        '<div style="font-size:14px;font-weight:700;color:' + labelColor + ';margin-bottom:2px;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + m.label + '</div>' +
        '<div style="font-size:10px;color:#8b949e;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + m.sub + '</div>' +`);

// ─── Simplify module body section headers (R-code + name) ────────────────────
patch('R1 section header',
  `'<div class="rpt-section-head"><h2>⚡ Operational Performance</h2><span class="rpt-period">Last 30 days · Real-time</span></div>'`,
  `'<div class="rpt-section-head"><h2>R1 · Operational Performance</h2><span class="rpt-period">Last 30 days · Real-time</span></div>'`);

patch('R2 section header',
  `'<div class="rpt-section-head"><h2>🎯 Promo Performance</h2><span class="rpt-period">Live BO sync · ' + brandsLive + ' brands</span></div>'`,
  `'<div class="rpt-section-head"><h2>R2 · Promo Performance</h2><span class="rpt-period">Live BO sync · ' + brandsLive + ' brands</span></div>'`);

patch('R3 section header',
  `'<div class="rpt-section-head"><h2>🤖 Automation &amp; AI</h2><span class="rpt-period">All-time · 21 brands covered</span></div>'`,
  `'<div class="rpt-section-head"><h2>R3 · Automation &amp; AI</h2><span class="rpt-period">All-time · 21 brands covered</span></div>'`);

patch('R4 section header',
  `'<div class="rpt-section-head"><h2>👥 Team Productivity</h2><span class="rpt-period">' + teamSize + ' members · ' + totalAssigned + ' assigned tasks</span></div>'`,
  `'<div class="rpt-section-head"><h2>R4 · Team Productivity</h2><span class="rpt-period">' + teamSize + ' members · ' + totalAssigned + ' assigned tasks</span></div>'`);

patch('R5 section header',
  `'<div class="rpt-section-head"><h2>📌 Action Items &amp; Meetings</h2><span class="rpt-period">Awaiting source integration</span></div>'`,
  `'<div class="rpt-section-head"><h2>R5 · Action Items &amp; Meetings</h2><span class="rpt-period">Awaiting source integration</span></div>'`);

patch('R6 section header',
  `'<div class="rpt-section-head"><h2>⏱ SLA &amp; Delay</h2><span class="rpt-period">SLA target: 3 business days</span></div>'`,
  `'<div class="rpt-section-head"><h2>R6 · SLA &amp; Delay</h2><span class="rpt-period">SLA target: 3 business days</span></div>'`);

patch('R7 section header',
  `'<div class="rpt-section-head"><h2>📨 Request Analytics</h2><span class="rpt-period">' + totalReq + ' total requests · all sources</span></div>'`,
  `'<div class="rpt-section-head"><h2>R7 · Request Analytics</h2><span class="rpt-period">' + totalReq + ' total requests · all sources</span></div>'`);

patch('R8 section header',
  `'<div class="rpt-section-head"><h2>📚 SOP &amp; Knowledge Base</h2><span class="rpt-period">Operational knowledge audit</span></div>'`,
  `'<div class="rpt-section-head"><h2>R8 · SOP &amp; Knowledge Base</h2><span class="rpt-period">Operational knowledge audit</span></div>'`);

patch('R9 section header',
  `'<div class="rpt-section-head"><h2>👑 Executive Intelligence</h2><span class="rpt-period">1-minute operations briefing</span></div>'`,
  `'<div class="rpt-section-head"><h2>R9 · Executive Intelligence</h2><span class="rpt-period">1-minute operations briefing</span></div>'`);

patch('R10 section header',
  `'<div class="rpt-section-head"><h2>✨ Future AI-Powered Reports</h2><span class="rpt-period">Roadmap · Architecture ready</span></div>'`,
  `'<div class="rpt-section-head"><h2>R10 · Future AI</h2><span class="rpt-period">Roadmap · Architecture ready</span></div>'`);

// Badge V48 → V49
patch('Badge V48 → V49', `>V48 ✓</span>`, `>V49 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V49 — R-code module naming — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
