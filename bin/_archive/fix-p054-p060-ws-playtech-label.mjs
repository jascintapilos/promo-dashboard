// Fix [PLAYTECH] → [PRAGMATIC PLAY] in EN + ZH T&C bodies for P054-P060 WS1/WS2.
//
//   node bin/fix-p054-p060-ws-playtech-label.mjs            # dry-run
//   node bin/fix-p054-p060-ws-playtech-label.mjs --commit   # live

import { igmpPost } from '../src/igmp-client.js';

const DRY_RUN = !process.argv.includes('--commit');

const HANDLES = [
  'ACQ_TSM_WELC_168FS_FBGW_8X',
  'ACQ_TSM_WELC_208FS_FBGW_8X',
  'ACQ_TSM_WELC_NODEP_128FS_MHLG_15X',
  'ACQ_TSM_WELC_NODEP_208FS_MHLG_15X',
  'ACQ_TSM_WELC_NODEP_258FS_MHLG_15X',
  'ACQ_TSM_REL_199FS_MHLG_5X',
  'ACQ_TSM_REL_299FS_MHLG_5X',
];

const SITES = ['ws1-v3-my', 'ws1-v3-sg', 'ws2'];
const LABELS = { 'ws1-v3-my': 'WS1_MY', 'ws1-v3-sg': 'WS1_SG', 'ws2': 'WS2' };

function patch(html) {
  return html.replace(/\[PLAYTECH\]/g, '[PRAGMATIC PLAY]');
}

let anyFail = false;

for (const code of HANDLES) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(code);
  console.log('═'.repeat(60));

  for (const siteId of SITES) {
    const label = LABELS[siteId];
    console.log(`\n  ── ${label} ──`);

    const infoRes = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
    const promoId = infoRes?.data?.PromotionId ?? null;
    if (!promoId) { console.log(`  ✗ Not found`); anyFail = true; continue; }

    const fsInfo = await igmpPost(siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: promoId });
    const rewardId = fsInfo?.data?.Promotion?.PromotionRewards?.[0]?.RewardId
                  ?? fsInfo?.data?.PromotionRewards?.[0]?.RewardId ?? null;
    if (!rewardId) { console.log(`  ✗ RewardId not found`); anyFail = true; continue; }

    const getRes = await igmpPost(siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
    const rows = Array.isArray(getRes?.data) ? getRes.data : [];
    if (!rows.length) { console.log(`  ✗ No reward contents`); anyFail = true; continue; }

    const needsFix = rows.some(r => r.Content?.includes('[PLAYTECH]'));
    if (!needsFix) { console.log(`  ✓ Already clean`); continue; }

    const patchedRows = rows.map(r => ({
      ...r,
      Content: r.Content ? patch(r.Content) : r.Content,
    }));

    const affectedLocales = rows.filter(r => r.Content?.includes('[PLAYTECH]')).map(r => r.Locale).join(', ');
    console.log(`  Patching locales: ${affectedLocales}`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would BulkUpdate ${rows.length} locale(s)`);
      continue;
    }

    const putRes = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: patchedRows,
    });
    const ok = putRes?.success === true ||
      (Array.isArray(putRes?.message) && putRes.message.some(m => /success/i.test(m)));
    console.log(ok ? `  ✓ Fixed (${rows.length} locale(s))` : `  ✗ Failed: ${JSON.stringify(putRes).slice(0, 200)}`);
    if (!ok) anyFail = true;
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] Re-run with --commit to apply.');
} else {
  console.log(anyFail ? '\n⚠ Some operations failed.' : '\n✓ All [PLAYTECH] → [PRAGMATIC PLAY] across 21 promos.');
}
