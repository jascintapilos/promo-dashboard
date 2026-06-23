#!/usr/bin/env node
/**
 * Test V69 with HTML comments stripped from inside <script> blocks.
 * HTML5 parsers enter "script data escaped" mode when they encounter
 * <!-- inside a script tag, which can break Apps Script's content wrapping.
 */
import { getGoogleAuth } from '../src/google-auth.js';
import { readFileSync } from 'node:fs';
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

// Fetch V69 from old project (we still have it as a version reference)
const v69 = await api('GET', `/projects/1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_/content?versionNumber=69`);
let dash = v69.files.find(f => f.name === 'Dashboard').source;

// Strip HTML comments from inside <script> blocks only — they're cosmetic comments
// in template-literal HTML and never matter at runtime.
let stripped = 0;
dash = dash.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (match, body) => {
  const newBody = body.replace(/<!--[\s\S]*?-->/g, () => { stripped++; return ''; });
  return match.replace(body, newBody);
});
console.log('Stripped', stripped, 'HTML comments from <script> blocks');

const files = v69.files.map(f => f.name === 'Dashboard' ? { ...f, source: dash } : f);
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files });
console.log('✓ Content pushed (V69 with HTML comments stripped from scripts)');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V69 minus HTML comments inside scripts — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V69 minus html comments',
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);
console.log('\nURL: https://script.google.com/macros/s/' + DEPLOYMENT_ID + '/exec');
