// Fix ZH dual-name + EN generic reward name in WS1 MY, WS1 SG, WS2
// for P054-P060 (Sugar Rush FS promos).
//
// Two renderer bugs patched per locale:
//   ZH PromotionRewardName  → strip "Sugar Rush - Xfs\nWS1/WS2: " prefix
//   ZH Content title span   → same
//   EN PromotionRewardName  → replace generic "Sugar Rush - Xfs" with WS-specific name
//   EN Content title span   → same
//
//   node bin/fix-p054-p060-ws-zh-dual-name.mjs            # dry-run
//   node bin/fix-p054-p060-ws-zh-dual-name.mjs --commit   # live

import { igmpPost } from '../src/igmp-client.js';

const DRY_RUN = !process.argv.includes('--commit');

// (promoCode, wsUniqueName) per handle
const HANDLES = [
  { code: 'ACQ_TSM_WELC_168FS_FBGW_8X',       wsName: 'MB8 Sugar Rush - 168FS' },
  { code: 'ACQ_TSM_WELC_208FS_FBGW_8X',        wsName: 'MB8 Sugar Rush - 208FS' },
  { code: 'ACQ_TSM_WELC_NODEP_128FS_MHLG_15X', wsName: 'MB8 Sugar Rush - 128FS' },
  { code: 'ACQ_TSM_WELC_NODEP_208FS_MHLG_15X', wsName: 'Sugar Rush 1000 - 208FS 15X' },
  { code: 'ACQ_TSM_WELC_NODEP_258FS_MHLG_15X', wsName: 'MB8 Sugar Rush - 258FS' },
  { code: 'ACQ_TSM_REL_199FS_MHLG_5X',         wsName: 'MB8 Sugar Rush - 199FS' },
  { code: 'ACQ_TSM_REL_299FS_MHLG_5X',         wsName: 'MB8 Sugar Rush - 299FS' },
];

const SITES = [
  { label: 'WS1_MY', siteId: 'ws1-v3-my' },
  { label: 'WS1_SG', siteId: 'ws1-v3-sg' },
  { label: 'WS2',    siteId: 'ws2' },
];

// Resolve RewardId from promo code.
async function resolveRewardId(siteId, promoCode) {
  const info = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: promoCode });
  const promoId = info?.data?.PromotionId ?? null;
  if (!promoId) throw new Error(`Promo ${promoCode} not found on ${siteId}`);
  const fsInfo = await igmpPost(siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: promoId });
  const rewardId =
    fsInfo?.data?.Promotion?.PromotionRewards?.[0]?.RewardId ??
    fsInfo?.data?.PromotionRewards?.[0]?.RewardId ?? null;
  if (!rewardId) throw new Error(`RewardId not found for ${promoCode} on ${siteId} (PromotionId=${promoId})`);
  return rewardId;
}

function hasDualName(str) {
  return typeof str === 'string' && str.includes('WS1/WS2:');
}

function hasGenericName(str, wsName) {
  // Generic = lacks "MB8" prefix but matches the base part (e.g. "Sugar Rush - 168FS")
  return typeof str === 'string' && !str.includes('MB8') && str.includes('Sugar Rush');
}

function patchRow(row, wsName, locale) {
  const patched = { ...row };

  if (locale === 'zh') {
    // Fix ZH PromotionRewardName: strip dual-name → wsName
    if (hasDualName(patched.PromotionRewardName)) {
      patched.PromotionRewardName = wsName;
    }
    // Fix ZH Content title span
    if (patched.Content && hasDualName(patched.Content)) {
      patched.Content = patched.Content.replace(
        new RegExp(`(<span[^>]*>)[^<]*WS1\\/WS2:[^<]*(<\\/span>)`, 'g'),
        `$1${wsName}$2`,
      );
    }
  }

  if (locale === 'en') {
    // Fix EN PromotionRewardName: generic → wsName
    if (hasGenericName(patched.PromotionRewardName, wsName)) {
      patched.PromotionRewardName = wsName;
    }
    // Fix EN Content title span: generic → wsName
    if (patched.Content && hasGenericName(patched.Content.match(/<span[^>]*>([^<]*Sugar Rush[^<]*)<\/span>/)?.[1] ?? '', wsName)) {
      patched.Content = patched.Content.replace(
        new RegExp(`(<span[^>]*>)(Sugar Rush[^<]*?)(<\\/span>)`, 'g'),
        `$1${wsName}$3`,
      );
    }
  }

  return patched;
}

let anyFail = false;

for (const { code, wsName } of HANDLES) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${code}  →  ${wsName}`);
  console.log('═'.repeat(60));

  for (const { label, siteId } of SITES) {
    console.log(`\n  ── ${label} (${siteId}) ──`);

    let rewardId;
    try {
      rewardId = await resolveRewardId(siteId, code);
      console.log(`  RewardId=${rewardId}`);
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      anyFail = true;
      continue;
    }

    const getRes = await igmpPost(siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
    const rows = Array.isArray(getRes?.data) ? getRes.data : [];
    if (!rows.length) {
      console.log(`  ✗ No reward contents returned`);
      anyFail = true;
      continue;
    }

    const locales = rows.map((r) => r.Locale).join(', ');
    console.log(`  Locales: ${locales}`);

    // Determine what needs patching
    const patches = [];
    for (const row of rows) {
      const loc = row.Locale;
      if (loc !== 'en' && loc !== 'zh') continue;
      const needsZhFix = loc === 'zh' && (hasDualName(row.PromotionRewardName) || hasDualName(row.Content));
      const needsEnFix = loc === 'en' && (hasGenericName(row.PromotionRewardName, wsName) || hasGenericName(row.Content?.match(/<span[^>]*>([^<]*Sugar Rush[^<]*)<\/span>/)?.[1] ?? '', wsName));
      if (needsZhFix || needsEnFix) patches.push(loc);
    }

    if (!patches.length) {
      console.log(`  ✓ Already clean`);
      continue;
    }

    console.log(`  Patching: ${patches.join(', ')}`);

    const patchedRows = rows.map((r) => {
      const loc = r.Locale;
      if (loc === 'en' || loc === 'zh') return patchRow(r, wsName, loc);
      return r;
    });

    // Show before/after for changed locales
    for (const loc of patches) {
      const before = rows.find((r) => r.Locale === loc);
      const after = patchedRows.find((r) => r.Locale === loc);
      console.log(`  ${loc.toUpperCase()} name before: ${JSON.stringify(before?.PromotionRewardName)}`);
      console.log(`  ${loc.toUpperCase()} name after:  ${JSON.stringify(after?.PromotionRewardName)}`);
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would POST ${patchedRows.length} locale(s)`);
      continue;
    }

    const putRes = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: rewardId,
      PromotionRewardContents: patchedRows,
    });
    const ok =
      putRes?.success === true ||
      (Array.isArray(putRes?.message) && putRes.message.some((m) => /success/i.test(m)));

    if (ok) {
      console.log(`  ✓ T&C updated`);
    } else {
      console.log(`  ✗ PUT failed: ${JSON.stringify(putRes).slice(0, 400)}`);
      anyFail = true;
    }
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN complete] Re-run with --commit to apply.');
} else {
  console.log(anyFail ? '\n⚠ Some sites failed.' : '\n✓ All ZH/EN names patched across all handles.');
}
