#!/usr/bin/env node
/**
 * Make campaigns editable + deletable on the calendar.
 * - Adds modal CSS + container
 * - Click a campaign card → opens edit modal pre-filled
 * - + Add Campaign button → opens same modal blank
 * - Save (PUT update) + Delete (with confirm)
 * - Backend: serverUpdateCampaign(c) + serverDeleteCampaign(id)
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
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let code = proj.files[codeIdx].source;
let dash = proj.files[dashIdx].source;

// ─── Code.gs: add serverUpdateCampaign + serverDeleteCampaign ────────────────
if (!code.includes('function serverUpdateCampaign')) {
  const updateDeleteFns = `

function serverUpdateCampaign(c) {
  try {
    if (!c || !c.Campaign_ID) return { success:false, error:'Campaign_ID required' };
    var ss = openSS_();
    var sheet = ss.getSheetByName('Campaigns');
    if (!sheet) return { success:false, error:'Campaigns sheet missing' };
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(String);
    var idIdx = headers.indexOf('Campaign_ID');
    if (idIdx < 0) return { success:false, error:'No Campaign_ID column' };
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(c.Campaign_ID)) {
        ['Title','Start_Date','End_Date','Brand','Color','Notes'].forEach(function(k){
          var col = headers.indexOf(k);
          if (col >= 0 && c[k] !== undefined) sheet.getRange(i + 1, col + 1).setValue(c[k]);
        });
        return { success:true };
      }
    }
    return { success:false, error:'Campaign not found' };
  } catch (e) {
    return { success:false, error:e.message };
  }
}

function serverDeleteCampaign(id) {
  try {
    var ss = openSS_();
    var sheet = ss.getSheetByName('Campaigns');
    if (!sheet) return { success:false, error:'Campaigns sheet missing' };
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(String);
    var idIdx = headers.indexOf('Campaign_ID');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(id)) {
        sheet.deleteRow(i + 1);
        return { success:true };
      }
    }
    return { success:false, error:'Campaign not found' };
  } catch (e) {
    return { success:false, error:e.message };
  }
}
`;
  // Insert after serverSaveCampaign function
  const saveCampaignEnd = code.indexOf('function serverSaveCampaign');
  if (saveCampaignEnd >= 0) {
    // Find the closing brace of serverSaveCampaign
    var depth = 0, inFn = false, end = -1;
    for (var i = saveCampaignEnd; i < code.length; i++) {
      if (code[i] === '{') { depth++; inFn = true; }
      else if (code[i] === '}') { depth--; if (inFn && depth === 0) { end = i + 1; break; } }
    }
    if (end > 0) {
      code = code.slice(0, end) + updateDeleteFns + code.slice(end);
      console.log('✓ Code.gs: added serverUpdateCampaign + serverDeleteCampaign');
    }
  }
}

// ─── Dashboard.html: modal CSS + container + edit/delete UI ─────────────────

// 1. Add modal CSS to <style> block (find a stable anchor)
const cssAnchor = `.kb-no-link{font-size:10px;color:var(--muted);font-style:italic;margin-top:4px}`;
const modalCSS = `${cssAnchor}
/* modal */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:300;display:flex;align-items:center;justify-content:center}
.modal{background:var(--card);border:1px solid var(--border);border-radius:12px;width:90%;max-width:500px;max-height:90vh;overflow-y:auto;padding:24px}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.modal-hdr h3{margin:0;font-size:16px}
.modal-close{background:transparent;border:none;color:var(--muted);font-size:20px;cursor:pointer;padding:0;line-height:1}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;padding-top:14px;border-top:1px solid var(--border)}
.btn{padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;border:1px solid var(--border);background:var(--card2);color:var(--text);cursor:pointer}
.btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn-danger{background:transparent;border-color:var(--red);color:var(--red)}
.btn:hover{filter:brightness(1.1)}
.cal-card{position:relative}
.cal-card:hover{outline:1px solid var(--accent);outline-offset:0}`;
if (!dash.includes('.modal-bg{position:fixed')) {
  dash = dash.replace(cssAnchor, modalCSS);
  console.log('✓ Dashboard: modal CSS added');
}

// 2. Rewrite renderCalendarData to use clickable cards + new edit/delete UI
const oldRenderCalendarData = `function renderCalendarData(campaigns) {
  var year = new Date().getFullYear();
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var byMonth = {};
  (campaigns || []).forEach(function(c){
    var d = new Date(String(c.Start_Date||'').slice(0,10) + 'T12:00:00');
    if (isNaN(d)) return;
    var key = d.getMonth();
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(c);
  });

  var html = '<div class="card"><div class="card-hdr"><h3>📅 ' + year + ' Campaign Calendar</h3><button class="hdr-btn" onclick="showNewCampaign()">＋ Add Campaign</button></div><div class="card-body" style="padding:0"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1px;background:var(--border)">';
  for (var m = 0; m < 12; m++) {
    var items = byMonth[m] || [];
    html += '<div style="background:var(--card);padding:14px;min-height:140px">' +
      '<div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">' + months[m] + ' <span style="color:var(--muted);font-weight:500">· ' + items.length + '</span></div>';
    if (items.length === 0) html += '<div style="color:var(--muted);font-size:11px;font-style:italic">No campaigns</div>';
    else items.forEach(function(c){
      var d = new Date(String(c.Start_Date||'').slice(0,10) + 'T12:00:00');
      html += '<div style="background:var(--card2);padding:6px 8px;border-radius:5px;margin-bottom:4px;border-left:3px solid var(--accent);font-size:11px">' +
        '<div style="font-weight:600">' + esc(c.Title || '—') + '</div>' +
        '<div style="color:var(--muted);font-size:10px;margin-top:2px">' + d.getDate() + ' ' + months[m] + (c.Brand ? ' · ' + esc(c.Brand) : '') + '</div>' +
        '</div>';
    });
    html += '</div>';
  }
  html += '</div></div></div>';
  content(html);
}

