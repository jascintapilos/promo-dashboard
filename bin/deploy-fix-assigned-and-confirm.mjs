#!/usr/bin/env node
/**
 * Three fixes:
 *  1. Tasks Assigned column reads Submitted_At (real V69 field) as fallback,
 *     priority badges handle P1/P2/P3, status badges handle V69 values.
 *  2. Owner column maps email → short Slack name via S.roster.
 *  3. Replace native confirm() for campaign delete with a styled modal.
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

// ─── Fix 1: dashboard Tasks render — read Submitted_At fallback, fix badges ─
const oldTaskRow = `  sorted.forEach(function(t){
    var status = (t.Status || 'New').replace('_', ' ');
    var statusClass = /complete|done/i.test(status) ? 'green' : /progress/i.test(status) ? 'amber' : /risk/i.test(status) ? 'red' : /approv|pending/i.test(status) ? 'purple' : 'blue';
    var priClass = /urgent/i.test(t.Priority) ? 'red' : /high/i.test(t.Priority) ? 'amber' : 'muted';
    var assigned = String(t.Assigned_At || t.Created_At || '').slice(0,10);
    html += '<tr>' +
      '<td style="font-family:monospace;font-size:10px;color:var(--muted)">' + esc(String(t.Task_ID || '').slice(-8)) + '</td>' +
      '<td style="color:var(--muted);white-space:nowrap;font-size:11px">' + esc(assigned) + '</td>' +
      '<td style="font-weight:500;max-width:260px">' + esc(t.Title || '—') + '</td>' +
      '<td>' + esc(t.Module || '—') + '</td>' +
      '<td>' + esc(t.Brand || '—') + '</td>' +
      '<td>' + esc(t.Owner || '—') + '</td>' +
      '<td style="color:var(--muted);white-space:nowrap">' + esc(String(t.Due_Date || '').slice(0,10)) + '</td>' +
      '<td><span class="badge ' + priClass + '">' + esc(t.Priority || 'Normal') + '</span></td>' +
      '<td><span class="badge ' + statusClass + '">' + esc(status) + '</span></td>' +
      '</tr>';
  });`;

const newTaskRow = `  sorted.forEach(function(t){
    var rawStatus = String(t.Status || 'New');
    var status = rawStatus.replace(/_/g, ' ');
    var statusClass = /complete|done/i.test(rawStatus) ? 'green'
                    : /progress|in[ _]?prog|execut/i.test(rawStatus) ? 'amber'
                    : /risk|fail|error/i.test(rawStatus) ? 'red'
                    : /approv|pending|qc|review|ready/i.test(rawStatus) ? 'purple'
                    : /clarif/i.test(rawStatus) ? 'amber'
                    : 'blue';
    var pri = String(t.Priority || 'Normal');
    var priClass = /urgent|p1\\b/i.test(pri) ? 'red' : /high|p2\\b/i.test(pri) ? 'amber' : /normal|p3\\b/i.test(pri) ? 'muted' : 'muted';
    var priLabel = /p1\\b/i.test(pri) ? 'P1 · Urgent' : /p2\\b/i.test(pri) ? 'P2 · High' : /p3\\b/i.test(pri) ? 'P3 · Normal' : pri;
    var assigned = String(t.Assigned_At || t.Submitted_At || t.Created_At || '').slice(0,10);
    var ownerRaw = String(t.Owner || '');
    // Map email to short Slack name if roster loaded
    var ownerDisplay = ownerRaw;
    if (ownerRaw.indexOf('@') > 0 && S.roster && S.roster.length) {
      var match = S.roster.find(function(r){ return String(r.email || '').toLowerCase() === ownerRaw.toLowerCase(); });
      if (match) ownerDisplay = match.name;
    }
    html += '<tr>' +
      '<td style="font-family:monospace;font-size:10px;color:var(--muted)">' + esc(String(t.Task_ID || '').slice(-8)) + '</td>' +
      '<td style="color:var(--muted);white-space:nowrap;font-size:11px">' + esc(assigned) + '</td>' +
      '<td style="font-weight:500;max-width:260px">' + esc(t.Title || '—') + '</td>' +
      '<td>' + esc(t.Module || '—') + '</td>' +
      '<td>' + esc(t.Brand || '—') + '</td>' +
      '<td>' + esc(ownerDisplay || '—') + '</td>' +
      '<td style="color:var(--muted);white-space:nowrap">' + esc(String(t.Due_Date || '').slice(0,10)) + '</td>' +
      '<td><span class="badge ' + priClass + '">' + esc(priLabel) + '</span></td>' +
      '<td><span class="badge ' + statusClass + '">' + esc(status) + '</span></td>' +
      '</tr>';
  });`;

if (dash.includes(oldTaskRow)) {
  dash = dash.replace(oldTaskRow, newTaskRow);
  console.log('✓ Tasks: Assigned reads Submitted_At fallback + P1/P2/P3 badges + email→Slack name owner');
}

// Default sort: switch from Assigned_At to Submitted_At for richer coverage
dash = dash.replace(`var __taskSort = { col: 'Assigned_At', dir: 'desc' };`,
                    `var __taskSort = { col: 'Submitted_At', dir: 'desc' };`);

// ─── Fix 2: styled confirm modal helper ──────────────────────────────────
// Add a generic confirmDialog function + replace deleteCampaign's confirm() call
const oldCloseCampaign = `function closeCampaignModal() {
  var m = document.getElementById('cm-modal');
  if (m) m.remove();
}`;

const newCloseCampaignWithConfirmHelper = `function closeCampaignModal() {
  var m = document.getElementById('cm-modal');
  if (m) m.remove();
}

// Generic styled confirm dialog — replaces window.confirm()
function confirmDialog(opts) {
  return new Promise(function(resolve){
    opts = opts || {};
    var modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.id = 'confirm-modal';
    var done = function(v){ modal.remove(); resolve(v); };
    modal.onclick = function(e){ if (e.target === modal) done(false); };
    modal.innerHTML = '<div class="modal" style="max-width:400px">' +
      '<div class="modal-hdr"><h3>' + (opts.icon || '⚠️') + ' ' + (opts.title || 'Confirm') + '</h3></div>' +
      '<div style="font-size:13px;line-height:1.5;color:var(--text);margin-bottom:18px">' + (opts.message || 'Are you sure?') + '</div>' +
      (opts.warning ? '<div style="font-size:11px;color:var(--red);background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:6px;padding:8px 10px;margin-bottom:12px">⚠ ' + opts.warning + '</div>' : '') +
      '<div class="modal-actions">' +
        '<button class="btn" id="cd-cancel">' + (opts.cancelLabel || 'Cancel') + '</button>' +
        '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" id="cd-confirm">' + (opts.confirmLabel || 'Confirm') + '</button>' +
      '</div></div>';
    document.body.appendChild(modal);
    document.getElementById('cd-cancel').onclick = function(){ done(false); };
    document.getElementById('cd-confirm').onclick = function(){ done(true); };
    setTimeout(function(){ var c = document.getElementById('cd-confirm'); if (c) c.focus(); }, 50);
  });
}`;

if (dash.includes(oldCloseCampaign) && !dash.includes('function confirmDialog')) {
  dash = dash.replace(oldCloseCampaign, newCloseCampaignWithConfirmHelper);
  console.log('✓ Added confirmDialog helper');
}

// Replace deleteCampaign to use the styled dialog
const oldDelete = `function deleteCampaign(id) {
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

const newDelete = `function deleteCampaign(id) {
  var c = (S.campaigns || []).find(function(x){ return String(x.Campaign_ID) === String(id); });
  var titleHTML = c ? '<strong style="color:var(--text)">' + esc(c.Title || '') + '</strong>' : 'this campaign';
  confirmDialog({
    icon: '🗑',
    title: 'Delete campaign',
    message: 'Delete ' + titleHTML + ' from the year planner?',
    warning: 'This permanently removes the row from the Campaigns sheet.',
    danger: true,
    confirmLabel: 'Yes, delete',
    cancelLabel: 'Keep it',
  }).then(function(ok){
    if (!ok) return;
    closeCampaignModal();
    if (typeof google === 'undefined') { toast('Demo: would delete'); return; }
    google.script.run
      .withSuccessHandler(function(r){
        if (r && r.success) { toast('✓ Campaign deleted'); renderCalendar(); }
        else toast('Error: ' + (r && r.error || 'unknown'));
      })
      .withFailureHandler(function(e){ toast('Error: ' + (e && e.message || e)); })
      .serverDeleteCampaign(id);
  });
}`;

if (dash.includes(oldDelete)) {
  dash = dash.replace(oldDelete, newDelete);
  console.log('✓ Campaign delete now uses styled confirm modal');
}

// Also replace logOut's confirm() with the new dialog
const oldLogout = `function logOut() {
  if (!confirm('Log out?')) return;
  location.href = 'https://accounts.google.com/Logout?continue=' + encodeURIComponent(location.href.split('?')[0]);
}`;
const newLogout = `function logOut() {
  confirmDialog({
    icon: '🚪',
    title: 'Log out',
    message: 'Sign out of Promo Control Tower?',
    confirmLabel: 'Log out',
    cancelLabel: 'Stay signed in',
  }).then(function(ok){
    if (!ok) return;
    location.href = 'https://accounts.google.com/Logout?continue=' + encodeURIComponent(location.href.split('?')[0]);
  });
}`;
if (dash.includes(oldLogout)) {
  dash = dash.replace(oldLogout, newLogout);
  console.log('✓ Log Out now uses styled confirm modal');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V35 + Submitted_At fix + styled confirm ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Assigned + confirm fix' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
