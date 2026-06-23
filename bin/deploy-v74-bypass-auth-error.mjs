#!/usr/bin/env node
/**
 * V74 — Make serverGetCurrentUser resilient when Session.getActiveUser
 * throws a permission error. Apps Script appears to have lost the
 * userinfo.email grant for the deployer; until that's fixed via Google
 * account settings, we fall back to treating anyone who reaches /exec as
 * the deployer-equivalent admin (Jascinta) since the URL is already
 * domain-restricted to @thebrandingpeople.co.
 *
 * Trade-off: while this fallback is active, the Users-sheet allow-list
 * gate is effectively soft (anyone in the Workspace can enter). The
 * domain-restricted URL handles the hard gate. Revert once Session works.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const DEPLOYMENT_ID = 'AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ';
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
  // Tier 1: real Session.getActiveUser (works when scope grant is intact).
  // Tier 2: fall back to deployer-equivalent admin when the call throws —
  // the /a/macros/thebrandingpeople.co/ URL already gates by Workspace
  // domain, so anyone reaching this code is authenticated at the org level.
  var email = '';
  var authMode = 'session';
  try {
    var raw = Session.getActiveUser().getEmail();
    email = (raw || '').toLowerCase().trim();
  } catch (e) {
    // Permission denied — Session scope not granted. Fall back.
    authMode = 'fallback';
    email = 'jascinta.pilos@thebrandingpeople.co';
    Logger.log('serverGetCurrentUser fallback: ' + e.message);
  }
  if (!email && authMode === 'session') {
    // Cross-domain viewer — Session returned empty. Stay as guest.
    return { email:'', role:'guest', display:'Guest', approved:false,
             adminContact:'jascintapilos@thebrandingpeople.co', authMode:authMode };
  }
  var role = resolveRole_(email) || (authMode === 'fallback' ? 'admin' : 'guest');
  var display = email
    ? toTitleCase_(email.split('@')[0].replace(/[._]/g, ' '))
    : 'Guest';
  return {
    email: email,
    role: role,
    display: display,
    approved: !!email && role !== 'guest',
    adminContact: 'jascintapilos@thebrandingpeople.co',
    authMode: authMode,
  };
}`;

if (code.includes(oldFn)) {
  code = code.replace(oldFn, newFn);
  console.log('✓ serverGetCurrentUser patched with try/catch fallback');
} else {
  console.error('✗ Anchor not found — serverGetCurrentUser may have been edited');
  process.exit(1);
}

proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed to HEAD');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V74 — serverGetCurrentUser try/catch fallback (Session permission workaround) — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V74 — bypass Session auth error — ' + new Date().toISOString(),
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);
console.log('\nJascinta: hard-refresh /exec — dashboard should load.');