function showNewCampaign() {
  var title = prompt('Campaign title?'); if (!title) return;
  var date = prompt('Start date (YYYY-MM-DD)?', new Date().toISOString().slice(0,10)); if (!date) return;
  var brand = prompt('Brand (optional)?') || '';
  if (typeof google === 'undefined') { toast('Demo: would add ' + title); return; }
  google.script.run.withSuccessHandler(function(){ toast('✓ Campaign added'); renderCalendar(); }).withFailureHandler(function(e){ toast('Error: ' + e.message); }).serverSaveCampaign({ Title:title, Start_Date:date, Brand:brand });
}`;

const newRenderCalendarData = `function renderCalendarData(campaigns) {
  var year = new Date().getFullYear();
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var byMonth = {};
  (campaigns || []).forEach(function(c, idx){
    c.__idx = idx;
    var d = new Date(String(c.Start_Date||'').slice(0,10) + 'T12:00:00');
    if (isNaN(d)) return;
    var key = d.getMonth();
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(c);
  });

  var html = '<div class="card"><div class="card-hdr"><h3>📅 ' + year + ' Campaign Calendar</h3><button class="hdr-btn" onclick="showCampaignModal(null)">＋ Add Campaign</button></div><div class="card-body" style="padding:0"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1px;background:var(--border)">';
  for (var m = 0; m < 12; m++) {
    var items = byMonth[m] || [];
    html += '<div style="background:var(--card);padding:14px;min-height:140px">' +
      '<div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">' + months[m] + ' <span style="color:var(--muted);font-weight:500">· ' + items.length + '</span></div>';
    if (items.length === 0) html += '<div style="color:var(--muted);font-size:11px;font-style:italic">No campaigns</div>';
    else items.forEach(function(c){
      var d = new Date(String(c.Start_Date||'').slice(0,10) + 'T12:00:00');
      html += '<div class="cal-card" onclick="showCampaignModal(\\'' + esc(c.Campaign_ID || '') + '\\')" style="background:var(--card2);padding:6px 8px;border-radius:5px;margin-bottom:4px;border-left:3px solid var(--accent);font-size:11px;cursor:pointer">' +
        '<div style="font-weight:600">' + esc(c.Title || '—') + '</div>' +
        '<div style="color:var(--muted);font-size:10px;margin-top:2px">' + d.getDate() + ' ' + months[m] + (c.Brand ? ' · ' + esc(c.Brand) : '') + '</div>' +
        '</div>';
    });
    html += '</div>';
  }
  html += '</div></div></div>';
  content(html);
}

