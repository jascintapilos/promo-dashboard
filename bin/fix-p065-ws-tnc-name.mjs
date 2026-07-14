// Fix P065-r66 WS1_MY / WS1_SG / WS2: PromotionRewardName shows the full
// multi-brand col X string instead of the WS-specific name.
// Correct value: "50 Free Spins - Gates of Olympus (MIN6000-2)"
//
//   node bin/fix-p065-ws-tnc-name.mjs            # dry-run
//   node bin/fix-p065-ws-tnc-name.mjs --commit   # live

import { igmpPost } from '../src/igmp-client.js';

const DRY_RUN = !process.argv.includes('--commit');
const CORRECT_NAME = '50 Free Spins - Gates of Olympus (MIN6000-2)';

const TARGETS = [
  { siteId: 'ws1-v3-my', promotionId: 3822 },
  { siteId: 'ws1-v3-sg', promotionId: 2966 },
  { siteId: 'ws2',       promotionId: 2652 },
];

for (const { siteId, promotionId } of TARGETS) {
  console.log(`\n=== ${siteId} (PromotionId=${promotionId}) ===`);

  // 1. Get RewardId via GetFreeSpinPromotionInfo
  let rewardId;
  try {
    const fsInfo = await igmpPost(siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: promotionId });
    rewardId = fsInfo?.data?.PromotionRewards?.[0]?.RewardId ?? null;
  } catch (e) {
    console.error(`  ✗ GetFreeSpinPromotionInfo failed: ${e.message.split('\n')[0]}`);
    continue;
  }
  if (!rewardId) { console.error('  ✗ RewardId not found'); continue; }
  console.log(`  RewardId=${rewardId}`);

  // 2. Fetch current PromotionRewardContents (preserve HTML bodies)
  let currentRows;
  try {
    const tcRes = await igmpPost(siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
    currentRows = Array.isArray(tcRes?.data) ? tcRes.data : [];
  } catch (e) {
    console.error(`  ✗ GetPromotionRewardContents failed: ${e.message.split('\n')[0]}`);
    continue;
  }
  if (!currentRows.length) { console.error('  ✗ No T&C rows returned'); continue; }

  // 3. Show current vs correct
  currentRows.forEach(r => {
    console.log(`  locale=${r.Locale}  current="${r.PromotionRewardName}"  → "${CORRECT_NAME}"`);
  });

  if (DRY_RUN) continue;

  // 4. Update PromotionRewardName on all rows, keep Content intact
  const updatedRows = currentRows.map(r => ({
    Locale: r.Locale,
    PromotionRewardName: CORRECT_NAME,
    Content: r.Content,
  }));

  try {
    const put = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: updatedRows,
    });
    const ok = put?.success === true || (Array.isArray(put?.message) && put.message.some(m => /success/i.test(m)));
    if (ok) {
      console.log(`  ✓ Updated (RewardId=${rewardId})`);
    } else {
      console.error(`  ✗ PUT returned: ${JSON.stringify(put).slice(0, 200)}`);
    }
  } catch (e) {
    console.error(`  ✗ BulkAddorUpdatePromotionRewardContents failed: ${e.message.split('\n')[0]}`);
  }
}

console.log(DRY_RUN ? '\n[DRY RUN] Re-run with --commit to apply.' : '\nDone.');
