#!/usr/bin/env node
/**
 * V72 — Add a diagnostic function so Jascinta can manually verify what
 * Apps Script sees as her identity. No UI change. After running and reading
 * the log, we'll know whether Session.getActiveUser() is broken, or if it's
 * the Users sheet lookup that fails.
 *
 * After this deploys, Jascinta opens the editor, picks `aaa_whoAmI` from
 * the function dropdown, clicks Run, and shares what the log shows.
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

const diag = `
// === AUTH DIAGNOSTIC ===
// Run this from the editor (Run menu → aaa_whoAmI) when login is broken.
// Output appears in View → Executions (or Logs).
function aaa_whoAmI() {
  var out = {};
  try { out.activeUserEmail = Session.getActiveUser().getEmail(); } catch (e) { out.activeUserEmail = 'ERR: ' + e.message; }
  try { out.effectiveUserEmail = Session.getEffectiveUser().getEmail(); } catch (e) { out.effectiveUserEmail = 'ERR: ' + e.message; }
  try { out.activeUserLocale = Session.getActiveUserLocale(); } catch (e) { out.activeUserLocale = 'ERR: ' + e.message; }
  try {
    var ss = openSS_();
    var sheet = ss.getSheetByName('Users');
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      out.usersSheetRows = data.length;
      out.usersSheetEmails = data.slice(1).map(function(r){ return r[0]; });
    } else out.usersSheetRows = 'no Users tab';
  } catch (e) { out.usersSheetErr = e.message; }
  try { out.serverCurrentUser = serverGetCurrentUser(); } catch (e) { out.serverCurrentUserErr = e.message; }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
// === END AUTH DIAGNOSTIC ===

`;

// Insert at top of Code.gs (after the SS_ID line)
if (code.includes('function aaa_whoAmI()')) {
  console.log('aaa_whoAmI already exists — skipping insertion');
} else {
  code = code.replace(
    `const SS_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';`,
    `const SS_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';\n${diag}`
  );
  console.log('✓ aaa_whoAmI inserted');
}

proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed to HEAD');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V72 — aaa_whoAmI diagnostic (V69 + diagnostic only) — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V72 diagnostic — ' + new Date().toISOString(),
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);
console.log('\nNext: open the Apps Script editor, pick aaa_whoAmI from the function dropdown, click Run, then paste the log output here.');