function showCampaignModal(campaignId) {
  var c = campaignId ? (S.campaigns || []).find(function(x){ return String(x.Campaign_ID) === String(campaignId); }) : null;
  var isEdit = !!c;
  c = c || { Title:'', Start_Date:new Date().toISOString().slice(0,10), End_Date:'', Brand:'', Notes:'' };
  var modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.id = 'cm-modal';
  modal.onclick = function(e){ if (e.target === modal) closeCampaignModal(); };
  modal.innerHTML = '<div class="modal">' +
    '<div class="modal-hdr"><h3>' + (isEdit ? '✏️ Edit Campaign' : '＋ New Campaign') + '</h3><button class="modal-close" onclick="closeCampaignModal()">×</button></div>' +
    '<div class="form-row"><label class="form-label">Title *</label><input id="cm-title" value="' + esc(c.Title || '') + '" placeholder="Summer Promotion, June Raffle..."></div>' +
    '<div class="form-grid">' +
      '<div class="form-row" style="margin:0"><label class="form-label">Start Date *</label><input id="cm-start" type="date" value="' + esc(String(c.Start_Date || '').slice(0,10)) + '"></div>' +
      '<div class="form-row" style="margin:0"><label class="form-label">End Date</label><input id="cm-end" type="date" value="' + esc(String(c.End_Date || '').slice(0,10)) + '"></div>' +
    '</div>' +
    '<div class="form-row"><label class="form-label">Brand</label><input id="cm-brand" value="' + esc(c.Brand || '') + '" placeholder="MB8, QPRO1, Multi..."></div>' +
    '<div class="form-row"><label class="form-label">Notes</label><textarea id="cm-notes" placeholder="Anything to remember about this campaign...">' + esc(c.Notes || '') + '</textarea></div>' +
    '<div class="modal-actions">' +
      (isEdit ? '<button class="btn btn-danger" onclick="deleteCampaign(\\'' + esc(c.Campaign_ID) + '\\')">🗑 Delete</button>' : '') +
      '<div style="flex:1"></div>' +
      '<button class="btn" onclick="closeCampaignModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveCampaign(' + (isEdit ? '\\'' + esc(c.Campaign_ID) + '\\'' : 'null') + ')">' + (isEdit ? 'Save Changes' : 'Create') + '</button>' +
    '</div></div>';
  document.body.appendChild(modal);
  setTimeout(function(){ var t = document.getElementById('cm-title'); if (t) t.focus(); }, 50);
}

function closeCampaignModal() {
  var m = document.getElementById('cm-modal');
  if (m) m.remove();
}

function saveCampaign(id) {
  var data = {
    Campaign_ID: id || '',
    Title: (document.getElementById('cm-title').value || '').trim(),
    Start_Date: document.getElementById('cm-start').value || '',
    End_Date: document.getElementById('cm-end').value || '',
    Brand: (document.getElementById('cm-brand').value || '').trim(),
    Notes: (document.getElementById('cm-notes').value || '').trim(),
  };
  if (!data.Title) { alert('Title required'); return; }
  if (!data.Start_Date) { alert('Start date required'); return; }
  closeCampaignModal();
  if (typeof google === 'undefined') { toast('Demo: would save ' + data.Title); return; }
  var fn = id ? 'serverUpdateCampaign' : 'serverSaveCampaign';
  google.script.run
    .withSuccessHandler(function(r){
      if (r && r.success) { toast(id ? '✓ Campaign updated' : '✓ Campaign added'); renderCalendar(); }
      else toast('Error: ' + (r && r.error || 'unknown'));
    })
    .withFailureHandler(function(e){ toast('Error: ' + (e && e.message || e)); })
    [fn](data);
}

function deleteCampaign(id) {
  if (!confirm('Delete this campaign? This cannot be undone.')) return;
  closeCampaignModal();
  if (typeof google === 'undefined') { toast('Demo: would delete'); return; }
  google.script.run
    .withSuccessHandler(function(r){
      if (r && r.success) { toast('✓ Campaign deleted'); renderCalendar(); }
      else toast('Error: ' + (r && r.error || 'unknown'));
    })
    .withFailureHandler(function(e){ toast('Error: ' + (e && e.message || e)); })
    .serverDeleteCampaign(id);
}`;

if (dash.includes(oldRenderCalendarData)) {
  dash = dash.replace(oldRenderCalendarData, newRenderCalendarData);
  console.log('✓ Dashboard: campaign cards now clickable with edit modal');
} else {
  console.error('✗ Calendar render block anchor not found — calendar code may have been edited');
}

proj.files[codeIdx].source = code;
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V34 + Campaign edit/delete ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Campaign edit/delete' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
