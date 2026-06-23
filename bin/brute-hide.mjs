#!/usr/bin/env node
/** Brute-force hide the login overlay from the probe script. */
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

const newProbe = `<script>
console.log('[probe] script tag ran at ' + Date.now());
window.__probeRan = true;
document.addEventListener('DOMContentLoaded', function() {
  console.log('[probe] DOMContentLoaded fired');
  // Brute-force hide login overlay after 4 seconds (skipping all serverGetCurrentUser)
  setTimeout(function() {
    var lo = document.getElementById('login-overlay');
    var app = document.getElementById('app');
    if (lo) lo.style.display = 'none';
    if (app) app.style.display = 'flex';
    console.log('[probe] brute hide done. app visible?', app && app.style.display);
    var debugDiv = document.createElement('div');
    debugDiv.textContent = 'PROBE: brute-hid overlay; app shell ' + (app ? 'should be visible' : 'NOT FOUND');
    debugDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#7c3aed;color:#fff;padding:10px;font-family:sans-serif;font-size:14px;z-index:99999;text-align:center';
    document.body.appendChild(debugDiv);
  }, 4000);
});
</script>
`;

dash = dash.replace(/<script>\nconsole\.log\('\[probe\] script tag ran[\s\S]*?<\/script>\n/, newProbe);
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Brute hide overlay probe ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Brute hide' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
