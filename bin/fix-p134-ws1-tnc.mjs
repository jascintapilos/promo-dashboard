// Fix WS1 MY + SG T&C for P134 (FT_REL_30PCT_18X_MIN500).
// The original save missed the "Live Casino only (excluding Blackjack)" clause.
// Fetches live RewardId via GetBonusInfo, re-renders T&C via igmp-tnc.js,
// then PUTs via BulkAddorUpdatePromotionRewardContents.
//
// Usage:
//   node bin/fix-p134-ws1-tnc.mjs             # dry run (prints content)
//   node bin/fix-p134-ws1-tnc.mjs --commit    # live update

import { igmpPost } from '../src/igmp-client.js';
import { buildTncRow } from '../src/igmp-tnc.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute live updates\n');

const PROMO_CODE = 'FT_REL_30PCT_18X_MIN500';

const fixture = JSON.parse(readFileSync('./captures/requests/P134-r135.json', 'utf8'));

// Per-site record — min_deposit varies by currency (MYR 500, SGD 150)
const SITES = [
  {
    siteId: 'ws1-v3-my',
    label:  'WS1 MY',
    rec: {
      ...fixture,
      min_deposit:     500,
      cap_bonus_amount: 588,
      turnover_multiplier: 18,
      __site_override: 'ws1-v3-my',
    },
  },
  {
    siteId: 'ws1-v3-sg',
    label:  'WS1 SG',
    rec: {
      ...fixture,
      min_deposit:     150,
      cap_bonus_amount: 588,
      turnover_multiplier: 18,
      __site_override: 'ws1-v3-sg',
    },
  },
];

for (const { siteId, label, rec } of SITES) {
  console.log(`\n=== ${label} ===`);

  // 1. Get PromotionId
  const infoRes = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: PROMO_CODE });
  const promoId = infoRes?.data?.PromotionId ?? null;
  if (!promoId) {
    console.log(`  ✗ promo ${PROMO_CODE} not found — skip`);
    continue;
  }
  console.log(`  PromotionId: ${promoId}`);

  // 2. Get RewardId
  const bonusRes = await igmpPost(siteId, '/PM/GetBonusInfo', { PromotionId: promoId });
  const rewardId = bonusRes?.data?.Promotion?.PromotionRewards?.[0]?.RewardId ?? null;
  if (!rewardId) {
    console.log(`  ✗ RewardId not found — skip`);
    continue;
  }
  console.log(`  RewardId: ${rewardId}`);

  // 3. Build corrected T&C rows
  const enRow = buildTncRow(rec, 'en', 'deposit');
  const zhRow = buildTncRow(rec, 'zh', 'deposit');

  // Verify Blackjack exclusion is in the EN content
  const hasBlackjack = enRow.Content.includes('Blackjack');
  const isLcOnly = enRow.Content.includes('Live Casino');
  console.log(`  EN clause check → Live Casino: ${isLcOnly}, Blackjack exclusion: ${hasBlackjack}`);
  if (!hasBlackjack || !isLcOnly) {
    console.log(`  ✗ Blackjack exclusion not found in re-rendered content — aborting`);
    continue;
  }

  if (DRY_RUN) {
    console.log(`\n  [DRY RUN] Would PUT:`);
    const enSnippet = enRow.Content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    const zhSnippet = zhRow.Content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    console.log(`    EN: "${enSnippet}..."`);
    console.log(`    ZH: "${zhSnippet}..."`);
    console.log(`\n  Run with --commit to apply.`);
    continue;
  }

  // 4. PUT corrected T&C
  const putRes = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
    RewardId: rewardId,
    PromotionRewardContents: [enRow, zhRow],
  });
  const ok = putRes?.success === true || (Array.isArray(putRes?.message) && putRes.message.some((m) => /success/i.test(m)));
  if (ok) {
    console.log(`  ✓ T&C updated (RewardId=${rewardId})`);
  } else {
    console.log(`  ✗ PUT failed: ${JSON.stringify(putRes).slice(0, 300)}`);
  }
}

console.log('\nDone.');
