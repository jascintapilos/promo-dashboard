// Rename P054-P060 WS1/WS2 promos from "MB8 Sugar Rush" → "Sugar Rush 1000".
//
// Updates per handle × site:
//   1. UpdatePromotionDetails  — top-level PromotionName
//   2. BulkAddorUpdate...      — EN + ZH PromotionRewardName + all Content body refs
//
//   node bin/fix-p054-p060-ws-sg1000-rename.mjs            # dry-run
//   node bin/fix-p054-p060-ws-sg1000-rename.mjs --commit   # live

import { igmpPost } from '../src/igmp-client.js';

const DRY_RUN = !process.argv.includes('--commit');

const HANDLES = [
  { code: 'ACQ_TSM_WELC_168FS_FBGW_8X',       oldName: 'MB8 Sugar Rush - 168FS', newName: 'Sugar Rush 1000 - 168FS' },
  { code: 'ACQ_TSM_WELC_208FS_FBGW_8X',        oldName: 'MB8 Sugar Rush - 208FS', newName: 'Sugar Rush 1000 - 208FS' },
  { code: 'ACQ_TSM_WELC_NODEP_128FS_MHLG_15X', oldName: 'MB8 Sugar Rush - 128FS', newName: 'Sugar Rush 1000 - 128FS' },
  // P057 already correct — skip
  { code: 'ACQ_TSM_WELC_NODEP_258FS_MHLG_15X', oldName: 'MB8 Sugar Rush - 258FS', newName: 'Sugar Rush 1000 - 258FS' },
  { code: 'ACQ_TSM_REL_199FS_MHLG_5X',         oldName: 'MB8 Sugar Rush - 199FS', newName: 'Sugar Rush 1000 - 199FS' },
  { code: 'ACQ_TSM_REL_299FS_MHLG_5X',         oldName: 'MB8 Sugar Rush - 299FS', newName: 'Sugar Rush 1000 - 299FS' },
];

const SITES = ['ws1-v3-my', 'ws1-v3-sg', 'ws2'];
const LABELS = { 'ws1-v3-my': 'WS1_MY', 'ws1-v3-sg': 'WS1_SG', 'ws2': 'WS2' };

function patchContent(html, newName) {
  // Replace "MB8 Sugar Rush" everywhere (covers title spans + intro + How-to-Apply)
  return html.replace(/MB8 Sugar Rush/g, 'Sugar Rush 1000');
}

function patchRewardName(name, newName) {
  // Strip dual-name artifact or replace old name
  if (typeof name !== 'string') return newName;
  if (name.includes('WS1/WS2:')) return newName;  // dual-name artifact
  if (name.includes('MB8 Sugar Rush')) return newName;
  if (name.includes('Sugar Rush 1000')) return newName; // already correct
  return newName; // fallback
}

let anyFail = false;

for (const { code, oldName, newName } of HANDLES) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${code}`);
  console.log(`  ${oldName}  →  ${newName}`);
  console.log('═'.repeat(60));

  for (const siteId of SITES) {
    const label = LABELS[siteId];
    console.log(`\n  ── ${label} ──`);

    // Resolve PromotionId
    const infoRes = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
    const promoId = infoRes?.data?.PromotionId ?? null;
    if (!promoId) {
      console.log(`  ✗ Not found on ${siteId}`);
      anyFail = true;
      continue;
    }
    console.log(`  PromotionId=${promoId}`);

    // Resolve RewardId
    const fsInfo = await igmpPost(siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: promoId });
    const rewardId = fsInfo?.data?.Promotion?.PromotionRewards?.[0]?.RewardId
                  ?? fsInfo?.data?.PromotionRewards?.[0]?.RewardId ?? null;
    if (!rewardId) {
      console.log(`  ✗ RewardId not found`);
      anyFail = true;
      continue;
    }
    console.log(`  RewardId=${rewardId}`);

    // Get current reward contents
    const getRes = await igmpPost(siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
    const rows = Array.isArray(getRes?.data) ? getRes.data : [];
    if (!rows.length) {
      console.log(`  ✗ No reward contents`);
      anyFail = true;
      continue;
    }

    // Get current promo name for display
    const currentPromoName = infoRes?.data?.PromotionName ?? '?';
    console.log(`  Current PromotionName: "${currentPromoName}"`);
    console.log(`  → New PromotionName:   "${newName}"`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would UpdatePromotionDetails + BulkUpdate ${rows.length} locale(s)`);
      continue;
    }

    // 1. Update top-level PromotionName
    // Dates must be in "Fri Jul 10 2026" format — API returns DD/MM/YYYY which causes 500.
    const renameRes = await igmpPost(siteId, '/PM/UpdatePromotionDetails', {
      PromotionId:          promoId,
      PromotionCode:        code,
      PromotionName:        newName,
      PromotionDescription: '',
      Settings:             [],
      PromotionStartDate:   'Fri Jul 10 2026',
      PromotionEndDate:     'Thu Dec 31 2026',
    });
    const renameOk = renameRes?.success === true ||
      (typeof renameRes?.message === 'string' && /success/i.test(renameRes.message));
    console.log(renameOk ? '  ✓ PromotionName updated' : `  ✗ Rename failed: ${JSON.stringify(renameRes).slice(0, 300)}`);
    if (!renameOk) anyFail = true;

    // 2. Patch reward contents
    const patchedRows = rows.map((row) => {
      const patched = { ...row };
      patched.PromotionRewardName = patchRewardName(patched.PromotionRewardName, newName);
      if (patched.Content) patched.Content = patchContent(patched.Content, newName);
      return patched;
    });

    const putRes = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: patchedRows,
    });
    const putOk = putRes?.success === true ||
      (Array.isArray(putRes?.message) && putRes.message.some((m) => /success/i.test(m)));
    console.log(putOk ? `  ✓ Reward contents updated (${rows.length} locale(s))` : `  ✗ Reward update failed: ${JSON.stringify(putRes).slice(0, 300)}`);
    if (!putOk) anyFail = true;
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] Re-run with --commit to apply.');
} else {
  console.log(anyFail ? '\n⚠ Some operations failed.' : '\n✓ All promos renamed to Sugar Rush 1000.');
}
