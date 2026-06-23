#!/usr/bin/env node
/**
 * Bisect which oauthScope(s) break Apps Script's HTML wrapper for V69.
 * Pass the test set as argv (comma-separated scope names) or use default.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const NEW_SCRIPT_ID = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const NEW_DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';
const OLD_SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

const ALL_SCOPES = {
  sheets:    'https://www.googleapis.com/auth/spreadsheets',
  drive_ro:  'https://www.googleapis.com/auth/drive.readonly',
  external:  'https://www.googleapis.com/auth/script.external_request',
  email:     'https://www.googleapis.com/auth/userinfo.email',
  script:    'https://www.googleapis.com/auth/script.scriptapp',
  calendar:  'https://www.googleapis.com/auth/calendar.readonly',
};

// Pick which scopes to include this round
const wanted = (process.argv[2] || 'sheets,drive_ro,email').split(',').map(s => s.trim()).filter(Boolean);
const scopes = ['https://www.googleapis.com/auth/script.scriptapp']; // always needed
for (const w of wanted) {
  if (ALL_SCOPES[w]) scopes.push(ALL_SCOPES[w]);
  else throw new Error('Unknown scope: ' + w + ' — pick from ' + Object.keys(ALL_SCOPES).join(','));
}

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

const manifest = JSON.stringify({
  timeZone: 'Asia/Singapore',
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE' },
  oauthScopes: scopes,
}, null, 2);

console.log('Testing with scopes:', scopes.map(s => s.split('/').pop()).join(', '));

await api('PUT', `/projects/${NEW_SCRIPT_ID}/content`, {
  files: [
    { name: 'appsscript', type: 'JSON',      source: manifest },
    { name: 'Code',       type: 'SERVER_JS', source: code },
    { name: 'Dashboard',  type: 'HTML',      source: dash },
  ],
});

const v = await api('POST', `/projects/${NEW_SCRIPT_ID}/versions`, {
  description: 'Bisect: ' + wanted.join('+') + ' — ' + new Date().toISOString(),
});

const promo = await api('PUT', `/projects/${NEW_SCRIPT_ID}/deployments/${NEW_DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: NEW_SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'Bisect: ' + wanted.join('+'),
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber} with [${wanted.join('+')}]`);
