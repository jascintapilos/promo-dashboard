#!/usr/bin/env node
/**
 * deploy-dashboard-sync.mjs
 *
 * Patches the "Promotions Team Dashboard" Apps Script project to add a Slack
 * sync function and wires the existing Refresh button to call it.
 *
 * The bot token is stored in Script Properties (set via runSetup=true on first
 * deploy, then the token is wiped from this file).
 */
import { readFileSync } from 'fs';
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const SLACK_TOKEN_FILE = JSON.parse(readFileSync('slack-token.local.json', 'utf8'));
const SLACK_TOKEN = SLACK_TOKEN_FILE.token;

const { client } = await getGoogleAuth();
const accessToken = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const res = await fetch(`https://script.googleapis.com/v1${url}`, {
    method,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

// 1. Fetch current project content
console.log('Fetching project content…');
const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
console.log(`  ${proj.files.length} files: ${proj.files.map(f => f.name).join(', ')}`);

const codeIdx = proj.files.findIndex(f => f.name === 'Code');
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
if (codeIdx < 0 || dashIdx < 0) throw new Error('Code.gs or Dashboard.html missing');

// 2. Build Slack sync block (idempotent — strip prev version if present)
const MARKER_BEGIN = '// === SLACK SYNC (auto-injected) ===';
const MARKER_END   = '// === END SLACK SYNC ===';

const slackBlock = `
${MARKER_BEGIN}
// Live sync from #ba-promo + #promotions-team into Task_Master.
// Token: PropertiesService.getScriptProperties().getProperty('SLACK_TOKEN').
const SLACK_USER_MAP_ = {
  'U097Q9DTK29': { name: 'Jascinta', email: 'jascinta.pilos@thebrandingpeople.co' },
  'U03PNM6HZ5F': { name: 'Wai Yip',  email: 'waiyip@thebrandingpeople.co' },
  'U09R45VQTS4': { name: 'Alysa',    email: 'alysa@thebrandingpeople.co' },
  'U0AGCJTPZ9T': { name: 'Wen',      email: 'wen@thebrandingpeople.co' },
  'U09LNJ8AJ6P': { name: 'Elyssa',   email: 'elyssa@thebrandingpeople.co' },
  'U0B188FCFB5': { name: 'Diandra',  email: 'diandra@thebrandingpeople.co' },
  'U0AUBNBB9DK': { name: 'Gaby',     email: 'gaby@thebrandingpeople.co' },
};
const PROMO_SUBTEAM_ID_ = 'S09V5EDERHS';
const SLACK_CHANNELS_ = [
  { id: 'C07KKVD1GTE', name: 'ba-promo',         kind: 'banner' },
  { id: 'C09LT8W2D70', name: 'promotions-team',  kind: 'team' },
];

function slackApi_(method, params) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_TOKEN');
  if (!token) throw new Error('SLACK_TOKEN not set in Script Properties');
  var url = 'https://slack.com/api/' + method;
  if (params) {
    var q = Object.keys(params).map(function(k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    url += '?' + q;
  }
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  var json = JSON.parse(res.getContentText());
  if (!json.ok) throw new Error('Slack ' + method + ': ' + json.error);
  return json;
}

function fetchSlackHistory_(channelId, oldestTs) {
  var msgs = [], cursor;
  do {
    var params = { channel: channelId, limit: 200, oldest: String(oldestTs) };
    if (cursor) params.cursor = cursor;
    var data = slackApi_('conversations.history', params);
    Array.prototype.push.apply(msgs, data.messages || []);
    cursor = data.response_metadata && data.response_metadata.next_cursor;
  } while (cursor);
  return msgs;
}
function fetchSlackThread_(channelId, ts) {
  try {
    var data = slackApi_('conversations.replies', { channel: channelId, ts: ts, limit: 100 });
    return (data.messages || []).slice(1);
  } catch (e) { return []; }
}

function normalizeDeadline_(raw) {
  if (!raw) return '';
  var s = String(raw).trim();
  var m = s.match(/^(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?$/);
  if (m) {
    var day = Number(m[1]), mon = Number(m[2]), year = m[3] ? Number(m[3]) : new Date().getUTCFullYear();
    if (year < 100) year += 2000;
    var iso = year + '-' + ('0'+mon).slice(-2) + '-' + ('0'+day).slice(-2);
    if ((new Date() - new Date(iso + 'T00:00:00Z')) / 86400000 > 180) {
      return (year+1) + '-' + ('0'+mon).slice(-2) + '-' + ('0'+day).slice(-2);
    }
    return iso;
  }
  m = s.match(/^(\\d{1,2})\\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
  if (m) {
    var monMap = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    return new Date().getUTCFullYear() + '-' + ('0'+monMap[m[2].toLowerCase().slice(0,3)]).slice(-2) + '-' + ('0'+Number(m[1])).slice(-2);
  }
  return '';
}

function parseBanner_(msg) {
  var text = msg.text || '';
  if (!/task\\s*:/i.test(text)) return [];
  if (!/banner|upload|B\\d+/i.test(text)) return [];
  var lines = text.split('\\n').map(function(l){return l.trim();}).filter(Boolean);
  var taskLine = lines.filter(function(l){return /^task\\s*:/i.test(l);})[0];
  var campaign = taskLine ? taskLine.replace(/^task\\s*:\\s*/i, '').trim() : 'Banner Upload';
  var dlLine = lines.filter(function(l){return /deadline\\s*[:=]/i.test(l);})[0];
  var deadline = normalizeDeadline_(dlLine ? dlLine.replace(/.*deadline\\s*[:=]\\s*/i, '').trim() : '');
  var assignLines = lines.filter(function(l){return /^B\\d+/i.test(l) && (/@\\w+/.test(l) || /<@[A-Z0-9]+/.test(l));});
  if (!assignLines.length) return [];
  return assignLines.map(function(line) {
    var bidsMatch = line.match(/^(B[\\d\\-–,\\s]+)/i);
    var bids = bidsMatch ? bidsMatch[1].trim().replace(/\\s+/g, '') : '';
    var brandsMatch = line.match(/\\[([^\\]]+)\\]/);
    var brands = brandsMatch ? brandsMatch[1].trim() : '';
    var assigneeId = '', assigneeName = '';
    var slackRef = line.match(/<@([A-Z0-9]+)\\|([^>]+)>/);
    if (slackRef) { assigneeId = slackRef[1]; assigneeName = slackRef[2]; }
    else { var atRef = line.match(/:?\\s*@(\\w+)\\s*$/); assigneeName = atRef ? atRef[1] : ''; }
    var info = SLACK_USER_MAP_[assigneeId] || {};
    return {
      Task_ID: 'BT-' + msg.ts + '-' + bids.replace(/\\W/g,''),
      Module: 'Banners', Request_Ref: bids, Brand: brands,
      Title: '[Banner] ' + campaign.slice(0, 48) + ' — ' + bids,
      Owner: info.name || assigneeName, Submitter: info.email || '',
      Due_Date: deadline, Posted_At: new Date(parseFloat(msg.ts) * 1000).toISOString(),
      _ts: msg.ts, _channel: 'ba-promo',
    };
  });
}

function parseTeamMsg_(msg) {
  var text = msg.text || '';
  var mentionsSubteam = text.indexOf('<!subteam^' + PROMO_SUBTEAM_ID_ + '>') >= 0;
  var ids = [], re = /<@([A-Z0-9]+)(?:\\|[^>]+)?>/g, m;
  while ((m = re.exec(text))) ids.push(m[1]);
  var teamSet = {};
  Object.keys(SLACK_USER_MAP_).forEach(function(k){ teamSet[k] = true; });
  var mentionsTeamMember = ids.some(function(id) { return teamSet[id]; });
  if (!mentionsSubteam && !mentionsTeamMember) return [];
  if (text.length < 15) return [];
  var lines = text.split('\\n').map(function(l){return l.trim();}).filter(Boolean);
  var dlLine = lines.filter(function(l){return /deadline\\s*[:=]/i.test(l);})[0];
  var deadline = normalizeDeadline_(dlLine ? dlLine.replace(/.*deadline\\s*[:=]\\s*/i, '').trim() : '');
  var firstNonMention = ((lines[0] || '').replace(/<[^>]+>/g, '').trim());
  var looksLikeQuestion = /\\?\\s*$/.test(firstNonMention) && firstNonMention.length < 80;
  var hasActionVerb = /\\b(help|please|kindly|update|amend|review|create|add|fix|do|prepare|translate|upload|deploy|submit|qc|verify|monitor|delegate|brief|join|need)\\b/i.test(text);
  if (looksLikeQuestion && !deadline && !hasActionVerb) return [];
  var title = (lines[0] || text)
    .replace(/<!subteam\\^[A-Z0-9]+>/g, '')
    .replace(/<@[A-Z0-9]+(?:\\|[^>]+)?>/g, '')
    .replace(/<(https?:[^|>]+)\\|([^>]+)>/g, '$2')
    .replace(/\\s+/g, ' ').trim();
  if (title.length > 80) title = title.slice(0, 77) + '…';
  if (!title) title = '[Slack message]';
  var owner = { name: '', email: '' };
  for (var i = 0; i < ids.length; i++) {
    if (SLACK_USER_MAP_[ids[i]]) { owner = SLACK_USER_MAP_[ids[i]]; break; }
  }
  var module = 'General';
  if (/translation request|translate/i.test(text)) module = 'Translation';
  else if (/banner/i.test(text)) module = 'Banners';
  else if (/promo code|FC\\d|RN\\d|P\\d{3}/i.test(text)) module = 'Promo';
  else if (/UAT|t&c|inbox|template/i.test(text)) module = 'Content';
  return [{
    Task_ID: 'PT-' + msg.ts.replace('.',''),
    Module: module, Request_Ref: '', Brand: '',
    Title: title, Owner: owner.name || (mentionsSubteam ? 'team' : ''),
    Submitter: owner.email || '', Due_Date: deadline,
    Posted_At: new Date(parseFloat(msg.ts) * 1000).toISOString(),
    _ts: msg.ts, _channel: 'promotions-team',
  }];
}

function deriveStatus_(row, replies) {
  var DONE_RE = /\\b(done|complete[d]?|uploaded?|finished|fixed|delivered)\\b/i;
  for (var i = 0; i < replies.length; i++) {
    var text = replies[i].text || '';
    if (DONE_RE.test(text)) return 'Done';
  }
  return 'In Progress';
}

function serverSyncSlackTasks() {
  var lookbackDays = 30;
  var oldestTs = ((Date.now() / 1000) - lookbackDays * 86400).toFixed(6);
  var allRows = [];
  for (var c = 0; c < SLACK_CHANNELS_.length; c++) {
    var ch = SLACK_CHANNELS_[c];
    var parser = ch.kind === 'banner' ? parseBanner_ : parseTeamMsg_;
    var msgs = fetchSlackHistory_(ch.id, oldestTs);
    var parsed = [];
    for (var i = 0; i < msgs.length; i++) {
      var msg = msgs[i];
      if (msg.type === 'message' && !msg.subtype) {
        var rows = parser(msg);
        for (var j = 0; j < rows.length; j++) parsed.push(rows[j]);
      }
    }
    var tsCache = {};
    for (var k = 0; k < parsed.length; k++) {
      var row = parsed[k];
      if (!tsCache[row._ts]) tsCache[row._ts] = fetchSlackThread_(ch.id, row._ts);
      row.Status = deriveStatus_(row, tsCache[row._ts]);
      row.Source_Link = 'https://the-company-team-hub.slack.com/archives/' + ch.id + '/p' + row._ts.replace('.', '');
      row.Status_Updated_At = new Date().toISOString();
      allRows.push(row);
    }
  }

  var sheet = openSS_().getSheetByName('Task_Master');
  if (!sheet) throw new Error('Task_Master tab not found');
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(String);
  var idCol = headers.indexOf('Task_ID');
  var existingIds = {};
  for (var r = 1; r < data.length; r++) existingIds[data[r][idCol]] = r + 1;

  function valueFor(row, h) {
    if (h === 'Task_ID') return row.Task_ID;
    if (h === 'Module') return row.Module;
    if (h === 'Request_Ref') return row.Request_Ref || '';
    if (h === 'Brand') return row.Brand || '';
    if (h === 'Submitter') return row.Submitter || '';
    if (h === 'Submitted_At') return row.Posted_At;
    if (h === 'Title') return row.Title;
    if (h === 'Source_Link') return row.Source_Link;
    if (h === 'SOP_Ref') return row._channel === 'ba-promo' ? 'SOP-Banner-Upload' : '';
    if (h === 'Priority') return 'Normal';
    if (h === 'Due_Date') return row.Due_Date || '';
    if (h === 'Owner') return row.Owner || '';
    if (h === 'Status') return row.Status || '';
    if (h === 'Status_Updated_At') return row.Status_Updated_At;
    if (h === 'Notes') return 'From #' + row._channel;
    return '';
  }

  var newRows = allRows.filter(function(r){ return !existingIds[r.Task_ID]; });
  if (newRows.length) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, headers.length)
      .setValues(newRows.map(function(r){ return headers.map(function(h){ return valueFor(r, h); }); }));
  }

  var statusCol = headers.indexOf('Status');
  var dueCol = headers.indexOf('Due_Date');
  var updCol = headers.indexOf('Status_Updated_At');
  for (var u = 0; u < allRows.length; u++) {
    var ar = allRows[u];
    var rowNum = existingIds[ar.Task_ID];
    if (!rowNum) continue;
    if (statusCol >= 0) sheet.getRange(rowNum, statusCol + 1).setValue(ar.Status);
    if (dueCol >= 0 && ar.Due_Date) sheet.getRange(rowNum, dueCol + 1).setValue(ar.Due_Date);
    if (updCol >= 0) sheet.getRange(rowNum, updCol + 1).setValue(ar.Status_Updated_At);
  }

  return { added: newRows.length, refreshed: allRows.length - newRows.length, total: allRows.length };
}

function setupSlackToken() {
  // One-time helper. Run from Apps Script editor.
  PropertiesService.getScriptProperties().setProperty('SLACK_TOKEN', 'PASTE_TOKEN_HERE');
  return 'OK';
}
${MARKER_END}
`;

// Strip previous injection, then append fresh block
let codeSrc = proj.files[codeIdx].source;
const re = new RegExp(MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
codeSrc = codeSrc.replace(re, '').trimEnd() + '\n\n' + slackBlock.trim() + '\n';
proj.files[codeIdx].source = codeSrc;

// 3. Patch Dashboard.html — make Refresh button call serverSyncSlackTasks first
let dashSrc = proj.files[dashIdx].source;

// Find the click handler for the Refresh button. The existing pattern likely
// re-fetches tasks. We inject a Slack sync call ahead of the fetch.
const DASH_MARKER_BEGIN = '/* === SLACK_REFRESH_HOOK_BEGIN === */';
const DASH_MARKER_END   = '/* === SLACK_REFRESH_HOOK_END === */';

const dashHook = `
${DASH_MARKER_BEGIN}
// Injected: when the Tasks page renders, replace the Refresh button's
// inline onclick so it calls serverSyncSlackTasks first, then loadAllTasks.
(function() {
  // Define the global sync handler the new onclick will call.
  window.__syncSlackThenLoadTasks = function() {
    var btn = Array.from(document.querySelectorAll('button')).find(function(b) {
      return /Refresh/i.test(b.innerText || '');
    });
    var origText = btn ? btn.innerText : null;
    if (btn) { btn.disabled = true; btn.innerText = '⟳ Syncing Slack…'; }
    function finish() {
      if (btn) { btn.disabled = false; btn.innerText = origText || '⟳ Refresh'; }
      // Now call the original task loader to refresh table from sheet
      if (typeof loadAllTasks === 'function') {
        loadAllTasks(function(t) { window.S && (window.S.tasks = t); if (typeof renderTasks === 'function') renderTasks(); });
      }
    }
    google.script.run
      .withSuccessHandler(finish)
      .withFailureHandler(function(err) {
        console.warn('Slack sync failed:', err && err.message);
        finish();
      })
      .serverSyncSlackTasks();
  };

  // Watch the DOM and rewire the Refresh button whenever it appears.
  function rewireRefreshButton() {
    var btns = Array.from(document.querySelectorAll('button'));
    btns.forEach(function(b) {
      if (b.dataset.slackHooked) return;
      var oc = b.getAttribute('onclick') || '';
      if (/loadAllTasks/.test(oc) && /Refresh/i.test(b.innerText || '')) {
        b.setAttribute('onclick', '__syncSlackThenLoadTasks()');
        b.dataset.slackHooked = '1';
      }
    });
  }

  // Run on initial load, then re-run periodically (Tasks view re-renders).
  rewireRefreshButton();
  setInterval(rewireRefreshButton, 1500);
})();
${DASH_MARKER_END}
`;
const dashRe = new RegExp(DASH_MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + DASH_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
dashSrc = dashSrc.replace(dashRe, '');
// Inject hook just before </script>...</body> at end of file
dashSrc = dashSrc.replace(/<\/script>\s*<\/body>/, dashHook + '\n</script>\n</body>');
// If no </body>, append before final </script>
if (dashSrc.indexOf(DASH_MARKER_BEGIN) === -1) {
  dashSrc = dashSrc.replace(/<\/script>\s*$/, dashHook + '\n</script>');
}
proj.files[dashIdx].source = dashSrc;

// 4. PUT back
console.log('Pushing updated content…');
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Code.gs and Dashboard.html updated');

// 5. Create a new version + update active deployment so the change is live.
console.log('\nCreating new version…');
const version = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Slack sync hook on Refresh button — ' + new Date().toISOString(),
});
console.log(`  version ${version.versionNumber}`);

console.log('Listing deployments…');
const deps = await api('GET', `/projects/${SCRIPT_ID}/deployments`);
const webDep = (deps.deployments || []).find(d =>
  (d.entryPoints || []).some(e => e.entryPointType === 'WEB_APP'));
if (!webDep) {
  console.warn('  No WEB_APP deployment found — skipping deployment update.');
} else {
  console.log(`  Updating deployment ${webDep.deploymentId}…`);
  await api('PUT', `/projects/${SCRIPT_ID}/deployments/${webDep.deploymentId}`, {
    deploymentConfig: {
      versionNumber: version.versionNumber,
      manifestFileName: 'appsscript',
      description: 'Slack sync — ' + new Date().toISOString(),
    },
  });
  console.log('  ✓ Deployment updated — Refresh button now drives Slack sync.');
}

// 5. Set Script Property for token via a one-shot Apps Script Run
//    (Apps Script API lets you run via scripts.run only on deployed scripts.
//     For first-time setup, we ask the user to manually run setupSlackToken
//     from the editor.)
console.log('\nNext step: set Slack token in Script Properties.');
console.log('  Token: ' + SLACK_TOKEN);
console.log('  Option A: Open Apps Script project → Project Settings → Script Properties → Add property');
console.log('            Key: SLACK_TOKEN  Value: ' + SLACK_TOKEN);
console.log('  Option B: Edit setupSlackToken function in Code.gs, paste the token, and Run once.');
console.log('\nThen reload the dashboard. The Refresh button now fetches Slack live.');
