#!/usr/bin/env node
/**
 * V50 — Reports R1–R10 lives in the SIDEBAR as a dropdown
 *
 * Remove the horizontal tab bar from the Reports content area. Instead
 * the Reports sidebar item expands when active to show R1–R10 as nested
 * sub-items. Clicking a sub-item navigates straight to that report module.
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

// ─── 1. Replace the Reports sidebar item with an expandable group ───────────
patch('Sidebar — Reports becomes expandable with R1–R10 sub-list',
  `      <div class="nav-item" data-view="reports" onclick="nav('reports')"><span class="nav-icon">📊</span>Reports</div>
      <div class="nav-section">System</div>`,
  `      <div class="nav-item nav-item-expandable" data-view="reports" onclick="nav('reports')" id="nav-reports">
        <span class="nav-icon">📊</span>Reports
        <span class="nav-chevron" id="nav-reports-chevron">▸</span>
      </div>
      <div class="nav-subgroup" id="nav-reports-sub" style="display:none">
        <div class="nav-subitem" data-rcode="ops"     onclick="navReport_('ops')"><span class="nav-rcode">R1</span><span class="nav-rname">Operational</span></div>
        <div class="nav-subitem" data-rcode="promo"   onclick="navReport_('promo')"><span class="nav-rcode">R2</span><span class="nav-rname">Promo Performance</span></div>
        <div class="nav-subitem" data-rcode="auto"    onclick="navReport_('auto')"><span class="nav-rcode">R3</span><span class="nav-rname">Automation &amp; AI</span></div>
        <div class="nav-subitem" data-rcode="team"    onclick="navReport_('team')"><span class="nav-rcode">R4</span><span class="nav-rname">Team Productivity</span></div>
        <div class="nav-subitem" data-rcode="action"  onclick="navReport_('action')"><span class="nav-rcode">R5</span><span class="nav-rname">Action &amp; Meetings</span></div>
        <div class="nav-subitem" data-rcode="sla"     onclick="navReport_('sla')"><span class="nav-rcode">R6</span><span class="nav-rname">SLA &amp; Delay</span></div>
        <div class="nav-subitem" data-rcode="request" onclick="navReport_('request')"><span class="nav-rcode">R7</span><span class="nav-rname">Request Analytics</span></div>
        <div class="nav-subitem" data-rcode="sop"     onclick="navReport_('sop')"><span class="nav-rcode">R8</span><span class="nav-rname">SOP &amp; Knowledge</span></div>
        <div class="nav-subitem" data-rcode="exec"    onclick="navReport_('exec')"><span class="nav-rcode">R9</span><span class="nav-rname">Executive Intel</span></div>
        <div class="nav-subitem" data-rcode="ai"      onclick="navReport_('ai')"><span class="nav-rcode">R10</span><span class="nav-rname">Future AI</span></div>
      </div>
      <div class="nav-section">System</div>`);

// ─── 2. Add sidebar dropdown CSS ────────────────────────────────────────────
patch('CSS — sidebar nav-subitem + chevron',
  `.nav-item .badge{margin-left:auto;background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px}`,
  `.nav-item .badge{margin-left:auto;background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px}
.nav-chevron{margin-left:auto;font-size:10px;color:var(--muted);transition:transform .15s ease}
.nav-item-expandable.active .nav-chevron,.nav-item-expandable.expanded .nav-chevron{transform:rotate(90deg);color:var(--accent)}
.nav-subgroup{padding:2px 0 6px 0;background:rgba(0,0,0,.18);border-left:3px solid transparent;animation:navExpand .18s ease-out}
@keyframes navExpand{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.nav-subitem{display:flex;align-items:center;gap:10px;padding:6px 12px 6px 24px;cursor:pointer;font-size:12px;color:var(--muted);transition:background .12s,color .12s;border-left:3px solid transparent;margin:0}
.nav-subitem:hover{background:rgba(255,255,255,.04);color:var(--text)}
.nav-subitem.active{color:var(--accent);background:rgba(124,58,237,.12);border-left-color:var(--accent)}
.nav-rcode{display:inline-block;min-width:28px;font-weight:700;font-size:11px;font-family:'SF Mono','Consolas',monospace;color:var(--accent);letter-spacing:.02em}
.nav-subitem.active .nav-rcode{color:#fff;background:var(--accent);padding:1px 5px;border-radius:4px;min-width:0}
.nav-rname{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`);

// ─── 3. Add navReport_ + sidebar sync helpers (inserted near nav function) ──
patch('JS — navReport_() + sidebar dropdown sync',
  `function nav(view, opts) {
  S.view = view;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  if (opts && opts.create) { nav('tasks'); showTaskModal(); return; }
  renderView(view);
}`,
  `function nav(view, opts) {
  S.view = view;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  syncReportsDropdown_();
  if (opts && opts.create) { nav('tasks'); showTaskModal(); return; }
  renderView(view);
}

function navReport_(rcode) {
  S.reportModule = rcode;
  if (S.view !== 'reports') {
    nav('reports');
  } else {
    syncReportsDropdown_();
    renderReports();
  }
}

function syncReportsDropdown_() {
  var sub = document.getElementById('nav-reports-sub');
  var navR = document.getElementById('nav-reports');
  var chev = document.getElementById('nav-reports-chevron');
  if (!sub || !navR) return;
  var isReports = S.view === 'reports';
  sub.style.display = isReports ? 'block' : 'none';
  navR.classList.toggle('expanded', isReports);
  if (chev) chev.textContent = isReports ? '▾' : '▸';
  // Highlight active R-code
  document.querySelectorAll('.nav-subitem').forEach(function(el){
    el.classList.toggle('active', isReports && el.dataset.rcode === (S.reportModule || 'ops'));
  });
}`);

// ─── 4. Remove the horizontal tab bar from Reports content ──────────────────
patch('Reports content — drop horizontal tab bar, sync sidebar',
  `  var tabsHtml = REPORT_MODULES.map(function(m){
    var active = m.id === mod;
    var s = active ? TAB_STYLE_ACTIVE : TAB_STYLE_BASE;
    var iconColor = active ? '#7c3aed' : '#e6edf3';
    var labelColor = active ? '#7c3aed' : '#e6edf3';
    return '<div role="button" tabindex="0" onclick="selectReportModule_(\\''+m.id+'\\')" style="' + s + '">' +
      '<div style="font-size:20px;line-height:1;margin-bottom:2px">' + m.icon + '</div>' +
      '<div style="flex:1;min-width:0;width:100%">' +
        '<div style="font-size:14px;font-weight:700;color:' + labelColor + ';margin-bottom:2px;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + m.label + '</div>' +
        '<div style="font-size:10px;color:#8b949e;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + m.sub + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  content(
    '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:18px">' + tabsHtml + '</div>' +
    '<div id="rpt-module-body"><div class="loading"><div class="spinner"></div></div></div>'
  );`,
  `  // Sidebar dropdown is the new navigator — no horizontal tab bar.
  syncReportsDropdown_();
  content('<div id="rpt-module-body"><div class="loading"><div class="spinner"></div></div></div>');`);

// Remove now-unused TAB_STYLE_BASE/ACTIVE lines (cleanup)
patch('Cleanup — remove unused TAB_STYLE constants',
  `  var TAB_STYLE_BASE  = 'background:#1c2128;border:1px solid #30363d;border-radius:10px;padding:10px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;color:#e6edf3;font-size:11px;line-height:1.3;min-height:78px;justify-content:flex-start;transition:all .18s;box-sizing:border-box';
  var TAB_STYLE_ACTIVE= 'background:linear-gradient(135deg,rgba(124,58,237,.22),rgba(14,165,233,.08));border:1px solid #7c3aed;border-radius:10px;padding:10px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;color:#e6edf3;font-size:11px;line-height:1.3;min-height:78px;justify-content:flex-start;box-shadow:0 0 0 1px #7c3aed,0 6px 18px rgba(124,58,237,.25);transform:translateY(-1px);box-sizing:border-box';
  `,
  `  `);

// ─── 5. Update selectReportModule_ to also sync sidebar ─────────────────────
patch('selectReportModule_ — sync sidebar dropdown',
  `function selectReportModule_(modId) {
  S.reportModule = modId;
  renderReports();
}`,
  `function selectReportModule_(modId) {
  S.reportModule = modId;
  syncReportsDropdown_();
  renderReports();
}`);

// Badge bump
patch('Badge V49 → V50', `>V49 ✓</span>`, `>V50 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V50 — Reports R1–R10 sidebar dropdown — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
