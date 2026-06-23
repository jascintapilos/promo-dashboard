#!/usr/bin/env node
/**
 * Deploy a CLEAN minimal verification dashboard so we know the URL works
 * end-to-end before reattaching the full V69 dashboard.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const NEW_SCRIPT_ID = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const NEW_DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';
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

const code = `const SS_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Promo Control Tower 2026')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function serverPing() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Task_Master');
    return {
      ok: true,
      ts: new Date().toISOString(),
      sheetTitle: ss.getName(),
      taskRows: sheet ? sheet.getLastRow() : 0,
    };
  } catch (e) {
    return { ok: false, err: String(e.message || e) };
  }
}
`;

const dash = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Promo Control Tower 2026</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { background:#0d1117; color:#e6edf3; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:12px; padding:32px; max-width:520px; width:90%; }
  h1 { margin:0 0 6px 0; font-size:22px; }
  .sub { color:#8b949e; font-size:13px; margin-bottom:24px; }
  .row { display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid rgba(48,54,61,.5); font-size:13px; }
  .row:last-child { border-bottom:none; }
  .row .label { color:#8b949e; min-width:140px; }
  .pill { padding:3px 10px; border-radius:8px; font-size:11px; font-weight:600; }
  .ok { background:rgba(16,185,129,.15); color:#10b981; }
  .err { background:rgba(239,68,68,.15); color:#ef4444; }
  .wait { background:rgba(245,158,11,.15); color:#f59e0b; }
  .btn { background:#7c3aed; color:#fff; border:none; padding:10px 18px; border-radius:8px; cursor:pointer; font-size:13px; margin-top:18px; }
  .btn:hover { background:#6d28d9; }
  pre { background:#0d1117; border:1px solid #30363d; border-radius:6px; padding:10px; font-size:11px; color:#8b949e; white-space:pre-wrap; word-break:break-all; }
</style>
</head>
<body>
<div class="card">
  <h1>🏢 Promo Control Tower 2026</h1>
  <div class="sub">Verification page — confirms the new deployment is healthy.</div>

  <div class="row"><span class="label">Page render</span><span class="pill ok">✓ OK</span></div>
  <div class="row"><span class="label">JS execution</span><span id="js-pill" class="pill wait">…</span></div>
  <div class="row"><span class="label">Server roundtrip</span><span id="srv-pill" class="pill wait">…</span></div>
  <div class="row"><span class="label">Sheet access</span><span id="sheet-pill" class="pill wait">…</span></div>

  <button class="btn" onclick="runPing()">Re-run check</button>
  <pre id="log">Booting…</pre>
</div>

<script>
function log(msg) {
  var el = document.getElementById('log');
  el.textContent = new Date().toISOString().slice(11,19) + ' ' + msg + '\\n' + el.textContent;
}

function setPill(id, kind, text) {
  var el = document.getElementById(id);
  el.className = 'pill ' + kind;
  el.textContent = text;
}

function runPing() {
  setPill('js-pill', 'ok', '✓ OK');
  log('JS running. Calling serverPing…');
  if (typeof google === 'undefined' || !google.script) {
    setPill('srv-pill', 'err', '✗ no google.script');
    log('No google.script available (running outside Apps Script?)');
    return;
  }
  setPill('srv-pill', 'wait', '…');
  google.script.run
    .withSuccessHandler(function(r) {
      log('serverPing returned: ' + JSON.stringify(r));
      if (r && r.ok) {
        setPill('srv-pill', 'ok', '✓ OK');
        setPill('sheet-pill', 'ok', '✓ ' + r.taskRows + ' rows');
      } else {
        setPill('srv-pill', 'err', '✗ ' + (r && r.err || 'fail'));
        setPill('sheet-pill', 'err', '✗ ' + (r && r.err || 'no access'));
      }
    })
    .withFailureHandler(function(e) {
      log('serverPing FAILED: ' + (e && e.message || e));
      setPill('srv-pill', 'err', '✗ ' + (e && e.message || 'fail').slice(0, 40));
      setPill('sheet-pill', 'err', '✗ skip');
    })
    .serverPing();
}

runPing();
</script>
</body>
</html>`;

const manifest = JSON.stringify({
  timeZone: 'Asia/Singapore',
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE' },
  oauthScopes: [
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
}, null, 2);

await api('PUT', `/projects/${NEW_SCRIPT_ID}/content`, {
  files: [
    { name: 'appsscript', type: 'JSON',      source: manifest },
    { name: 'Code',       type: 'SERVER_JS', source: code },
    { name: 'Dashboard',  type: 'HTML',      source: dash },
  ],
});

const v = await api('POST', `/projects/${NEW_SCRIPT_ID}/versions`, {
  description: 'Clean verification page — ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${NEW_SCRIPT_ID}/deployments/${NEW_DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: NEW_SCRIPT_ID, versionNumber: v.versionNumber,
    manifestFileName: 'appsscript', description: 'Clean verify',
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);
console.log('URL: https://script.google.com/macros/s/' + NEW_DEPLOYMENT_ID + '/exec');
