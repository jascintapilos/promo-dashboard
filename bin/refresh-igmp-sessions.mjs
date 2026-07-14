// Refreshes IGMP sessions for ws1-v3-my, ws1-v3-sg, and ws2 using
// stored credentials from bo-sites.local.json (passwords.promo_testbot).
//
//   node bin/refresh-igmp-sessions.mjs
//
// Runs igmp-session-capture.mjs in auto-login mode sequentially for
// each site. Playwright must be installed (npm install playwright).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LOCAL_FILE = path.resolve('bo-sites.local.json');
const cfg = JSON.parse(readFileSync(LOCAL_FILE, 'utf8'));
const pass = cfg?.passwords?.promo_testbot;
if (!pass || typeof pass !== 'string') {
  console.error('ERROR: passwords.promo_testbot not found or not a string in bo-sites.local.json');
  process.exit(1);
}

const SITES = ['ws1-v3-my', 'ws1-v3-sg', 'ws2'];
const captureScript = path.resolve('bin/igmp-session-capture.mjs');

for (const siteId of SITES) {
  console.log(`\n=== Capturing session: ${siteId} ===`);
  const result = spawnSync(
    process.execPath,
    [captureScript, `--site=${siteId}`, '--user=promo_testbot', `--pass=${pass}`],
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
