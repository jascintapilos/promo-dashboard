// Fix ZH T&C dual-name in WS1 MY, WS1 SG, WS2 for P053 (ACQ_TSM_WELC_108FS_FBGW_8X_V2).
// The renderer embedded the full dual-promo-name column X value verbatim into
// PromotionRewardName (subject) and the body title span.  ZH should show only
// the WS1/WS2-unique name: "MB8 Sugar Rush - 108FS".
//
//   node bin/fix-p053-ws-zh-dual-name.mjs            # dry-run
//   node bin/fix-p053-ws-zh-dual-name.mjs --commit   # live
import { igmpPost } from '../src/igmp-client.js';

const DRY_RUN = !process.argv.includes('--commit');

const TARGETS = [
  { label: 'WS1_MY', siteId: 'ws1-v3-my', rewardId: 15331 },
  { label: 'WS1_SG', siteId: 'ws1-v3-sg', rewardId: 13099 },
  { label: 'WS2',    siteId: 'ws2',        rewardId: 10599 },
];

const WS_UNIQUE_NAME = 'MB8 Sugar Rush - 108FS';
// Match the dual-name in both PromotionRewardName and Content HTML.
// Use a fresh inline regex each call (avoid /g lastIndex state across calls).
const DUAL_NAME_PATTERN = 'Sugar Rush - 108FS[\\n\\r]*WS1\\/WS2: MB8 Sugar Rush - 108FS';

function hasDualName(str) {
  return typeof str === 'string' && str.includes('WS1/WS2:') && str.includes('Sugar Rush');
}

function patchZhRow(row) {
  const patched = { ...row };
  // Fix PromotionRewardName (subject / T&C heading).
  if (hasDualName(patched.PromotionRewardName)) {
    patched.PromotionRewardName = patched.PromotionRewardName.replace(
      new RegExp(DUAL_NAME_PATTERN, 'g'),
      WS_UNIQUE_NAME,
    );
  }
  // Fix the title span inside Content HTML.
  if (patched.Content && hasDualName(patched.Content)) {
    patched.Content = patched.Content.replace(
      new RegExp(`(<span[^>]*>)${DUAL_NAME_PATTERN}(<\\/span>)`, 'g'),
      `$1${WS_UNIQUE_NAME}$2`,
    );
  }
  return patched;
}

let anyFail = false;

for (const { label, siteId, rewardId } of TARGETS) {
  console.log(`\n── ${label} (site=${siteId}, rewardId=${rewardId}) ──`);

  // 1. GET current reward contents (all locales).
  const getRes = await igmpPost(siteId, '/PM/GetPromotionRewardContents', { RewardId: rewardId });
  const rows = Array.isArray(getRes?.data) ? getRes.data : [];
  if (!rows.length) {
    console.log(`  ✗ GetPromotionRewardContents returned empty — skipping`);
    anyFail = true;
    continue;
  }

  console.log(`  Locales found: ${rows.map((r) => r.Locale).join(', ')}`);

  const zhRow = rows.find((r) => r.Locale === 'zh');
  if (!zhRow) {
    console.log(`  ✗ No ZH locale found — skipping`);
    anyFail = true;
    continue;
  }

  // Show before state.
  console.log(`  ZH name (before): ${JSON.stringify(zhRow.PromotionRewardName)}`);
  const hasNameLeak = hasDualName(zhRow.PromotionRewardName);
  const hasBodyLeak = hasDualName(zhRow.Content);

  if (!hasNameLeak && !hasBodyLeak) {
    console.log(`  ✓ Already clean — nothing to patch`);
    continue;
  }

  const patchedZh = patchZhRow(zhRow);
  console.log(`  ZH name (after):  ${JSON.stringify(patchedZh.PromotionRewardName)}`);

  // 2. Build patched rows: keep EN + any other locales unchanged, swap ZH.
  const patchedRows = rows.map((r) => r.Locale === 'zh' ? patchedZh : r);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would POST BulkAddorUpdatePromotionRewardContents with ${patchedRows.length} locale(s)`);
    continue;
  }

  // 3. POST all locales back.
  const putRes = await igmpPost(siteId, '/PM/BulkAddorUpdatePromotionRewardContents', {
    RewardId: rewardId,
    PromotionRewardContents: patchedRows,
  });
  const ok = putRes?.success === true ||
             (Array.isArray(putRes?.message) && putRes.message.some((m) => /success/i.test(m)));

  if (ok) {
    console.log(`  ✓ T&C updated`);
  } else {
    console.log(`  ✗ PUT failed: ${JSON.stringify(putRes).slice(0, 400)}`);
    anyFail = true;
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN complete] Re-run with --commit to apply fixes.');
} else {
  console.log(anyFail ? '\n⚠ Some sites failed — review output above.' : '\n✓ All ZH T&C names patched.');
}
