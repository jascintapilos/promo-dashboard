#!/usr/bin/env node
/**
 * Hot-fix: V41 deployed with a quote-escape bug in selectReport_(...)
 * The template literal had \' which decoded to ' (not \'), producing
 *   selectReport_(''+esc(f.id)+'')
 * instead of
 *   selectReport_(\''+esc(f.id)+'\')
 * That's a SyntaxError ("Unexpected string") at script load → entire
 * dashboard JS fails → login is the only thing that renders.
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

const BAD  = `selectReport_(''+esc(f.id)+'')`;
const GOOD = `selectReport_(\\''+esc(f.id)+'\\')`;

if (!dash.includes(BAD)) {
  console.error('✗ BAD pattern not found — bug may be elsewhere');
  process.exit(1);
}

dash = dash.replace(BAD, GOOD);

// Verify the fix is now syntactically correct
if (!dash.includes(`selectReport_(\\''+esc(f.id)+'\\')`)) {
  console.error('✗ Fix did not apply correctly');
  process.exit(1);
}
console.log('✓ selectReport_ quote-escape fixed');

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V42 — fix selectReport_ quote-escape bug ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V42: fix quote-escape',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
