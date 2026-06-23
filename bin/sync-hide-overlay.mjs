#!/usr/bin/env node
/**
 * Synchronously hide the login overlay at the very TOP of the boot script,
 * before any other code runs. If THIS works, my code IS running and the
 * issue is in startApp(). If it doesn't, the boot script isn't running at all.
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
let dash = proj.files[dashIdx].source;

// Insert a SYNCHRONOUS hide-overlay BEFORE the IIFE — first thing on page after body
const probe = `<script>
console.log('[probe] script tag ran at ' + Date.now());
window.__probeRan = true;
document.addEventListener('DOMContentLoaded', function() {
  console.log('[probe] DOMContentLoaded fired');
  var lo = document.getElementById('login-overlay');
  console.log('[probe] login-overlay element:', !!lo);
  if (lo) {
    lo.style.outline = '5px solid red';
    var debugDiv = document.createElement('div');
    debugDiv.id = 'probe-banner';
    debugDiv.textContent = 'PROBE RAN — login overlay was reachable';
    debugDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#10b981;color:#fff;padding:10px;font-family:sans-serif;font-size:14px;z-index:99999;text-align:center';
    document.body.appendChild(debugDiv);
  }
});
</script>
`;

// Insert RIGHT AFTER <body> to confirm scripts run at all
if (!dash.includes('<div id="login-overlay">')) { console.error('login-overlay anchor not found'); process.exit(1); }
if (!dash.includes('id="probe-banner"')) {
  dash = dash.replace('<body>', '<body>\n' + probe);
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Probe banner — sync DOM access ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Probe banner' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
