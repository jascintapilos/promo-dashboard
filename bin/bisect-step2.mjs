#!/usr/bin/env node
/**
 * Bisect step 2: keep V69 Dashboard + Code, but use a minimal manifest
 * (only one scope). If this loads, the issue is something about V69's
 * scope list interacting with Apps Script's wrapper. If not, the issue
 * is in Dashboard.html or Code.gs.
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
const code = v69.files.find(f => f.name === 'Code').source;

const minimalManifest = JSON.stringify({
  timeZone: 'Asia/Singapore',
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE' },
  oauthScopes: ['https://www.googleapis.com/auth/script.scriptapp'],
}, null, 2);

await api('PUT', `/projects/${NEW_SCRIPT_ID}/content`, {
  files: [
    { name: 'appsscript', type: 'JSON',      source: minimalManifest },
    { name: 'Code',       type: 'SERVER_JS', source: code },
    { name: 'Dashboard',  type: 'HTML',      source: dash },
  ],
});
console.log('✓ V69 content + minimal manifest pushed');

const v = await api('POST', `/projects/${NEW_SCRIPT_ID}/versions`, {
  description: 'V69 with minimal manifest — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const promo = await api('PUT', `/projects/${NEW_SCRIPT_ID}/deployments/${NEW_DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: NEW_SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V69 minimal manifest',
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);
