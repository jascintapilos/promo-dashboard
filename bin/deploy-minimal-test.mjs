#!/usr/bin/env node
/**
 * Push a MINIMAL hello-world dashboard to the new project. If this renders
 * cleanly, the bug is a character pattern in V69's Dashboard.html that
 * Apps Script's wrapper can't handle. If it ALSO fails, it's a Google-side
 * outage affecting all web apps deployed by this account.
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

const minimalDash = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test</title></head>
<body style="background:#0d1117;color:#e6edf3;font-family:sans-serif;padding:40px">
<h1>✓ Minimal dashboard loads</h1>
<p>If you can read this, Apps Script's serving infrastructure is healthy.</p>
<p>That means the syntax error was caused by something specific in V69's Dashboard.html, not a Google outage.</p>
<script>console.log('hello from minimal dashboard');</script>
</body></html>`;

const minimalCode = `function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Test')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}`;

const manifest = `{
  "timeZone": "Asia/Singapore",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE" },
  "oauthScopes": ["https://www.googleapis.com/auth/script.scriptapp"]
}`;

await api('PUT', `/projects/${SCRIPT_ID}/content`, {
  files: [
    { name: 'appsscript', type: 'JSON', source: manifest },
    { name: 'Code',       type: 'SERVER_JS', source: minimalCode },
    { name: 'Dashboard',  type: 'HTML', source: minimalDash },
  ],
});
console.log('✓ Minimal content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Minimal hello-world test — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'Minimal test',
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);
console.log('\nURL: https://script.google.com/macros/s/' + DEPLOYMENT_ID + '/exec');
