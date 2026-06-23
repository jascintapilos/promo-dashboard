#!/usr/bin/env node
/**
 * Bisect V69 Dashboard by script block. Pass which block indices to KEEP
 * as comma-separated arg: e.g. "1,2,3,4,5" keeps blocks 1-5 (strips block 0).
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

const keepArg = process.argv[2] || '';
const keep = new Set(keepArg.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)));
console.log('Keeping blocks:', Array.from(keep).sort().join(','));

const v69 = await api('GET', `/projects/${OLD_SCRIPT_ID}/content?versionNumber=69`);
let dash = v69.files.find(f => f.name === 'Dashboard').source;

// Replace each script block, keeping only those in the set
let blockIdx = -1;
dash = dash.replace(/<script[^>]*>[\s\S]*?<\/script>/g, function(match) {
  blockIdx++;
  if (keep.has(blockIdx)) return match;
  return '<script>console.log("[bisect] block ' + blockIdx + ' stripped");</script>';
});

// Banner reminder
const label = 'BISECT: keeping blocks [' + Array.from(keep).sort().join(',') + ']';
const banner = '<div style="position:fixed;top:0;left:0;right:0;background:#10b981;color:#fff;padding:10px;text-align:center;font-family:sans-serif;z-index:9999">' + label + '</div>';
dash = dash.replace('<body>', '<body>' + banner);

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

const code = `function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Promo Control Tower 2026')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}`;

await api('PUT', `/projects/${NEW_SCRIPT_ID}/content`, {
  files: [
    { name: 'appsscript', type: 'JSON',      source: manifest },
    { name: 'Code',       type: 'SERVER_JS', source: code },
    { name: 'Dashboard',  type: 'HTML',      source: dash },
  ],
});
const v = await api('POST', `/projects/${NEW_SCRIPT_ID}/versions`, {
  description: 'Bisect blocks [' + Array.from(keep).sort().join(',') + '] ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${NEW_SCRIPT_ID}/deployments/${NEW_DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: NEW_SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: label },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
