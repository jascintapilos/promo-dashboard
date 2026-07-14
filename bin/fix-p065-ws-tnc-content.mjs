// Fix P065-r66 WS1/WS2 T&C body: the HTML Content has an H4 heading
// with the full multi-brand col X string embedded instead of the WS-specific name.
//
//   node bin/fix-p065-ws-tnc-content.mjs            # dry-run
//   node bin/fix-p065-ws-tnc-content.mjs --commit   # live

import { igmpPost } from '../src/igmp-client.js';

const DRY_RUN = !process.argv.includes('--commit');

// The multi-brand string that was incorrectly embedded as the H4 heading
const WRONG_NAME  = 'QPRO: 50 Free Spins - Gates of Olympus (Pragmatic Play)\nQP2: 50 Free Spins (Gates of Olympus)';
const CORRECT_NAME = '50 Free Spins - Gates of Olympus (MIN6000-2)';

const TARGETS = [
  { siteId: 'ws1-v3-my', promotionId: 3822 },
  { siteId: 'ws1-v3-sg', promotionId: 2966 },
  { siteId: 'ws2',       promotionId: 2652 },
];

for (const { siteId, promotionId } of TARGETS) {
  console.log(`\n=== ${siteId} (PromotionId=${promotionId}) ===`);

  // 1. Get RewardId
  let rewardId;
  try {
    const fsInfo = await igmpPost(siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: promotionId });
    rewardId = fsInfo?.data?.PromotionRewards?.[0]?.RewardId ?? null;
  } catch (e) {
    console.error(`  ✗ GetFreeSpinPromotionInfo: ${e.message.split('\n')[0]}`);
    continue;
  }
  if (!rewardId) { console.error('  ✗ RewardId not found'); continue; }
  console.log(`  RewardId=${rewardId}`);

  // 2. Fetch current PromotionRewardContents
  let currentRows;
  try {
    const tcRes = await igmpPost(siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
    currentRows = Array.isArray(tcRes?.data) ? tcRes.data : [];
  } catch (e) {
    console.error(`  ✗ GetPromotionRewardContents: ${e.message.split('\n')[0]}`);
    continue;
  }
  if (!currentRows.length) { console.error('  ✗ No T&C rows'); continue; }

  // 3. Check for the wrong heading in Content
  for (const r of currentRows) {
    const hasWrong = r.Content?.includes(WRONG_NAME);
    console.log(`  locale=${r.Locale}  heading_wrong=${hasWrong}  PromotionRewardName=${r.PromotionRewardName?.slice(0, 60)}`);
  }

  if (DRY_RUN) continue;

  // 4. Replace the wrong H4 heading string in each row's Content
  const updatedRows = currentRows.map(r => ({
    Locale: r.Locale,
    PromotionRewardName: r.PromotionRewardName,
    Content: (r.Content || '').replace(WRONG_NAME, CORRECT_NAME),
  }));

  try {
    const put = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: updatedRows,
    });
    const ok = put?.success === true || (Array.isArray(put?.message) && put.message.some(m => /success/i.test(m)));
    if (ok) {
      console.log(`  ✓ Content updated (RewardId=${rewardId})`);
    } else {
      console.error(`  ✗ PUT returned: ${JSON.stringify(put).slice(0, 200)}`);
    }
  } catch (e) {
    console.error(`  ✗ BulkAddorUpdatePromotionRewardContents: ${e.message.split('\n')[0]}`);
  }
}

console.log(DRY_RUN ? '\n[DRY RUN] Re-run with --commit to apply.' : '\nDone.');
