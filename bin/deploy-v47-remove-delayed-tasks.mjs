#!/usr/bin/env node
/**
 * V47 — Remove the "Top Delayed Tasks" card.
 * Trend chart now takes the full width of its row.
 */
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID     = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';

const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// Trend chart was in 1.5fr / 1fr split with delayed-tasks card.
// Replace with full-width trend chart.
const OLD_TRENDS_ROW = `  var trendsRow = '<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-bottom:14px">'
    + trendChart
    + __delayedTasksCard_()
  +'</div>';`;

const NEW_TRENDS_ROW = `  var trendsRow = '<div style="margin-bottom:14px">' + trendChart + '</div>';`;

if (!dash.includes(OLD_TRENDS_ROW)) {
  console.error('✗ trendsRow anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_TRENDS_ROW, NEW_TRENDS_ROW);
console.log('✓ Top Delayed Tasks removed; trend chart now full width');

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V47: remove Top Delayed Tasks card ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V47: drop delayed tasks',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
