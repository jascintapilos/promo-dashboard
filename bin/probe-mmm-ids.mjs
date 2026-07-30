import { igmpPost } from '../src/igmp-client.js';

const TARGETS = [
  { site: 'ws1-v3-my', rewardId: 15374, label: '188FS MY' },
  { site: 'ws1-v3-sg', rewardId: 13156, label: '188FS SG' },
];

for (const { site, rewardId, label } of TARGETS) {
  const r = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
  const rows = r?.data || [];
  console.log(`\n=== ${label} (rewardId=${rewardId}) ===`);
  for (const row of rows) {
    console.log(`--- Locale: ${row.Locale} ---`);
    console.log(row.Content);
    console.log('---END---');
  }
}
