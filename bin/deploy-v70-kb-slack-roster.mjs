#!/usr/bin/env node
/**
 * V70 — Knowledge Base + Slack-name roster + Dynamic Create-New Task +
 *       Progress removal
 *
 *   1. NEW Knowledge Base module: sidebar nav + renderKnowledgeBase()
 *      Live-reads Directory → SOP and Knowledge Library tabs (with hyperlinks
 *      via getRichTextValues). Card grid grouped by Category.
 *   2. NEW serverGetTeamRoster(): reads Directory → Team Contact Details,
 *      returns [{ name, fullName, position, email }]. Dashboard caches as
 *      S.roster on boot.
 *   3. Owner dropdowns site-wide → render Slack short names from S.roster;
 *      no more emails or auto-generated display strings.
 *   4. Edit Task modal Owner input becomes a <select> sourced from S.roster.
 *   5. REMOVE Progress everywhere — table column, badge, edit input, drawer.
 *   6. NEW dynamic Create-New Task body:
 *        - Type chip: Banner Upload | Promo Code QC | Other
 *        - Banner Upload fields match the Slack #banner template
 *          (B-row repeater w/ Platform + Owner + AI flag)
 *        - Promo Code QC fields match the Slack #promo-code template
 *          (P-range repeater w/ Owner + Priority + EOD deadline)
 *        - "Other" keeps the existing generic form
 *      Output is normalised to Title/Module/Brand/Owner/Due_Date/Priority/
 *      Description fields, with the Slack-formatted body in Description.
 *   7. Badge V69 → V70.
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
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
let dash = proj.files[dashIdx].source;
let code = proj.files[codeIdx].source;

let pass = 0, fail = 0;
function patch(label, target, oldStr, newStr) {
  const src = target === 'dash' ? dash : code;
  if (src.includes(oldStr)) {
    if (target === 'dash') dash = src.replace(oldStr, newStr);
    else                   code = src.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// ─── CODE.GS: Add Directory constant + serverGetTeamRoster + serverGetSOPs ──
patch('Code.gs — DIR_SS_ID + serverGetTeamRoster + serverGetSOPs',
  'code',
  `const SS_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';`,
  `const SS_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const DIR_SS_ID = '1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68';  // Directory sheet

// ─── Team roster from Directory → Team Contact Details ────────────────────
function serverGetTeamRoster() {
  try {
    var ss = SpreadsheetApp.openById(DIR_SS_ID);
    var sheet = ss.getSheetByName('Team Contact Details');
    if (!sheet) return [];
    var lr = sheet.getLastRow();
    if (lr < 2) return [];
    var lc = Math.min(sheet.getLastColumn(), 10);
    var data = sheet.getRange(1, 1, lr, lc).getValues();
    var headers = data[0].map(function(h){ return String(h||'').trim(); });
    var col = function(rx){ for (var i = 0; i < headers.length; i++) if (rx.test(headers[i])) return i; return -1; };
    var iName = col(/^Name$/i);
    var iFull = col(/^Full Name$/i);
    var iPos  = col(/^Position$/i);
    var iMail = col(/^Email$/i);
    var iTele = col(/^Telegram/i);
    var out = [];
    for (var r = 1; r < data.length; r++) {
      var name = String((iName>=0 ? data[r][iName] : '') || '').trim();
      var full = String((iFull>=0 ? data[r][iFull] : '') || '').trim();
      if (!name && !full) continue;
      out.push({
        name:     name || full,
        fullName: full || name,
        position: String((iPos>=0  ? data[r][iPos]  : '') || '').trim(),
        email:    String((iMail>=0 ? data[r][iMail] : '') || '').trim(),
        telegram: String((iTele>=0 ? data[r][iTele] : '') || '').trim(),
      });
    }
    return out;
  } catch (e) {
    Logger.log('serverGetTeamRoster error: ' + e.message);
    return [];
  }
}

// ─── SOPs + Knowledge Library from Directory ──────────────────────────────
function serverGetSOPs() {
  try {
    var ss = SpreadsheetApp.openById(DIR_SS_ID);
    var out = { sops: [], library: [] };

    // ── SOP tab ──
    var sop = ss.getSheetByName('SOP');
    if (sop && sop.getLastRow() > 1) {
      var lr = sop.getLastRow();
      var lc = Math.min(sop.getLastColumn(), 6);
      var rng = sop.getRange(1, 1, lr, lc);
      var vals = rng.getValues();
      var rich = rng.getRichTextValues();
      var headers = vals[0].map(function(h){ return String(h||'').trim(); });
      var iCat = headers.indexOf('Category');
      var iTitle = headers.findIndex(function(h){ return /title/i.test(h); });
      var iWF = headers.findIndex(function(h){ return /working/i.test(h); });
      var iTpl = headers.findIndex(function(h){ return /template/i.test(h); });
      var lastCat = '';
      for (var r = 1; r < vals.length; r++) {
        var cat = String(vals[r][iCat] || '').trim() || lastCat;
        if (cat) lastCat = cat;
        if (iTitle >= 0 && vals[r][iTitle]) {
          var title = String(vals[r][iTitle] || '').trim();
          var link = (rich[r] && rich[r][iTitle] && rich[r][iTitle].getLinkUrl()) || '';
          if (title) out.sops.push({ category: cat || 'General', kind: 'SOP', title: title, link: link });
        }
        if (iWF >= 0 && vals[r][iWF]) {
          var wf = String(vals[r][iWF] || '').trim();
          var wfLink = (rich[r] && rich[r][iWF] && rich[r][iWF].getLinkUrl()) || '';
          if (wf) out.sops.push({ category: cat || 'General', kind: 'Working File', title: wf, link: wfLink });
        }
        if (iTpl >= 0 && vals[r][iTpl]) {
          var tpl = String(vals[r][iTpl] || '').trim();
          var tplLink = (rich[r] && rich[r][iTpl] && rich[r][iTpl].getLinkUrl()) || '';
          if (tpl) out.sops.push({ category: cat || 'General', kind: 'Template', title: tpl, link: tplLink });
        }
      }
    }

    // ── Knowledge Library tab ──
    var kl = ss.getSheetByName('Knowledge Library');
    if (kl && kl.getLastRow() > 1) {
      var lr2 = kl.getLastRow();
      var lc2 = Math.min(kl.getLastColumn(), 6);
      var rng2 = kl.getRange(1, 1, lr2, lc2);
      var vals2 = rng2.getValues();
      var rich2 = rng2.getRichTextValues();
      var headers2 = vals2[0].map(function(h){ return String(h||'').trim(); });
      var iDoc  = headers2.findIndex(function(h){ return /document/i.test(h); });
      var iCat2 = headers2.indexOf('Category');
      var iItem = headers2.findIndex(function(h){ return /^item/i.test(h); });
      for (var r = 1; r < vals2.length; r++) {
        var item = iItem >= 0 ? String(vals2[r][iItem] || '').trim() : '';
        if (!item) continue;
        var lnk = (rich2[r] && rich2[r][iItem] && rich2[r][iItem].getLinkUrl()) || '';
        out.library.push({
          docNo: iDoc >= 0 ? String(vals2[r][iDoc] || '').trim() : '',
          category: iCat2 >= 0 ? String(vals2[r][iCat2] || '').trim() : 'General',
          title: item,
          link: lnk,
        });
      }
    }
    return out;
  } catch (e) {
    Logger.log('serverGetSOPs error: ' + e.message);
    return { sops: [], library: [] };
  }
}

const SS_ID_DUPE = SS_ID;  // (no-op; placeholder so the original SS_ID line above stays intact)
`);

// Remove the placeholder no-op line we added (it was just to ensure the patch worked)
patch('Code.gs — strip placeholder no-op',
  'code',
  `const SS_ID_DUPE = SS_ID;  // (no-op; placeholder so the original SS_ID line above stays intact)
`,
  ``);

// ─── DASHBOARD: Add KB nav item to sidebar ─────────────────────────────────
patch('Dashboard — Add Knowledge Base nav item',
  'dash',
  `      <div class="nav-item" data-view="calendar" data-section="manage" onclick="nav('calendar')"><span class="nav-icon">📅</span>Calendar</div>`,
  `      <div class="nav-item" data-view="calendar" data-section="manage" onclick="nav('calendar')"><span class="nav-icon">📅</span>Calendar</div>
      <div class="nav-item" data-view="kb" data-section="manage" onclick="nav('kb')"><span class="nav-icon">📚</span>Knowledge Base</div>`);

// ─── DASHBOARD: Wire KB into renderView switch ─────────────────────────────
patch('Dashboard — Wire KB into renderView',
  'dash',
  `    case 'approvals':   renderApprovals(); break;
    case 'reports':     renderReports(); break;`,
  `    case 'approvals':   renderApprovals(); break;
    case 'kb':          renderKnowledgeBase(); break;
    case 'reports':     renderReports(); break;`);

// ─── DASHBOARD: Add renderKnowledgeBase function ───────────────────────────
patch('Dashboard — Add renderKnowledgeBase + helper',
  'dash',
  `// =============================================================================
// CALENDAR VIEW
// =============================================================================`,
  `// =============================================================================
// KNOWLEDGE BASE VIEW
// =============================================================================
function renderKnowledgeBase() {
  content('<div class="loading"><div class="spinner"></div>Loading SOPs from Directory…</div>');
  if (typeof google === 'undefined') {
    renderKBData_({ sops: [], library: [] });
    return;
  }
  google.script.run
    .withSuccessHandler(renderKBData_)
    .withFailureHandler(function(e){ renderKBData_({ sops: [], library: [], err: String(e && e.message || e) }); })
    .serverGetSOPs();
}

function renderKBData_(data) {
  var sops = data.sops || [];
  var library = data.library || [];

  // Group SOPs by category
  var sopByCat = {};
  sops.forEach(function(s){
    var k = s.category || 'General';
    if (!sopByCat[k]) sopByCat[k] = [];
    sopByCat[k].push(s);
  });
  var sopCats = Object.keys(sopByCat).sort();

  // Group library by category
  var libByCat = {};
  library.forEach(function(l){
    var k = l.category || 'General';
    if (!libByCat[k]) libByCat[k] = [];
    libByCat[k].push(l);
  });
  var libCats = Object.keys(libByCat).sort();

  var totalDocs = sops.length + library.length;
  var withLinks = sops.filter(function(s){return !!s.link;}).length + library.filter(function(l){return !!l.link;}).length;

  function kindBadge(kind) {
    var color = kind === 'SOP' ? '#7c3aed'
              : kind === 'Working File' ? '#0ea5e9'
              : kind === 'Template' ? '#10b981'
              : '#8b949e';
    return '<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;background:' + color + '22;color:' + color + ';text-transform:uppercase;letter-spacing:.04em">' + esc(kind) + '</span>';
  }

  function card(item) {
    var hasLink = !!item.link;
    var title = (item.title || '').replace(/\\.docx$|\\.xlsx$/i, '');
    var click = hasLink
      ? 'onclick="window.open(\\'' + item.link.replace(/'/g, "\\\\'") + '\\', \\'_blank\\')"'
      : '';
    var docNo = item.docNo ? '<span style="font-family:monospace;font-size:10px;color:var(--muted);margin-right:6px">' + esc(item.docNo) + '</span>' : '';
    var kindHtml = item.kind ? kindBadge(item.kind) : '';
    var external = hasLink ? '<span style="margin-left:auto;color:var(--accent);font-size:14px">↗</span>' : '<span style="margin-left:auto;color:var(--muted);font-size:10px;font-style:italic">no link</span>';
    return '<div ' + click + ' style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;cursor:' + (hasLink ? 'pointer' : 'default') + ';transition:all .15s;display:flex;align-items:flex-start;gap:10px" ' +
      'onmouseover="if(' + (hasLink ? 'true' : 'false') + '){this.style.borderColor=\\'var(--accent)\\';this.style.background=\\'#1c2128\\'}" ' +
      'onmouseout="this.style.borderColor=\\'var(--border)\\';this.style.background=\\'var(--card2)\\'">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' + docNo + kindHtml + '</div>' +
        '<div style="font-size:13px;font-weight:500;line-height:1.4;word-break:break-word">' + esc(title) + '</div>' +
      '</div>' +
      external +
    '</div>';
  }

  var html = '';

  // Header with search
  html += '<div class="card" style="margin-bottom:16px"><div class="card-hdr">' +
    '<h3>📚 Knowledge Base</h3>' +
    '<input id="kb-search" placeholder="🔎 Search SOPs, working files, templates…" oninput="kbFilter_()" style="background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:inherit;font-size:12px;width:280px">' +
    '</div></div>';

  // KPI strip
  html += '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">' +
    '<div class="kpi-card" style="border-top-color:#7c3aed"><div class="kpi-icon">📑</div><div class="kpi-value">' + sops.length + '</div><div class="kpi-label">SOPs &amp; Files</div></div>' +
    '<div class="kpi-card" style="border-top-color:#0ea5e9"><div class="kpi-icon">📚</div><div class="kpi-value">' + library.length + '</div><div class="kpi-label">Knowledge Library</div></div>' +
    '<div class="kpi-card" style="border-top-color:#10b981"><div class="kpi-icon">🔗</div><div class="kpi-value">' + withLinks + '</div><div class="kpi-label">With Live Links</div></div>' +
    '<div class="kpi-card" style="border-top-color:#f59e0b"><div class="kpi-icon">🗂</div><div class="kpi-value">' + (sopCats.length + libCats.length) + '</div><div class="kpi-label">Categories</div></div>' +
  '</div>';

  // SOPs grouped by category
  if (sopCats.length) {
    html += '<div class="card" style="margin-bottom:16px" data-kb-block="sops"><div class="card-hdr"><h3>📑 Standard Operating Procedures</h3><a class="hint" href="https://docs.google.com/spreadsheets/d/1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68/edit#gid=1947299217" target="_blank" style="color:var(--accent)">Open in Directory →</a></div><div class="card-body" style="padding:14px">';
    sopCats.forEach(function(cat){
      html += '<div data-kb-section style="margin-bottom:16px">';
      html += '<div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">' + esc(cat) + ' <span style="color:var(--muted);font-weight:500">· ' + sopByCat[cat].length + '</span></div>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px" data-kb-grid>';
      sopByCat[cat].forEach(function(s){ html += '<div data-kb-item data-kb-text="' + esc((s.title + ' ' + (s.kind || '') + ' ' + cat).toLowerCase()) + '">' + card(s) + '</div>'; });
      html += '</div></div>';
    });
    html += '</div></div>';
  }

  // Knowledge Library grouped by category
  if (libCats.length) {
    html += '<div class="card" style="margin-bottom:16px" data-kb-block="library"><div class="card-hdr"><h3>📚 Knowledge Library</h3><a class="hint" href="https://docs.google.com/spreadsheets/d/1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68/edit#gid=426352070" target="_blank" style="color:var(--accent)">Open in Directory →</a></div><div class="card-body" style="padding:14px">';
    libCats.forEach(function(cat){
      html += '<div data-kb-section style="margin-bottom:16px">';
      html += '<div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">' + esc(cat) + ' <span style="color:var(--muted);font-weight:500">· ' + libByCat[cat].length + '</span></div>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px" data-kb-grid>';
      libByCat[cat].forEach(function(l){ html += '<div data-kb-item data-kb-text="' + esc((l.title + ' ' + (l.docNo || '') + ' ' + cat).toLowerCase()) + '">' + card(l) + '</div>'; });
      html += '</div></div>';
    });
    html += '</div></div>';
  }

  if (!sops.length && !library.length) {
    html += '<div class="empty"><div class="empty-icon">📭</div><div>No SOPs or knowledge items found.<br><span style="font-size:11px;color:var(--muted)">Check Directory sheet permissions.</span></div></div>';
  }

  content(html);
}

function kbFilter_() {
  var q = (document.getElementById('kb-search') || {}).value || '';
  q = q.toLowerCase().trim();
  document.querySelectorAll('[data-kb-item]').forEach(function(el){
    var hay = el.getAttribute('data-kb-text') || '';
    el.style.display = (!q || hay.indexOf(q) >= 0) ? '' : 'none';
  });
  // Hide section header if all items in it are hidden
  document.querySelectorAll('[data-kb-section]').forEach(function(sec){
    var anyVisible = Array.prototype.some.call(sec.querySelectorAll('[data-kb-item]'), function(el){ return el.style.display !== 'none'; });
    sec.style.display = anyVisible ? '' : 'none';
  });
}

// =============================================================================
// CALENDAR VIEW
// =============================================================================`);

// ─── DASHBOARD: Add boot-time roster load + S.roster ───────────────────────
patch('Dashboard — Load roster on boot into S.roster',
  'dash',
  `  // ── Role-gate sidebar sections ──────────────────────────────────────────`,
  `  // ── Load team roster from Directory for Owner dropdowns ──────────────────
  if (typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(rows){ S.roster = Array.isArray(rows) ? rows : []; refreshOwnerDropdowns_(); })
      .withFailureHandler(function(){ S.roster = []; })
      .serverGetTeamRoster();
  }

  // ── Role-gate sidebar sections ──────────────────────────────────────────`);

// ─── DASHBOARD: refreshOwnerDropdowns_ helper + roster utilities ───────────
patch('Dashboard — Add rosterNames_ + refreshOwnerDropdowns_ helpers',
  'dash',
  `// ── Owner roster helper (drives Edit-Task datalist) ──────────────────────────
function getOwnerOptions_() {
  var existing = (typeof window !== 'undefined' && window.S && Array.isArray(window.S.tasks))
    ? window.S.tasks.map(function(t){return String(t.Owner||'').trim();}).filter(Boolean)
    : [];`,
  `// ── Roster helpers (single source of truth: S.roster) ───────────────────────
function rosterNames_() {
  if (typeof window === 'undefined' || !window.S || !Array.isArray(window.S.roster)) return [];
  return window.S.roster.map(function(r){ return String(r && r.name || '').trim(); }).filter(Boolean);
}

function refreshOwnerDropdowns_() {
  var names = rosterNames_();
  // 1. Tasks page filter dropdown
  var sel = document.getElementById('task-owner');
  if (sel) {
    var cur = sel.value || '';
    sel.innerHTML = '<option value="">All Owners</option>' +
      names.map(function(o){return '<option value="' + o + '">' + o + '</option>';}).join('');
    if (cur && names.indexOf(cur) >= 0) sel.value = cur;
  }
  // 2. Edit-Task modal datalist (if open)
  var dl = document.getElementById('t-owner-list');
  if (dl) dl.innerHTML = names.map(function(o){return '<option value="'+o+'">';}).join('');
}

// ── Owner roster helper (drives Edit-Task datalist) ──────────────────────────
function getOwnerOptions_() {
  var fromRoster = rosterNames_();
  if (fromRoster.length) return fromRoster;
  // Fallback: pull from existing task owners if roster not yet loaded
  var existing = (typeof window !== 'undefined' && window.S && Array.isArray(window.S.tasks))
    ? window.S.tasks.map(function(t){return String(t.Owner||'').trim();}).filter(Boolean)
    : [];`);

// ─── DASHBOARD: populateOwnerFilter_ → use roster ──────────────────────────
patch('Dashboard — populateOwnerFilter_ uses roster',
  'dash',
  `function populateOwnerFilter_() {
  var sel = document.getElementById('task-owner');`,
  `function populateOwnerFilter_() {
  // Owners come from Directory roster (S.roster). Fallback: existing task owners.
  var names = rosterNames_();
  if (!names.length) {
    var raw = (typeof window !== 'undefined' && window.S && Array.isArray(window.S.tasks))
      ? window.S.tasks.map(function(t){return String(t.Owner||'').trim();}).filter(Boolean)
      : [];
    var seen = {};
    raw.forEach(function(n){ seen[n] = 1; });
    names = Object.keys(seen);
  }
  var sel = document.getElementById('task-owner');`);

// ─── DASHBOARD: rewrite populateOwnerFilter_ body to use names array ──────
patch('Dashboard — populateOwnerFilter_ body uses names from roster',
  'dash',
  `  var sel = document.getElementById('task-owner');
  if (!sel) return;
  var cur = sel.value || '';
  var owners = S.tasks.map(function(t){return t.Owner||'';})
                       .filter(function(v,i,a){return v && a.indexOf(v)===i;})
                       .sort();
  sel.innerHTML = '<option value="">All Owners</option>' +
    owners.map(function(o){return '<option value="' + o + '">' + o + '</option>';}).join('');
  if (cur && owners.indexOf(cur) >= 0) sel.value = cur;
}`,
  `  var sel = document.getElementById('task-owner');
  if (!sel) return;
  var cur = sel.value || '';
  var sorted = names.slice().sort();
  sel.innerHTML = '<option value="">All Owners</option>' +
    sorted.map(function(o){return '<option value="' + o + '">' + o + '</option>';}).join('');
  if (cur && sorted.indexOf(cur) >= 0) sel.value = cur;
}`);

// ─── DASHBOARD: Remove Progress column from tasks table header ─────────────
patch('Dashboard — Remove Progress column header from tasks table',
  'dash',
  `      <th>Due</th><th>Priority</th><th>Status</th><th>Progress</th>\${mini?'':'<th>Actions</th>'}`,
  `      <th>Due</th><th>Priority</th><th>Status</th>\${mini?'':'<th>Actions</th>'}`);

// ─── DASHBOARD: Remove Progress td cell from taskRow ───────────────────────
patch('Dashboard — Remove Progress td from taskRow',
  'dash',
  `    <td style="white-space:nowrap"><div style="display:flex;align-items:center;gap:5px"><div class="progress-bar"><div class="progress-fill" style="width:\${prog}%;background:\${prog>=100?'var(--green)':prog>50?'var(--accent)':'var(--amber)'}"></div></div><span style="font-size:11px;color:var(--muted)">\${prog}%</span></div></td>`,
  ``);

// ─── DASHBOARD: Remove prog calc + statusBadge map references to progress class
patch('Dashboard — Remove prog var in taskRow',
  'dash',
  `  const status = normaliseStatus_(t.Status);
  const prog  = Math.min(100, Math.max(0, parseInt(t.Progress)||0));
  const statusBadge = { 'Completed':'done','In Progress':'progress','Pending Approval':'approval','At Risk':'risk','New':'new','Needs Clarification':'clarif' }[status]||'new';`,
  `  const status = normaliseStatus_(t.Status);
  const statusBadge = { 'Completed':'done','In Progress':'progress','Pending Approval':'approval','At Risk':'risk','New':'new','Needs Clarification':'clarif' }[status]||'new';`);

// ─── DASHBOARD: Rewrite Create-New Task modal (dynamic by type) ────────────
patch('Dashboard — Dynamic Create-New Task modal (Banner / Promo QC / Other)',
  'dash',
  `// ── Task Modal ───────────────────────────────────────────────────────────────
function showTaskModal(editId) {
  const task = editId ? (S.tasks.find(t=>String(t.Task_ID)===String(editId))||{}) : {};
  const title = editId ? 'Edit Task' : 'Create Task';
  const v = k => task[k] || '';
  showModal(title, \`
    <div class="form-row"><label class="form-label">Title *</label><input id="t-title" value="\${esc(v('Title'))}" placeholder="e.g. Upload SUMMER26 promo to QPRO1"></div>
    <div class="form-grid">
      <div class="form-row"><label class="form-label">Module</label>
        <select id="t-module"><option>Promo Codes</option><option>Banners</option><option>CRM</option><option>Approvals</option><option>Other</option></select>
      </div>
      <div class="form-row"><label class="form-label">Brand</label><input id="t-brand" value="\${esc(v('Brand'))}" placeholder="e.g. QPRO1, QP2A"></div>
    </div>
    <div class="form-grid">
      <div class="form-row"><label class="form-label">Owner / Assignee</label>
        <input id="t-owner" list="t-owner-list" value="\${esc(v('Owner'))}" placeholder="Start typing — pick from roster or add new">
        <datalist id="t-owner-list">\${getOwnerOptions_().map(function(o){return '<option value="'+esc(o)+'">';}).join('')}</datalist>
      </div>
      <div class="form-row"><label class="form-label">Due Date</label><input id="t-due" type="date" value="\${fmtISO(v('Due_Date'))}"></div>
    </div>
    <div class="form-grid">
      <div class="form-row"><label class="form-label">Priority</label>
        <select id="t-priority">
          <option \${v('Priority')==='Normal'?'selected':''}>Normal</option>
          <option \${v('Priority')==='High'?'selected':''}>High</option>
          <option \${v('Priority')==='Urgent'?'selected':''}>Urgent</option>
        </select>
      </div>
      <div class="form-row"><label class="form-label">Status</label>
        <select id="t-status">
          <option \${v('Status')==='New'?'selected':''}>New</option>
          <option \${v('Status')==='In_Progress'||v('Status')==='In Progress'?'selected':''}>In Progress</option>
          <option \${v('Status')==='Pending_Approval'?'selected':''}>Pending Approval</option>
          <option \${v('Status')==='Completed'?'selected':''}>Completed</option>
          <option \${v('Status')==='At_Risk'?'selected':''}>At Risk</option>
        </select>
      </div>
    </div>
    <div class="form-row"><label class="form-label">Progress (0–100)</label><input id="t-progress" type="number" min="0" max="100" value="\${v('Progress')||0}"></div>
    <div class="form-row"><label class="form-label">Description</label><textarea id="t-desc">\${esc(v('Description'))}</textarea></div>
    \${editId?\`<div style="font-size:11px;color:var(--muted);margin-top:4px">Task ID: \${editId}</div>\`:''}
  \`, () => saveTask(editId), editId ? 'Save Changes' : 'Create Task');
}`,
  `// ── Task Modal ───────────────────────────────────────────────────────────────
// Dynamic by request type. Banner Upload + Promo Code QC mirror the team's
// Slack templates; "Other" keeps the generic form.
var __taskTypeOnCreate = 'banner';   // current selected type when creating
function showTaskModal(editId) {
  const editing = !!editId;
  const task = editing ? (S.tasks.find(t=>String(t.Task_ID)===String(editId))||{}) : {};
  const title = editing ? 'Edit Task' : 'Create New Task';
  // Default type inferred from existing task's Module
  if (!editing) __taskTypeOnCreate = 'banner';
  else {
    var m = String(task.Module||'').toLowerCase();
    __taskTypeOnCreate = m.indexOf('banner') >= 0 ? 'banner' : (m.indexOf('promo') >= 0 ? 'promo' : 'other');
  }
  showModal(title, taskModalShell_(editing, task), () => saveTask(editId), editing ? 'Save Changes' : 'Create Task');
  setTaskType_(__taskTypeOnCreate, editing, task);
}

function taskModalShell_(editing, task) {
  var typeBtn = function(code, label, icon) {
    return '<div data-task-type="' + code + '" onclick="setTaskType_(\\'' + code + '\\', false, null)" ' +
      'style="flex:1;padding:10px 14px;border:1px solid #30363d;border-radius:8px;cursor:pointer;text-align:center;background:#1c2128;transition:all .12s;font-size:12px;font-weight:600;user-select:none">' +
      '<div style="font-size:20px;margin-bottom:2px">' + icon + '</div>' + label + '</div>';
  };
  var typePicker = editing ? '' :
    '<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Request Type</div>' +
    '<div style="display:flex;gap:8px">' +
      typeBtn('banner', 'Banner Upload', '🖼') +
      typeBtn('promo',  'Promo Code QC',  '🎯') +
      typeBtn('other',  'Other',          '📝') +
    '</div></div>';
  return typePicker + '<div id="task-body-banner" style="display:none">' + taskBodyBanner_(task) + '</div>' +
                       '<div id="task-body-promo"  style="display:none">' + taskBodyPromo_(task)  + '</div>' +
                       '<div id="task-body-other"  style="display:none">' + taskBodyOther_(task)  + '</div>';
}

function setTaskType_(code, editing, task) {
  __taskTypeOnCreate = code;
  document.querySelectorAll('[data-task-type]').forEach(function(el){
    var on = el.getAttribute('data-task-type') === code;
    el.style.borderColor = on ? 'var(--accent)' : '#30363d';
    el.style.background  = on ? 'rgba(124,58,237,.15)' : '#1c2128';
    el.style.color       = on ? 'var(--accent)' : 'inherit';
  });
  ['banner','promo','other'].forEach(function(c){
    var el = document.getElementById('task-body-' + c);
    if (el) el.style.display = (c === code) ? '' : 'none';
  });
}

function ownerSelect_(id, current) {
  var names = rosterNames_();
  var opts = '<option value="">Select owner…</option>' + names.map(function(n){
    return '<option value="' + esc(n) + '"' + (n === current ? ' selected' : '') + '>' + esc(n) + '</option>';
  }).join('');
  return '<select id="' + id + '" style="width:100%">' + opts + '</select>';
}

function taskBodyBanner_(task) {
  var t = task || {};
  var v = function(k){ return t[k] || ''; };
  return '' +
    '<div class="form-row"><label class="form-label">Campaign Name *</label>' +
      '<input id="bt-campaign" value="' + esc(v('Campaign') || (v('Title')||'').replace(/^Banner Upload for /, '')) + '" placeholder="e.g. June Raffle, Memorial Day"></div>' +
    '<div class="form-grid">' +
      '<div class="form-row"><label class="form-label">Deadline *</label><input id="bt-deadline" type="date" value="' + fmtISO(v('Due_Date')) + '"></div>' +
      '<div class="form-row"><label class="form-label">Banner Schedule</label>' +
        '<input value="Auto-linked to Banner Schedule sheet" readonly style="background:#1c2128;color:var(--muted);font-size:11px"></div>' +
    '</div>' +
    '<div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;margin-top:6px">Banner Assignments</div>' +
    '<div id="bt-rows">' + bannerRow_({}) + '</div>' +
    '<button type="button" onclick="document.getElementById(\\'bt-rows\\').insertAdjacentHTML(\\'beforeend\\', bannerRow_({}))" style="background:transparent;border:1px dashed #30363d;color:var(--accent);font-size:12px;padding:8px 14px;border-radius:6px;cursor:pointer;width:100%;margin-top:6px">+ Add Banner</button>';
}

function bannerRow_(row) {
  var r = row || {};
  var platforms = ['WS1 v3','WS1 v4','WS2','QPRO1','QPRO2-19','QP2A','QP2B','QP2C','QP2D','Other'];
  var platOpts = platforms.map(function(p){ return '<option' + (p === r.platform ? ' selected' : '') + '>' + p + '</option>'; }).join('');
  return '<div class="bt-row" style="display:grid;grid-template-columns:90px 130px 1fr 110px 32px;gap:8px;margin-bottom:8px;align-items:center">' +
    '<input data-bt-bid placeholder="B##" value="' + esc(r.bid || '') + '" style="font-family:monospace">' +
    '<select data-bt-plat>' + platOpts + '</select>' +
    ownerSelect_('', r.owner).replace('id=""', 'data-bt-owner').replace('<select ', '<select ') +
    '<label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer"><input type="checkbox" data-bt-ai' + (r.ai ? ' checked' : '') + '> AI Auto</label>' +
    '<button type="button" onclick="this.closest(\\'.bt-row\\').remove()" style="background:transparent;border:1px solid #30363d;color:var(--red);border-radius:5px;cursor:pointer">×</button>' +
    '</div>';
}

function taskBodyPromo_(task) {
  var t = task || {};
  var v = function(k){ return t[k] || ''; };
  return '' +
    '<div class="form-grid">' +
      '<div class="form-row"><label class="form-label">QC Type</label>' +
        '<select id="pt-qctype" style="width:100%"><option>QC</option><option>Build</option><option>Test</option></select></div>' +
      '<div class="form-row"><label class="form-label">Promo Code Request</label>' +
        '<input value="Auto-linked to Promo Code Request sheet" readonly style="background:#1c2128;color:var(--muted);font-size:11px"></div>' +
    '</div>' +
    '<div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;margin-top:6px">QC Assignments</div>' +
    '<div id="pt-rows">' + promoRow_({}) + '</div>' +
    '<button type="button" onclick="document.getElementById(\\'pt-rows\\').insertAdjacentHTML(\\'beforeend\\', promoRow_({}))" style="background:transparent;border:1px dashed #30363d;color:var(--accent);font-size:12px;padding:8px 14px;border-radius:6px;cursor:pointer;width:100%;margin-top:6px">+ Add QC Range</button>' +
    '<div class="form-grid" style="margin-top:8px">' +
      '<div class="form-row"><label class="form-label">Priority *</label>' +
        '<select id="pt-priority" style="width:100%">' +
          '<option' + ((v('Priority')==='Normal')?' selected':'') + '>Normal</option>' +
          '<option' + ((v('Priority')==='High')?' selected':'') + '>High</option>' +
          '<option' + ((v('Priority')==='Urgent')?' selected':'') + '>Urgent</option>' +
        '</select></div>' +
      '<div class="form-row"><label class="form-label">EOD Deadline *</label><input id="pt-deadline" type="date" value="' + fmtISO(v('Due_Date')) + '"></div>' +
    '</div>';
}

function promoRow_(row) {
  var r = row || {};
  return '<div class="pt-row" style="display:grid;grid-template-columns:1fr 110px 110px 32px;gap:8px;margin-bottom:8px;align-items:center">' +
    ownerSelect_('', r.owner).replace('id=""', 'data-pt-owner') +
    '<input data-pt-from placeholder="P091" value="' + esc(r.from || '') + '" style="font-family:monospace">' +
    '<input data-pt-to placeholder="P096"   value="' + esc(r.to   || '') + '" style="font-family:monospace">' +
    '<button type="button" onclick="this.closest(\\'.pt-row\\').remove()" style="background:transparent;border:1px solid #30363d;color:var(--red);border-radius:5px;cursor:pointer">×</button>' +
    '</div>';
}

function taskBodyOther_(task) {
  var t = task || {};
  var v = function(k){ return t[k] || ''; };
  return '' +
    '<div class="form-row"><label class="form-label">Title *</label><input id="t-title" value="' + esc(v('Title')) + '" placeholder="e.g. Investigate FS provider mapping"></div>' +
    '<div class="form-grid">' +
      '<div class="form-row"><label class="form-label">Module</label>' +
        '<select id="t-module">' +
          ['Promo Codes','Banners','CRM','Approvals','Other'].map(function(m){return '<option' + (v('Module')===m?' selected':'') + '>' + m + '</option>';}).join('') +
        '</select></div>' +
      '<div class="form-row"><label class="form-label">Brand</label><input id="t-brand" value="' + esc(v('Brand')) + '" placeholder="e.g. QPRO1, QP2A"></div>' +
    '</div>' +
    '<div class="form-grid">' +
      '<div class="form-row"><label class="form-label">Owner</label>' + ownerSelect_('t-owner', v('Owner')) + '</div>' +
      '<div class="form-row"><label class="form-label">Due Date</label><input id="t-due" type="date" value="' + fmtISO(v('Due_Date')) + '"></div>' +
    '</div>' +
    '<div class="form-grid">' +
      '<div class="form-row"><label class="form-label">Priority</label>' +
        '<select id="t-priority">' +
          ['Normal','High','Urgent'].map(function(p){return '<option' + (v('Priority')===p?' selected':'') + '>' + p + '</option>';}).join('') +
        '</select></div>' +
      '<div class="form-row"><label class="form-label">Status</label>' +
        '<select id="t-status">' +
          ['New','In Progress','Pending Approval','Completed','At Risk'].map(function(s){return '<option' + ((v('Status')||'').replace('_',' ')===s?' selected':'') + '>' + s + '</option>';}).join('') +
        '</select></div>' +
    '</div>' +
    '<div class="form-row"><label class="form-label">Description</label><textarea id="t-desc">' + esc(v('Description')) + '</textarea></div>' +
    ((task && task.Task_ID) ? '<div style="font-size:11px;color:var(--muted);margin-top:4px">Task ID: ' + esc(task.Task_ID) + '</div>' : '');
}`);

// ─── DASHBOARD: Rewrite saveTask to handle all three task types ────────────
patch('Dashboard — saveTask handles dynamic task types',
  'dash',
  `function saveTask(editId) {
  const data = {
    Title: document.getElementById('t-title').value.trim(),
    Module: document.getElementById('t-module').value,
    Brand: document.getElementById('t-brand').value.trim(),
    Owner: document.getElementById('t-owner').value.trim(),
    Due_Date: document.getElementById('t-due').value,
    Priority: document.getElementById('t-priority').value,
    Status: document.getElementById('t-status').value,
    Progress: parseInt(document.getElementById('t-progress').value)||0,
    Description: document.getElementById('t-desc').value.trim()
  };
  if (!data.Title) { alert('Title is required'); return; }
  closeModal();`,
  `function saveTask(editId) {
  var data = (typeof __taskTypeOnCreate !== 'undefined' && __taskTypeOnCreate === 'banner') ? collectBannerTask_()
           : (typeof __taskTypeOnCreate !== 'undefined' && __taskTypeOnCreate === 'promo')  ? collectPromoTask_()
           : collectOtherTask_();
  if (!data) return;
  closeModal();`);

// ─── DASHBOARD: Add collect helpers + remove old single-block input refs ───
patch('Dashboard — Add collect helpers for new dynamic task form',
  'dash',
  `function showTaskDetail(id) {`,
  `function collectBannerTask_() {
  var campaign = (document.getElementById('bt-campaign')||{}).value || '';
  var deadline = (document.getElementById('bt-deadline')||{}).value || '';
  if (!campaign.trim()) { alert('Campaign name is required'); return null; }
  var rows = Array.prototype.map.call(document.querySelectorAll('#bt-rows .bt-row'), function(r){
    return {
      bid:   (r.querySelector('[data-bt-bid]')||{}).value || '',
      plat:  (r.querySelector('[data-bt-plat]')||{}).value || '',
      owner: (r.querySelector('[data-bt-owner]')||{}).value || '',
      ai:    !!(r.querySelector('[data-bt-ai]') && r.querySelector('[data-bt-ai]').checked),
    };
  }).filter(function(r){ return r.bid || r.owner; });
  var firstOwner = (rows[0] && rows[0].owner) || '';
  var lines = rows.map(function(r){
    var ai = r.ai ? ' AI Automation' : '';
    return r.bid + ' [' + r.plat + ']: @' + (r.owner||'unassigned') + ai;
  }).join('\\n');
  var desc = 'Task: Banner Upload for ' + campaign + '\\n' +
             'Deadline: ' + (deadline || '—') + '\\n' +
             'Banner Schedule: https://docs.google.com/spreadsheets/d/1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E/edit\\n\\n' +
             lines;
  return {
    Title: 'Banner Upload for ' + campaign,
    Module: 'Banners',
    Brand: rows.map(function(r){return r.plat;}).filter(function(v,i,a){return v && a.indexOf(v)===i;}).join(', '),
    Owner: firstOwner,
    Due_Date: deadline,
    Priority: 'Normal',
    Status: 'New',
    Description: desc,
  };
}

function collectPromoTask_() {
  var qctype = (document.getElementById('pt-qctype')||{}).value || 'QC';
  var deadline = (document.getElementById('pt-deadline')||{}).value || '';
  var priority = (document.getElementById('pt-priority')||{}).value || 'Normal';
  var rows = Array.prototype.map.call(document.querySelectorAll('#pt-rows .pt-row'), function(r){
    return {
      owner: (r.querySelector('[data-pt-owner]')||{}).value || '',
      from:  (r.querySelector('[data-pt-from]') ||{}).value || '',
      to:    (r.querySelector('[data-pt-to]')   ||{}).value || '',
    };
  }).filter(function(r){ return r.owner || r.from; });
  if (!rows.length) { alert('Add at least one QC assignment'); return null; }
  var firstOwner = rows[0].owner || '';
  var range = rows[0].from + (rows[0].to ? '-' + rows[0].to : '');
  var lines = rows.map(function(r){ return '@' + (r.owner||'unassigned') + ' ' + r.from + (r.to ? '-' + r.to : ''); }).join('\\n');
  var desc = 'Task: ' + qctype + ' https://docs.google.com/spreadsheets/d/1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM/edit\\n' +
             lines + '\\n' +
             'Priority: ' + priority + '\\n' +
             'Deadline: EOD ' + (deadline || '—');
  return {
    Title: qctype + ' ' + range,
    Module: 'Promo Codes',
    Brand: '',
    Owner: firstOwner,
    Due_Date: deadline,
    Priority: priority,
    Status: 'New',
    Description: desc,
  };
}

function collectOtherTask_() {
  var title = ((document.getElementById('t-title')||{}).value || '').trim();
  if (!title) { alert('Title is required'); return null; }
  return {
    Title: title,
    Module: (document.getElementById('t-module')||{}).value || 'Other',
    Brand:  ((document.getElementById('t-brand')||{}).value || '').trim(),
    Owner:  (document.getElementById('t-owner')||{}).value || '',
    Due_Date: (document.getElementById('t-due')||{}).value || '',
    Priority: (document.getElementById('t-priority')||{}).value || 'Normal',
    Status:   (document.getElementById('t-status')||{}).value || 'New',
    Description: ((document.getElementById('t-desc')||{}).value || '').trim(),
  };
}

function showTaskDetail(id) {`);

// ─── DASHBOARD: Remove Progress block from task detail drawer ──────────────
patch('Dashboard — Remove Progress block from task detail drawer',
  'dash',
  `    <div style="margin-bottom:14px">
      <div class="form-label">Progress</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
        <div class="progress-bar" style="flex:1;height:8px"><div class="progress-fill" style="width:\${prog}%;background:\${prog>=100?'var(--green)':prog>50?'var(--accent)':'var(--amber)'}"></div></div>
        <span style="font-size:13px;font-weight:600;color:var(--text)">\${prog}%</span>
      </div>
    </div>
    `,
  ``);

patch('Dashboard — Remove prog calc in showTaskDetail',
  'dash',
  `  const statusBadge = { 'Completed':'done','In Progress':'progress','Pending Approval':'approval','At Risk':'risk','New':'new' }[status]||'new';
  const prog = Math.min(100, parseInt(t.Progress)||0);
  showModal(t.Title || 'Task Detail', \``,
  `  const statusBadge = { 'Completed':'done','In Progress':'progress','Pending Approval':'approval','At Risk':'risk','New':'new' }[status]||'new';
  showModal(t.Title || 'Task Detail', \``);

// ─── Badge V69 → V70 ────────────────────────────────────────────────────────
patch('Badge V69 → V70', 'dash', `>V69 ✓</span>`, `>V70 ✓</span>`);

// ─── Push + version + auto-promote ───────────────────────────────────────────
proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

if (fail > 0) {
  console.error('❌ Some patches missed their anchors — aborting version bump');
  process.exit(1);
}

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V70 — Knowledge Base + Slack roster + dynamic Create-New Task + remove Progress — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'Promoted V' + v.versionNumber + ' via API — ' + new Date().toISOString(),
  },
});
console.log(`✓ Promoted live: V${promo.deploymentConfig.versionNumber}`);
