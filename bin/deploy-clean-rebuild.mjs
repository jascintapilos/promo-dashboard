#!/usr/bin/env node
/** Deploy the clean rebuilt dashboard. */
import { readFileSync } from 'node:fs';
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

const dash = readFileSync('tmp/clean-dashboard.html', 'utf8');
const code = readFileSync('tmp/clean-code.gs', 'utf8');

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

console.log('Dashboard:', dash.length, 'chars,', dash.split('\n').length, 'lines');
console.log('Code.gs:  ', code.length, 'chars');

await api('PUT', `/projects/${SCRIPT_ID}/content`, {
  files: [
    { name: 'appsscript', type: 'JSON',      source: manifest },
    { name: 'Code',       type: 'SERVER_JS', source: code },
    { name: 'Dashboard',  type: 'HTML',      source: dash },
  ],
});
console.log('✓ Pushed to HEAD');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Clean rebuild — minimal dashboard ' + new Date().toISOString(),
});
console.log('✓ Version ' + v.versionNumber + ' created');

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Clean rebuild' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
console.log('\nURL: https://script.google.com/macros/s/' + DEPLOYMENT_ID + '/exec');
