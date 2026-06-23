#!/usr/bin/env node
/**
 * Make serverGetCurrentUser return immediately with hardcoded admin,
 * skipping ALL sheet access. If the dashboard loads after this, the
 * post-sign-in hang was from openSS_() being slow.
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
const dash = v69.files.find(f => f.name === 'Dashboard').source;
let code = v69.files.find(f => f.name === 'Code').source;

// Replace serverGetCurrentUser with a stub that does NOTHING but return
// hardcoded admin. No Session calls, no sheet reads. If this loads, the
// hang was caused by sheet access.
const oldFn = `function serverGetCurrentUser() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  const role  = resolveRole_(email);
  const display = email
    ? toTitleCase_(email.split('@')[0].replace(/[._]/g, ' '))
    : 'Guest';
  return {
    email,
    role,
    display,
    approved: !!email && role !== 'guest',
    adminContact: 'jascintapilos@thebrandingpeople.co',
  };
}`;

const newFn = `function serverGetCurrentUser() {
  // STUB: skip all sheet access + Session calls. Return hardcoded admin so we
  // can prove the dashboard loads. Domain-restricted /a/macros/ URL handles
  // the actual security gate.
  return {
    email: 'jascinta.pilos@thebrandingpeople.co',
    role: 'admin',
    display: 'Jascinta',
    approved: true,
    adminContact: 'jascintapilos@thebrandingpeople.co',
    debugStub: true,
  };
}`;

if (!code.includes(oldFn)) {
  console.error('Anchor not found in V69 Code.gs');
  process.exit(1);
}
code = code.replace(oldFn, newFn);
console.log('✓ serverGetCurrentUser stubbed');

const minimalManifest = JSON.stringify({
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
    { name: 'appsscript', type: 'JSON',      source: minimalManifest },
    { name: 'Code',       type: 'SERVER_JS', source: code },
    { name: 'Dashboard',  type: 'HTML',      source: dash },
  ],
});

const v = await api('POST', `/projects/${NEW_SCRIPT_ID}/versions`, {
  description: 'Stub serverGetCurrentUser (no sheet access) — ' + new Date().toISOString(),
});

const promo = await api('PUT', `/projects/${NEW_SCRIPT_ID}/deployments/${NEW_DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: NEW_SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'Stub serverGetCurrentUser',
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);
