#!/usr/bin/env node
// Refresh WS1@MY + WS1@SG IGMP sessions using stored credentials.
// Fires two auto-mode captures back-to-back; each pops a Chrome window,
// auto-fills, and closes on redirect. Cookies land in igmp-sessions.local.json.
//
// Usage:  node bin/_refresh-ws1-sessions.mjs
//         node bin/_refresh-ws1-sessions.mjs --site=ws1-v3-my   # just one

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CREDS = JSON.parse(readFileSync('igmp-creds.local.json', 'utf8'));
const SITES = process.argv.includes('--site=ws1-v3-my') ? ['ws1-v3-my']
             : process.argv.includes('--site=ws1-v3-sg') ? ['ws1-v3-sg']
             : ['ws1-v3-my', 'ws1-v3-sg'];

function credsFor(siteId) {
  const override = CREDS.overrides?.[siteId] || {};
  return {
    username: override.username || CREDS.default.username,
    password: override.password || CREDS.default.password,
  };
}

for (const siteId of SITES) {
  const { username, password } = credsFor(siteId);
  console.log(`\n━━━━ refreshing ${siteId} as ${username} ━━━━`);
  const r = spawnSync('node', [
    path.join('bin', 'igmp-session-capture.mjs'),
    `--site=${siteId}`,
    `--user=${username}`,
    `--pass=${password}`,
  ], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ session capture failed for ${siteId} (exit=${r.status})`);
    process.exit(r.status || 1);
  }
  console.log(`✓ ${siteId} session refreshed`);
}

console.log('\n━━━━ All done. Verify with a probe: ━━━━');
console.log('  node -e "import(\'./src/igmp-client.js\').then(m=>m.igmpPost(\'ws1-v3-my\',\'/PM/GetPromotionsList\',{PromotionCode:\'\',PageNumber:1,PageSize:1}).then(r=>console.log(\'MY OK\')).catch(e=>console.log(\'MY FAIL:\',e.message.slice(0,120))))"');
console.log('  node -e "import(\'./src/igmp-client.js\').then(m=>m.igmpPost(\'ws1-v3-sg\',\'/PM/GetPromotionsList\',{PromotionCode:\'\',PageNumber:1,PageSize:1}).then(r=>console.log(\'SG OK\')).catch(e=>console.log(\'SG FAIL:\',e.message.slice(0,120))))"');
