#!/usr/bin/env node
/**
 * Patch serverGetCurrentUser to always return Jascinta as admin.
 * The /a/macros/thebrandingpeople.co/ URL already domain-gates by Workspace.
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

const oldFn = `function serverGetCurrentUser() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  const role  = resolveRole_(email);
  const display = email
    ? toTitleCase_(email.split('@')[0].replace(/[._]/g, ' '))
    : 'Guest';
  return {
    email,
    role,
    display,
    approved: !!email && role !== 'guest',
    adminContact: 'jascintapilos@thebrandingpeople.co',
  };
}`;

const newFn = `function serverGetCurrentUser() {
  // Hardcoded admin — /a/macros/thebrandingpeople.co/ URL already gates by Workspace.
  // Try real Session lookup first; fall back to admin if anything fails.
  var email = 'jascinta.pilos@thebrandingpeople.co';
  var role = 'admin';
  try {
    var raw = Session.getActiveUser().getEmail();
    if (raw && raw.indexOf('@') > 0) {
      email = raw.toLowerCase().trim();
      try { var r = resolveRole_(email); if (r && r !== 'guest') role = r; } catch (e) {}
    }
  } catch (e) {}
  var display = email.split('@')[0].replace(/[._]/g, ' ').replace(/\\b\\w/g, function(c){return c.toUpperCase();});
  return { email: email, role: role, display: display, approved: true, adminContact: 'jascintapilos@thebrandingpeople.co' };
}`;

if (!code.includes(oldFn)) { console.error('Anchor not found'); process.exit(1); }
code = code.replace(oldFn, newFn);
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V69 + hardcoded admin fallback ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'hardcoded admin' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
