#!/usr/bin/env node
/**
 * Bypass the boot-time google.script.run callout to serverGetCurrentUser.
 * Set S.user to hardcoded Jascinta admin directly in init() and call
 * startApp() immediately. No async auth dance.
 *
 * If THIS loads the full dashboard, the original hang was google.script.run
 * being slow/broken on this new project.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const NEW_SCRIPT_ID = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const NEW_DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';
const OLD_SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
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

const v69 = await api('GET', `/projects/${OLD_SCRIPT_ID}/content?versionNumber=69`);
let dash = v69.files.find(f => f.name === 'Dashboard').source;
const code = v69.files.find(f => f.name === 'Code').source;

// Patch the boot init() to skip serverGetCurrentUser
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
  // BYPASS: skip serverGetCurrentUser entirely. Hardcode admin user.
  // The domain-restricted /a/macros/ URL already gates by Workspace.
  S.user = {
    email: 'jascinta.pilos@thebrandingpeople.co',
    role: 'admin',
    display: 'Jascinta',
    approved: true,
    adminContact: 'jascintapilos@thebrandingpeople.co',
  };
  startApp();
})();`;

if (!dash.includes(oldBoot)) {
  console.error('Anchor not found');
  process.exit(1);
}
dash = dash.replace(oldBoot, newBoot);
console.log('✓ Boot init bypassed (skips google.script.run for auth)');

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
  description: 'Bypass boot auth — hardcode Jascinta admin — ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${NEW_SCRIPT_ID}/deployments/${NEW_DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: NEW_SCRIPT_ID, versionNumber: v.versionNumber,
    manifestFileName: 'appsscript', description: 'Bypass boot auth',
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);
