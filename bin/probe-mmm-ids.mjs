import { igmpPost } from '../src/igmp-client.js';
for (const [label, site, id] of [
  ['188FS SG', 'ws1-v3-sg', 13156],
  ['288FS SG', 'ws1-v3-sg', 13157],
]) {
  const r = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: id });
  for (const row of (r?.data || [])) {
    if (row.Locale !== 'en') continue;
    console.log(`\n${label} [en] full content:\n${row.Content}`);
  }
}
