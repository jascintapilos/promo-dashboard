// Deactivate P065 WS1 promos (Lines=20 bug) on ws1-v3-my + ws1-v3-sg
// so they can be recreated with Lines=10 via the _V2 suffix bump.
//
//   node bin/deactivate-p065-ws1-fix.mjs           # dry-run
//   node bin/deactivate-p065-ws1-fix.mjs --commit  # live

import { igmpPost } from '../src/igmp-client.js';

const DRY_RUN = !process.argv.includes('--commit');
const CODE    = 'WHALE_CRM_PROBE_GOO50FS_10X';
const SITES   = ['ws1-v3-my', 'ws1-v3-sg'];

for (const siteId of SITES) {
  let infoRes;
  try {
    infoRes = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: CODE });
  } catch (e) {
    console.error(`✗ ${siteId}: GetPromotionInfoByCode failed — ${e.message.split('\n')[0]}`);
    continue;
  }

  const promo = infoRes?.data;
  if (!promo?.PromotionId) {
    console.log(`${siteId}: no promo found for code "${CODE}" — skipping`);
    continue;
  }

  const { PromotionId, IsActive } = promo;
  console.log(`${siteId}: found PromotionId=${PromotionId} IsActive=${IsActive}`);

  if (!IsActive) {
    console.log(`  already inactive — skipping`);
    continue;
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] would POST /PM/UpdatePromotionStatus {PromotionId:${PromotionId}, IsActive:false}`);
    continue;
  }

  try {
    const r = await igmpPost(siteId, '/PM/UpdatePromotionStatus', { PromotionId, IsActive: false });
    if (r?.success) {
      console.log(`  ✓ deactivated PromotionId=${PromotionId}`);
    } else {
      console.error(`  ✗ deactivation returned success=false: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    console.error(`  ✗ UpdatePromotionStatus failed — ${e.message.split('\n')[0]}`);
  }
}

console.log(DRY_RUN ? '\n[DRY RUN] Re-run with --commit to apply.' : '\nDone.');
