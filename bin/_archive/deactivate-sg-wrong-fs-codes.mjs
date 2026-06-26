#!/usr/bin/env node
// One-off: deactivate 9 WS1-SG FreeSpin codes that have RedemptionType=Claim
// but have a min deposit requirement (should be Deposit/0). These were created
// before the RedemptionType auto-derive fix (2026-06-26).
//
// Usage: node bin/_archive/deactivate-sg-wrong-fs-codes.mjs          # dry-run
//        node bin/_archive/deactivate-sg-wrong-fs-codes.mjs --commit  # live

import { igmpPost } from '../../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');
const SITE = 'ws1-v3-sg';

const WRONG_CODES = [
  'FT_18FS_5X_040_GOO',
  'FT_28FS_5X_040_GOO_MIN100',
  'FT_48FS_5X_040_GOO_MIN100',
  'FT_28FS_5X_040_GOO_MIN300',
  'FT_48FS_5X_040_GOO_MIN300',
  'FT_88FS_5X_040_GOO',
  'FT_48FS_5X_040_GOO_MIN500',
  'FT_68FS_5X_040_GOO',
  'FT_138FS_5X_040_GOO',
];

console.log(`Mode: ${COMMIT ? 'LIVE' : 'DRY-RUN'}\n`);

// Fetch full promo list to resolve codes → PromotionIds
console.log(`Fetching promo list from ${SITE}...`);
const all = [];
for (let pg = 1; pg <= 20; pg++) {
  const r = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {});
  if (!r?.data?.length) break;
  all.push(...r.data);
  if (r.data.length < 200) break;
}

const codeMap = new Map(all.map((p) => [p.PromotionCode, p]));

console.log(`\nResolved targets:\n`);
console.log('Code'.padEnd(38) + 'PromotionId  Status');
console.log('─'.repeat(70));

const targets = [];
for (const code of WRONG_CODES) {
  const p = codeMap.get(code);
  if (!p) {
    console.log(`${code.padEnd(38)}NOT FOUND`);
  } else {
    console.log(`${code.padEnd(38)}${String(p.PromotionId).padEnd(13)}${p.IsActive ? 'Active' : 'Inactive'}`);
    targets.push(p);
  }
}

if (!COMMIT) {
  console.log('\n[dry-run] No changes made. Re-run with --commit to deactivate.\n');
  process.exit(0);
}

console.log('\nDeactivating...\n');
for (const p of targets) {
  try {
    const res = await igmpPost(SITE, '/PM/UpdatePromotionStatus', {
      PromotionId: p.PromotionId,
      Status: 0,
    });
    const ok = res?.Result?.IsSuccess ?? res?.IsSuccess ?? res?.success ?? false;
    console.log(`  ${ok ? '✓' : '✗'} ${p.PromotionCode} (id=${p.PromotionId})${ok ? '' : '  ' + JSON.stringify(res).slice(0, 100)}`);
  } catch (e) {
    console.log(`  ✗ ${p.PromotionCode} ERROR: ${e.message.split('\n')[0]}`);
  }
}

console.log('\nDone. Verify on BO that all 9 codes now show Inactive.');
