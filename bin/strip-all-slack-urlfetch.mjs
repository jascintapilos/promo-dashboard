#!/usr/bin/env node
/**
 * Strip EVERY UrlFetchApp/Slack reference from Code.gs. Apps Script's static
 * scope analyzer auto-adds external_request scope when it sees UrlFetchApp,
 * even if the manifest doesn't list it — and that scope re-breaks the HTML
 * wrapper. Solution: nuke all UrlFetchApp call sites.
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
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
let code = proj.files[codeIdx].source;

// Find the start of the Slack block and chop everything from there to the end
// of Code.gs that touches UrlFetchApp.
//
// Specifically: SLACK_USERS_, slackApi_, fetchSlackHistory_, fetchSlackThread_,
// any function that calls UrlFetchApp.fetch, plus their constants.
const slackBlockStart = code.indexOf("'U0AUBNBB9DK'");
const slackBlockMarker = code.lastIndexOf('// SLACK', slackBlockStart);
const blockStart = slackBlockMarker >= 0 ? slackBlockMarker
                  : (slackBlockStart >= 0 ? code.lastIndexOf('\n', code.lastIndexOf('const SLACK_USERS_', slackBlockStart) || slackBlockStart) : -1);

if (blockStart < 0) {
  // No explicit start anchor; just strip all UrlFetchApp call sites + their functions.
  // Replace every UrlFetchApp.fetch(...) call with throw.
  const before = code.length;
  code = code.replace(/UrlFetchApp\.fetch\s*\([^)]*\)/g, '(function(){throw new Error("Slack disabled");})()');
  console.log('Replaced UrlFetchApp.fetch sites (chars: ' + before + ' → ' + code.length + ')');
} else {
  // Cut from the Slack block to end of file (or before next major section)
  console.log('Cutting Slack block from char', blockStart);
  code = code.slice(0, blockStart) + '\n// Slack integration removed for Apps Script scope hygiene.\n';
  console.log('Code.gs now', code.length, 'chars');
}

// Final sanity: confirm no UrlFetchApp left
const remaining = (code.match(/UrlFetchApp/g) || []).length;
console.log('Remaining UrlFetchApp references:', remaining);
if (remaining > 0) {
  console.log('Stripping remaining references…');
  code = code.replace(/.*UrlFetchApp.*/g, '// (stripped)');
  console.log('After strip:', (code.match(/UrlFetchApp/g) || []).length);
}

proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V20 + strip ALL UrlFetchApp (fix auto-added external_request) — ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Strip UrlFetchApp' },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);
