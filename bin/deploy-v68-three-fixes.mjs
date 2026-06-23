#!/usr/bin/env node
/**
 * V68 — 3 changes in one push:
 *
 *  1. Remove CRM / Comms sidebar item + view.
 *  2. Remove Automation Overview card from Overview page.
 *  3. Calendar gets a Campaigns section (year-round promo/event tracker)
 *     with inline add/edit/delete — backed by a new Campaigns tab on
 *     PromoOps_Control_Layer.
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

// ─── 1. Remove CRM / Comms sidebar item ──────────────────────────────────────
patch('Remove CRM / Comms sidebar item',
  'dash',
  `      <div class="nav-item" data-view="approvals" data-section="manage" onclick="nav('approvals')"><span class="nav-icon">✍</span>Approvals</div>
      <div class="nav-item" data-view="crm" data-section="manage" onclick="nav('crm')"><span class="nav-icon">📨</span>CRM / Comms</div>
      <div class="nav-item" data-view="calendar" data-section="manage" onclick="nav('calendar')"><span class="nav-icon">📅</span>Calendar</div>`,
  `      <div class="nav-item" data-view="approvals" data-section="manage" onclick="nav('approvals')"><span class="nav-icon">✍</span>Approvals</div>
      <div class="nav-item" data-view="calendar" data-section="manage" onclick="nav('calendar')"><span class="nav-icon">📅</span>Calendar</div>`);

patch('Remove crm from titles map',
  'dash',
  `    overview:'Overview', tasks:'Task Orchestration', promos:'Promo Codes',
    banners:'Banners', approvals:'Approvals', crm:'CRM / Communication',
    calendar:'Calendar', performance:'Performance', reports:'Reports', settings:'Settings'`,
  `    overview:'Overview', tasks:'Task Orchestration', promos:'Promo Codes',
    banners:'Banners', approvals:'Approvals',
    calendar:'Calendar', performance:'Performance', reports:'Reports', settings:'Settings'`);

// ─── 2. Remove Automation Overview card from Overview page ──────────────────
patch('Remove Automation Overview card',
  'dash',
  `        <div class="card">
          <div class="card-hdr"><h3>Automation Overview</h3><a class="hint" style="color:var(--accent)">View center →</a></div>
          <div class="card-body" style="text-align:center">
            <div style="font-size:36px;font-weight:700;color:var(--green);margin:8px 0">85%</div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:16px">Automation Rate (placeholder)</div>
            <div style="display:flex;justify-content:space-around;font-size:12px">
              <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:var(--accent2)">21</div><div style="color:var(--muted)">Brands live</div></div>
              <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:var(--amber)">3</div><div style="color:var(--muted)">Bonus types</div></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-hdr"><h3>📅 Upcoming Dates</h3></div>`,
  `        <div class="card">
          <div class="card-hdr"><h3>📅 Upcoming Dates</h3></div>`);

// ─── 3a. Server-side: Campaigns CRUD ────────────────────────────────────────
patch('Server — add Campaigns CRUD (serverGetCampaigns / Save / Delete)',
  'code',
  `// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR
// ─────────────────────────────────────────────────────────────────────────────`,
  `// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGNS — year-round promo/event tracker (sheet-backed)
// ─────────────────────────────────────────────────────────────────────────────

function serverGetCampaigns() {
  try {
    const ss = openSS_();
    let sheet = ss.getSheetByName('Campaigns');
    if (!sheet) {
      sheet = ss.insertSheet('Campaigns');
      sheet.appendRow(['Campaign_ID', 'Title', 'Start_Date', 'End_Date', 'Type', 'Brand', 'Notes', 'Color', 'Created_At', 'Updated_At']);
      // Seed a few examples so the list isn't empty on first open
      var now = new Date().toISOString();
      sheet.appendRow(['C-' + Date.now(), 'Lunar New Year Promo', '2026-02-10', '2026-02-20', 'Seasonal', 'All brands', 'Multi-brand reload + free spin', '#ef4444', now, now]);
      sheet.appendRow(['C-' + (Date.now()+1), 'Mid-Year Sale', '2026-06-15', '2026-06-30', 'Campaign', 'QPRO + QP2', 'Major Q2 push', '#0ea5e9', now, now]);
      sheet.appendRow(['C-' + (Date.now()+2), 'Christmas Mega', '2026-12-15', '2026-12-31', 'Seasonal', 'All brands', 'Year-end campaign', '#10b981', now, now]);
    }
    return readSheetObjects_(sheet);
  } catch (e) { return []; }
}

function serverSaveCampaign(campaign) {
  try {
    const ss = openSS_();
    let sheet = ss.getSheetByName('Campaigns');
    if (!sheet) { serverGetCampaigns(); sheet = ss.getSheetByName('Campaigns'); }
    const now = new Date().toISOString();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const idIdx = headers.indexOf('Campaign_ID');
    // Update existing if id matches
    if (campaign.Campaign_ID) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][idIdx]) === String(campaign.Campaign_ID)) {
          headers.forEach((h, j) => {
            if (h === 'Updated_At') { sheet.getRange(i+1, j+1).setValue(now); return; }
            if (h === 'Created_At') return;
            if (campaign[h] !== undefined) sheet.getRange(i+1, j+1).setValue(campaign[h]);
          });
          return { success: true, id: campaign.Campaign_ID, action: 'updated' };
        }
      }
    }
    // Insert new
    const id = 'C-' + Date.now();
    const row = headers.map(h => {
      if (h === 'Campaign_ID') return id;
      if (h === 'Created_At') return now;
      if (h === 'Updated_At') return now;
      return campaign[h] !== undefined ? campaign[h] : '';
    });
    sheet.appendRow(row);
    return { success: true, id, action: 'added' };
  } catch (e) { return { success: false, error: e.message }; }
}

function serverDeleteCampaign(id) {
  try {
    const sheet = openSS_().getSheetByName('Campaigns');
    if (!sheet) return { success: false };
    const data = sheet.getDataRange().getValues();
    const idIdx = data[0].map(String).indexOf('Campaign_ID');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(id)) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'Not found' };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR
// ─────────────────────────────────────────────────────────────────────────────`);

// ─── 3b. Client: extend renderCalendar with Campaigns section ───────────────
patch('Client — renderCalendar now loads + renders Campaigns above Google events',
  'dash',
  `function renderCalendar() {
  content('<div class="loading"><div class="spinner"></div>Syncing your Google Calendar…</div>');
  if (typeof google === 'undefined') {
    renderCalendarData_({ ok: false, error: 'Calendar API unavailable in preview mode' });
    return;
  }
  google.script.run
    .withSuccessHandler(renderCalendarData_)
    .withFailureHandler(function(e){ renderCalendarData_({ ok: false, error: (e && e.message) || 'Unknown error' }); })
    .serverGetUpcomingEvents();
}`,
  `function renderCalendar() {
  content('<div class="loading"><div class="spinner"></div>Syncing your Google Calendar…</div>');
  if (typeof google === 'undefined') {
    renderCalendarData_({ ok: false, error: 'Calendar API unavailable in preview mode' });
    return;
  }
  // Parallel fetch: Google events + Campaigns
  var bundle = { events: null, campaigns: null };
  var pending = 2;
  function done(){ if (--pending === 0) renderCalendarData_(bundle.events, bundle.campaigns); }
  google.script.run.withSuccessHandler(function(r){ bundle.events = r; done(); }).withFailureHandler(function(e){ bundle.events = { ok:false, error: (e && e.message) }; done(); }).serverGetUpcomingEvents();
  google.script.run.withSuccessHandler(function(r){ bundle.campaigns = r || []; done(); }).withFailureHandler(function(){ bundle.campaigns = []; done(); }).serverGetCampaigns();
}`);

patch('Client — renderCalendarData_ accepts campaigns + renders Campaigns card',
  'dash',
  `function renderCalendarData_(data) {
  if (!data || !data.ok) {`,
  `function renderCalendarData_(data, campaigns) {
  if (!data || !data.ok) {`);

// Inject the Campaigns card before the Upcoming Events card
patch('Client — inject Campaigns card above Upcoming Events',
  'dash',
  `  content(
    '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">' +
      '<div class="kpi-card" style="border-top-color:#7c3aed"><div class="kpi-icon">📅</div><div class="kpi-value">' + totalCount + '</div><div class="kpi-label">Upcoming (30d)</div></div>' +
      '<div class="kpi-card" style="border-top-color:#ef4444"><div class="kpi-icon">⏰</div><div class="kpi-value">' + todayCount + '</div><div class="kpi-label">Today</div></div>' +
      '<div class="kpi-card" style="border-top-color:#0ea5e9"><div class="kpi-icon">📊</div><div class="kpi-value">' + weekCount + '</div><div class="kpi-label">This Week</div></div>' +
      '<div class="kpi-card" style="border-top-color:#10b981"><div class="kpi-icon">📆</div><div class="kpi-value" style="font-size:13px;line-height:1.3">' + esc(data.calendarName || '—') + '</div><div class="kpi-label">Calendar</div></div>' +
    '</div>' +
    '<div class="card">' +
      '<div class="card-hdr"><h3>🗓 Upcoming Events</h3>' +
        '<button class="btn btn-ghost btn-sm" onclick="renderCalendar()" style="margin-left:auto">↻ Refresh</button>' +
      '</div>' +
      '<div class="card-body" style="padding:0">' + listHtml + '</div>' +
    '</div>'
  );
}`,
  `  // Campaigns block — year-round promo/event tracker
  var campArr = campaigns || [];
  campArr.sort(function(a,b){ return String(a.Start_Date||'').localeCompare(String(b.Start_Date||'')); });
  var campHtml = campArr.length ? campArr.map(function(c){
    var color = c.Color || '#7c3aed';
    return '<div class="cmp-row" style="display:grid;grid-template-columns:160px 1fr 110px 110px 80px;gap:14px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer" onclick="editCampaign_(\\''+ esc(c.Campaign_ID) +'\\')">' +
      '<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:' + color + ';display:inline-block"></span><span style="font-size:11px;color:var(--muted);font-family:\\'SF Mono\\',monospace">' + esc((c.Start_Date||'').slice(0,10)) + '</span></div>' +
      '<div><div style="font-size:13px;font-weight:600;color:var(--text)">' + esc(c.Title || '—') + '</div>' + (c.Notes ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + esc(c.Notes) + '</div>' : '') + '</div>' +
      '<div style="font-size:11px;color:var(--muted)">' + esc(c.Type || '—') + '</div>' +
      '<div style="font-size:11px;color:var(--muted)">' + esc(c.Brand || '—') + '</div>' +
      '<div style="font-size:11px;color:var(--muted);text-align:right">' + esc((c.End_Date||'').slice(0,10)) + '</div>' +
    '</div>';
  }).join('') : '<div class="empty" style="padding:24px"><div class="empty-icon">📭</div><div>No campaigns yet — click + Add Campaign to seed your year.</div></div>';

  content(
    '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">' +
      '<div class="kpi-card" style="border-top-color:#7c3aed"><div class="kpi-icon">📅</div><div class="kpi-value">' + totalCount + '</div><div class="kpi-label">Upcoming (30d)</div></div>' +
      '<div class="kpi-card" style="border-top-color:#ef4444"><div class="kpi-icon">⏰</div><div class="kpi-value">' + todayCount + '</div><div class="kpi-label">Today</div></div>' +
      '<div class="kpi-card" style="border-top-color:#0ea5e9"><div class="kpi-icon">📊</div><div class="kpi-value">' + weekCount + '</div><div class="kpi-label">This Week</div></div>' +
      '<div class="kpi-card" style="border-top-color:#f59e0b"><div class="kpi-icon">🎯</div><div class="kpi-value">' + campArr.length + '</div><div class="kpi-label">Campaigns (year)</div></div>' +
    '</div>' +
    '<div class="card">' +
      '<div class="card-hdr"><h3>🎯 Campaigns & Events — Year View</h3>' +
        '<button class="btn btn-primary btn-sm" onclick="editCampaign_(null)" style="margin-left:auto">+ Add Campaign</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="renderCalendar()" style="margin-left:8px">↻</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:160px 1fr 110px 110px 80px;gap:14px;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--card2);font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">' +
        '<div>Start</div><div>Title / Notes</div><div>Type</div><div>Brand</div><div style="text-align:right">End</div>' +
      '</div>' +
      '<div class="card-body" style="padding:0">' + campHtml + '</div>' +
    '</div>' +
    '<div class="card">' +
      '<div class="card-hdr"><h3>🗓 Upcoming Events (Google Calendar)</h3>' +
        '<span class="hint">' + esc(data.calendarName || '') + '</span>' +
      '</div>' +
      '<div class="card-body" style="padding:0">' + listHtml + '</div>' +
    '</div>'
  );
}

// ── Campaign edit modal ────────────────────────────────────────────────────
function editCampaign_(id) {
  var existing = null;
  if (id && window.S && window.S.__campaigns) {
    existing = window.S.__campaigns.find(function(c){ return String(c.Campaign_ID) === String(id); });
  }
  if (id && !existing) {
    // Reload first
    google.script.run.withSuccessHandler(function(rows){
      window.S = window.S || {}; window.S.__campaigns = rows || [];
      editCampaign_(id);
    }).serverGetCampaigns();
    return;
  }
  var c = existing || { Campaign_ID:'', Title:'', Start_Date:'', End_Date:'', Type:'Campaign', Brand:'', Notes:'', Color:'#7c3aed' };
  var title = id ? 'Edit Campaign' : 'New Campaign';
  showModal(title,
    '<div class="form-row"><label class="form-label">Title *</label><input id="cmp-title" value="' + esc(c.Title) + '" placeholder="e.g. Lunar New Year Promo"></div>' +
    '<div class="form-grid">' +
      '<div class="form-row"><label class="form-label">Start Date *</label><input id="cmp-start" type="date" value="' + esc((c.Start_Date||\'\').slice(0,10)) + '"></div>' +
      '<div class="form-row"><label class="form-label">End Date *</label><input id="cmp-end" type="date" value="' + esc((c.End_Date||\'\').slice(0,10)) + '"></div>' +
    '</div>' +
    '<div class="form-grid">' +
      '<div class="form-row"><label class="form-label">Type</label><select id="cmp-type"><option' + (c.Type==='Campaign'?' selected':'') + '>Campaign</option><option' + (c.Type==='Seasonal'?' selected':'') + '>Seasonal</option><option' + (c.Type==='Holiday'?' selected':'') + '>Holiday</option><option' + (c.Type==='Launch'?' selected':'') + '>Launch</option><option' + (c.Type==='Other'?' selected':'') + '>Other</option></select></div>' +
      '<div class="form-row"><label class="form-label">Brand(s)</label><input id="cmp-brand" value="' + esc(c.Brand) + '" placeholder="e.g. QPRO11, All brands"></div>' +
    '</div>' +
    '<div class="form-row"><label class="form-label">Notes</label><textarea id="cmp-notes" rows="3">' + esc(c.Notes) + '</textarea></div>' +
    '<div class="form-row"><label class="form-label">Color</label><input id="cmp-color" type="color" value="' + esc(c.Color || '#7c3aed') + '" style="width:60px;height:34px;padding:2px;border:1px solid var(--border);border-radius:6px;background:var(--card2)"></div>' +
    (id ? '<button class="btn btn-ghost btn-sm" style="margin-top:8px;color:var(--red)" onclick="deleteCampaign_(\\''+ esc(id) +'\\')">🗑 Delete this campaign</button>' : ''),
    function(){ saveCampaign_(id); },
    id ? 'Save Changes' : 'Create Campaign'
  );
}

function saveCampaign_(id) {
  var data = {
    Campaign_ID: id || '',
    Title: document.getElementById('cmp-title').value.trim(),
    Start_Date: document.getElementById('cmp-start').value,
    End_Date: document.getElementById('cmp-end').value,
    Type: document.getElementById('cmp-type').value,
    Brand: document.getElementById('cmp-brand').value.trim(),
    Notes: document.getElementById('cmp-notes').value.trim(),
    Color: document.getElementById('cmp-color').value,
  };
  if (!data.Title) { toast('Title is required'); return; }
  closeModal();
  if (typeof google === 'undefined') { toast('Saved (demo)'); return; }
  google.script.run.withSuccessHandler(function(r){
    toast(r.success ? ('Campaign ' + (r.action || 'saved') + ' ✓') : ('Error: ' + r.error));
    renderCalendar();
  }).serverSaveCampaign(data);
}

function deleteCampaign_(id) {
  if (!confirm('Delete this campaign? This cannot be undone.')) return;
  closeModal();
  google.script.run.withSuccessHandler(function(r){
    toast(r.success ? 'Campaign deleted' : ('Error: ' + r.error));
    renderCalendar();
  }).serverDeleteCampaign(id);
}`);

// Badge bump
patch('Badge V66 → V68', 'dash', `>V66 ✓</span>`, `>V68 ✓</span>`);
if (dash.includes(`>V67 ✓</span>`)) {
  dash = dash.replace(`>V67 ✓</span>`, `>V68 ✓</span>`);
  console.log('  (also bumped V67 → V68)');
}

proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V68 — drop CRM + Automation Overview + Campaigns CRUD — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
