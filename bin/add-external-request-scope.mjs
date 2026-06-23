#!/usr/bin/env node
/**
 * Test: add `script.external_request` scope back to manifest. If V31 still
 * loads with this scope, the original wrapper bug was V69 HTML content, not
 * the scope. Then we can safely add Slack code.
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
const manifestIdx = proj.files.findIndex(f => f.name === 'appsscript');
const manifest = JSON.parse(proj.files[manifestIdx].source);
const NEW_SCOPE = 'https://www.googleapis.com/auth/script.external_request';
if (!manifest.oauthScopes.includes(NEW_SCOPE)) {
  manifest.oauthScopes.push(NEW_SCOPE);
  console.log('✓ Added script.external_request scope');
}
proj.files[manifestIdx].source = JSON.stringify(manifest, null, 2);

await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V31 + external_request scope (test) ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Test ext-req scope' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
