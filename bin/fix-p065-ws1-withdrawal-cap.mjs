// Fix P065 (WHALE_CRM_PROBE_GOO50FS_10X) WS1_MY + WS1_SG:
// WithdrawalCap was saved as 0 instead of 30000 because the IGMP mapper
// didn't fall through parsed.max_transfer_out → withdrawal_cap.
// (Bug fixed 2026-07-13 in src/api-mapper-igmp.js.)
//
// This script patches the existing reward records:
//   1. GET current PromotionRewardContents (to re-post after wipe)
//   2. PUT UpdatePromotionRewardDetails with WithdrawalCap=30000
//   3. POST BulkAddorUpdatePromotionRewardContents to restore T&C
//
//   node bin/fix-p065-ws1-withdrawal-cap.mjs            # dry-run
//   node bin/fix-p065-ws1-withdrawal-cap.mjs --commit   # live
import { igmpPost } from '../src/igmp-client.js';
import { buildTncRow } from '../src/igmp-tnc.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
const PROMO_CODE = 'WHALE_CRM_PROBE_GOO50FS_10X';
const rec = JSON.parse(readFileSync('./captures/requests/P065-r66.json', 'utf8'));

const SITES = [
  { siteId: 'ws1-v3-my', brand: 'WS1_MY', expectedRewardId: 15354, promotionId: 3815 },
  { siteId: 'ws1-v3-sg', brand: 'WS1_SG', expectedRewardId: 13137, promotionId: 2959 },
];

for (const { siteId, brand, expectedRewardId, promotionId } of SITES) {
  console.log(`\n── ${brand} (${siteId}) ──`);

  // 1. Fetch live FreeSpin promo info to confirm reward structure.
  let rewardId = expectedRewardId;
  let liveReward;
  try {
    const fsInfo = await igmpPost(siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: promotionId });
    liveReward = fsInfo?.data?.PromotionRewards?.[0];
    if (!liveReward) throw new Error('PromotionRewards[0] absent from response');
    rewardId = liveReward.RewardId ?? expectedRewardId;
    console.log(`  Live  PromotionId=${promotionId}  RewardId=${rewardId}  WithdrawalCap=${liveReward.WithdrawalCap}`);
    if (Number(liveReward.WithdrawalCap) === 30000) {
      console.log(`  ✓ Already 30000 — skipping ${brand}`);
      continue;
    }
  } catch (e) {
    console.error(`  ✗ Failed to fetch live state: ${e.message}`);
    continue;
  }

  // 2. Read current PromotionRewardContents (to restore after wipe).
  let existingContents = [];
  try {
    const contRes = await igmpPost(siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
    existingContents = contRes?.data || [];
    console.log(`  Read ${existingContents.length} T&C locale row(s)`);
  } catch (e) {
    console.warn(`  ⚠ Could not read existing T&C (will rebuild from source): ${e.message}`);
  }

  // 3. Build the update payload — preserve all live fields, patch WithdrawalCap.
  const rewardUpdate = {
    RewardId: rewardId,
    PromotionId: promotionId,
    FreeSpinId: liveReward.FreeSpinId,
    RewardName: liveReward.RewardName,
    RedemptionType: liveReward.RedemptionType,
    MinimumActionAmount: liveReward.MinimumActionAmount,
    RewardType: liveReward.RewardType,
    BonusPercentage: liveReward.BonusPercentage ?? 0,
    RolloverMultiplier: liveReward.RolloverMultiplier,
    FixedBonusAmount: liveReward.FixedBonusAmount ?? 0,
    FixedRolloverAmount: liveReward.FixedRolloverAmount ?? 0,
    PhysicalGiftDescription: liveReward.PhysicalGiftDescription ?? '',
    RedeemableQuantity: liveReward.RedeemableQuantity ?? 0,
    RemainingQuantity: liveReward.RemainingQuantity ?? 0,
    IsActive: liveReward.IsActive ?? true,
    RolloverType: liveReward.RolloverType ?? '0',
    CapBonusAmount: liveReward.CapBonusAmount ?? 0,
    RedeemableKYCStatus: liveReward.RedeemableKYCStatus ?? 0,
    WithdrawalCap: 30000,   // ← THE FIX
    MaximumBalance: liveReward.MaximumBalance ?? 0,
    ExpiryMinutes: liveReward.ExpiryMinutes ?? 0,
  };

  console.log(`  Patch  WithdrawalCap: ${liveReward.WithdrawalCap} → 30000`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would PUT UpdatePromotionRewardDetails (RewardId=${rewardId})`);
  } else {
    try {
      const putRes = await igmpPost(siteId, '/PM/UpdatePromotionRewardDetails', rewardUpdate);
      const ok = putRes?.success === true ||
        (Array.isArray(putRes?.message) && putRes.message.some((m) => /success/i.test(m)));
      if (!ok) throw new Error(`PUT returned: ${JSON.stringify(putRes).slice(0, 200)}`);
      console.log(`  ✓ UpdatePromotionRewardDetails OK (RewardId=${rewardId})`);
    } catch (e) {
      console.error(`  ✗ UpdatePromotionRewardDetails failed: ${e.message}`);
      continue;
    }
  }

  // 4. Restore T&C (UpdatePromotionRewardDetails wipes PromotionRewardContents).
  // Explicitly set withdrawal_cap from parsed.max_transfer_out so buildTncRow
  // emits the cap clause (it reads rec.withdrawal_cap, not parsed.*).
  const siteRec = { ...rec, withdrawal_cap: rec.parsed?.max_transfer_out ?? 0, __site_override: siteId };
  const enRow = buildTncRow(siteRec, 'en', 'free spin');
  const zhRow = buildTncRow(siteRec, 'zh', 'free spin');

  const rowsToPost = existingContents.length > 0
    ? existingContents.map((row) => {
        // Re-render EN and ZH rows from source; pass through other locales.
        if (row.Language === 'en') return { ...row, ...enRow };
        if (row.Language === 'zh') return { ...row, ...zhRow };
        return row;
      })
    : [enRow, zhRow];

  const enHasCap = /capped at/i.test(enRow.Content);
  console.log(`  T&C  cap-clause present: ${enHasCap}  |  locales: ${rowsToPost.length}`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would POST BulkAddorUpdatePromotionRewardContents (${rowsToPost.length} row(s))`);
  } else {
    try {
      const tncRes = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
        RewardId: rewardId,
        PromotionRewardContents: rowsToPost,
      });
      const ok = tncRes?.success === true ||
        (Array.isArray(tncRes?.message) && tncRes.message.some((m) => /success/i.test(m)));
      if (!ok) throw new Error(`T&C PUT returned: ${JSON.stringify(tncRes).slice(0, 200)}`);
      console.log(`  ✓ T&C restored (${rowsToPost.length} row(s))`);
    } catch (e) {
      console.error(`  ✗ T&C restore failed: ${e.message}`);
    }
  }
}

console.log(DRY_RUN ? '\n[DRY RUN] Re-run with --commit to apply.' : '\nDone.');
