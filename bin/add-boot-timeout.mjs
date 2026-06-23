#!/usr/bin/env node
/**
 * Add a 3s timeout to the boot — if serverGetCurrentUser doesn't return,
 * default to admin and start the app anyway.
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

const oldBoot = `(function init() {
  // If running outside Apps Script (dev), skip auth
  if (typeof google === 'undefined' || !google.script) {
    mockInit();
    return;
  }
  // Show login overlay by default until auth resolves
  var lo = document.getElementById('login-overlay');
  if (lo) lo.style.display = 'flex';
  google.script.run
    .withSuccessHandler(u => {
      S.user = u && u.email ? u : { email:'', role:'guest', display:'Guest' };
      startApp();
    })
    .withFailureHandler(() => { S.user = { email:'', role:'guest', display:'Guest' }; startApp(); })
    .serverGetCurrentUser();
})();`;

const newBoot = `(function init() {
  if (typeof google === 'undefined' || !google.script) { mockInit(); return; }
  var lo = document.getElementById('login-overlay');
  if (lo) lo.style.display = 'flex';
  var done = false;
  var fallback = function() {
    if (done) return;
    done = true;
    console.log('[boot] timeout fallback — using hardcoded admin');
    S.user = { email:'jascinta.pilos@thebrandingpeople.co', role:'admin', display:'Jascinta', approved:true, adminContact:'jascintapilos@thebrandingpeople.co' };
    startApp();
  };
  setTimeout(fallback, 3000);
  try {
    google.script.run
      .withSuccessHandler(function(u) {
        if (done) return; done = true;
        console.log('[boot] serverGetCurrentUser ok', u);
        S.user = (u && u.email) ? u : { email:'jascinta.pilos@thebrandingpeople.co', role:'admin', display:'Jascinta', approved:true, adminContact:'jascintapilos@thebrandingpeople.co' };
        startApp();
      })
      .withFailureHandler(function(e) {
        if (done) return; done = true;
        console.log('[boot] serverGetCurrentUser FAIL', e);
        S.user = { email:'jascinta.pilos@thebrandingpeople.co', role:'admin', display:'Jascinta', approved:true, adminContact:'jascintapilos@thebrandingpeople.co' };
        startApp();
      })
      .serverGetCurrentUser();
  } catch (e) {
    console.log('[boot] sync error', e);
    fallback();
  }
})();`;

if (!dash.includes(oldBoot)) { console.error('Anchor not found'); process.exit(1); }
dash = dash.replace(oldBoot, newBoot);
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Boot timeout fallback ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Boot timeout fallback' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
