// Refreshes IGMP sessions for ws1-v3-my, ws1-v3-sg, and ws2 using
// stored credentials from bo-sites.local.json (passwords.promo_testbot).
// A site whose kiosk login differs (WS1 SG uses its own 6-character kiosk
// password) can override it in igmp-creds.local.json — the same file and shape
// bin/igmp-keepalive.mjs uses:
//   { "overrides": { "ws1-v3-sg": { "password": "<kiosk password>" } } }
//
//   node bin/refresh-igmp-sessions.mjs
//
// Runs igmp-session-capture.mjs in auto-login mode sequentially for
// each site. Playwright must be installed (npm install playwright).

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LOCAL_FILE = path.resolve('bo-sites.local.json');
const cfg = JSON.parse(readFileSync(LOCAL_FILE, 'utf8'));
const pass = cfg?.passwords?.promo_testbot;
if (!pass || typeof pass !== 'string') {
  console.error('ERROR: passwords.promo_testbot not found or not a string in bo-sites.local.json');
  process.exit(1);
}

// IGMP_REFRESH_SITES=ws1-v3-my,ws2 limits a run to those sites (used by
// bin/push-promo-codes.mjs so it only logs into the site that actually failed).
const ALL_SITES = ['ws1-v3-my', 'ws1-v3-sg', 'ws2'];
const SITES = process.env.IGMP_REFRESH_SITES
  ? process.env.IGMP_REFRESH_SITES.split(',').map((s) => s.trim()).filter((s) => ALL_SITES.includes(s))
  : ALL_SITES;
const captureScript = path.resolve('bin/igmp-session-capture.mjs');

// Per-site username / password overrides (gitignored), else the shared testbot login.
const CREDS_FILE = path.resolve('igmp-creds.local.json');
const overrides = existsSync(CREDS_FILE) ? (JSON.parse(readFileSync(CREDS_FILE, 'utf8')).overrides || {}) : {};
const loginFor = (siteId) => ({
  user: overrides[siteId]?.username || 'promo_testbot',
  pass: overrides[siteId]?.password || pass,
  source: overrides[siteId]?.password ? 'site-specific login' : 'shared testbot login',
});
// A placeholder once fed "123456" into real logins and locked ws1-v3-my — never
// try a value that looks like one; a failed login counts toward the lockout.
const looksLikePlaceholder = (p) => /[<>]|password|^1234|^x+$/i.test(String(p || ''));

for (const siteId of SITES) {
  const login = loginFor(siteId);
  if (looksLikePlaceholder(login.pass)) {
    console.error(`✗ ${siteId}: the password in igmp-creds.local.json looks like a placeholder — not trying (avoids a lockout)`);
    continue;
  }
  console.log(`\n=== Capturing session: ${siteId} (${login.source}) ===`);
  const result = spawnSync(
    process.execPath,
    [captureScript, `--site=${siteId}`, `--user=${login.user}`, `--pass=${login.pass}`],
    { stdio: 'inherit', timeout: 60_000 },
  );
  if (result.status !== 0) {
    console.error(`✗ ${siteId}: exit code ${result.status}`);
    if (result.error) console.error(result.error.message);
  } else {
    console.log(`✓ ${siteId}: session captured`);
  }
}

console.log('\nDone — sessions written to igmp-sessions.local.json');
