#!/usr/bin/env node
/** Pass start,end chars of block 0 to keep. e.g. "0,48767" */
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

const [startStr, endStr] = (process.argv[2] || '0,48767').split(',');
const start = parseInt(startStr, 10);
const end = parseInt(endStr, 10);
const v69 = await api('GET', `/projects/${OLD_SCRIPT_ID}/content?versionNumber=69`);
let dash = v69.files.find(f => f.name === 'Dashboard').source;
const m = [...dash.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
const block0 = m[0][1];
const newBlock0 = block0.slice(start, end);

let blockIdx = -1;
dash = dash.replace(/<script[^>]*>[\s\S]*?<\/script>/g, function(match) {
  blockIdx++;
  if (blockIdx === 0) return '<script>\n' + newBlock0 + '\n</script>';
  return '<script>console.log("[bisect] block ' + blockIdx + ' stripped");</script>';
});

const label = 'BISECT block 0 chars [' + start + ',' + end + '] = ' + newBlock0.length + ' chars';
const banner = '<div style="position:fixed;top:0;left:0;right:0;background:#10b981;color:#fff;padding:10px;text-align:center;font-family:sans-serif;z-index:9999">' + label + '</div>';
dash = dash.replace('<body>', '<body>' + banner);

const manifest = JSON.stringify({
  timeZone: 'Asia/Singapore', exceptionLogging: 'STACKDRIVER', runtimeVersion: 'V8',
  webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE' },
  oauthScopes: ['https://www.googleapis.com/auth/script.scriptapp', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/userinfo.email'],
}, null, 2);
const code = `function doGet(e) { return HtmlService.createHtmlOutputFromFile('Dashboard').setTitle('Promo Control Tower 2026').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); }`;

await api('PUT', `/projects/${NEW_SCRIPT_ID}/content`, {
  files: [
    { name: 'appsscript', type: 'JSON',      source: manifest },
    { name: 'Code',       type: 'SERVER_JS', source: code },
    { name: 'Dashboard',  type: 'HTML',      source: dash },
  ],
});
const v = await api('POST', `/projects/${NEW_SCRIPT_ID}/versions`, { description: label + ' ' + new Date().toISOString() });
const promo = await api('PUT', `/projects/${NEW_SCRIPT_ID}/deployments/${NEW_DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: NEW_SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: label },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber + ': ' + label);
