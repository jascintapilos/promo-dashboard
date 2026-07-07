#!/usr/bin/env node
// ⚠ OUTCOME 2026-07-07: the min-update path in this script DOES NOT WORK.
// WS1 v3 has NO endpoint that edits a deposit bonus's MinimumActionAmount —
// UpdatePromotionRewardDetails and UpdateBonusDetails both silently ignore
// the field (live-tested; BO edit-page JS confirms neither save call sends
// it), and no other /PM/Update* endpoint exists (probed 8 candidates, all
// 404). The field is CREATE-ONLY (AddBonus). Remediation = deactivate +
// recreate with bumped suffix — precedent: pid 2882 (V-less, wrong MIN50
// config) → deactivated → recreated as _V1 (pid 2898). The rename step DID
// apply: "70% Reload Bonus (MIN100 / CAP888)". T&C verified byte-identical.
//
// One-off: correct MinimumActionAmount 18 → 100 on FT_REL_70PCT_18X_MIN100_V1
// (WS1 SG, pid=2898, rid=13076). The 18 is the 18X turnover multiplier typed
// into the min-deposit field. Evidence: promo code MIN100; reward T&C table
// (EN+ZH) says "Min Deposit SGD 100"; siblings MIN50 (pid 2897) / MIN150
// (pid 2895) hold 50/150; cap ladder 388/888/1888 consistent.
//
//   node bin/_fix-2898-min100.mjs           # dry-run (show current values)
//   node bin/_fix-2898-min100.mjs --commit
//
// UpdatePromotionRewardDetails wipes PromotionRewardContents
// (feedback-igmp-reward-details-put-wipes-tnc): snapshot T&C before,
// re-post via BulkAddorUpdatePromotionRewardContents after, verify.
// WS1 v3 quirk: numeric values as STRINGS, RedeemableKYCStatus a CSV string.
//
// Also completes the 2026-07-07 dedupe rename: _rename-ws1-sg-legacy-unique
// suppressed the MIN token for 2898 ("(CAP888)") while the config was under
// investigation; siblings got "(MIN50 / CAP388)" / "(MIN150 / CAP1888)".
// With min corrected, the name becomes "70% Reload Bonus (MIN100 / CAP888)".

import { writeFileSync } from 'node:fs';
import { igmpPost } from '../src/igmp-client.js';

const SITE = 'ws1-v3-sg';
const PID = 2898;
const CODE = 'FT_REL_70PCT_18X_MIN100_V1';
const NEW_MIN = 100;
const COMMIT = process.argv.includes('--commit');
const stripLen = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;

const det = await igmpPost(SITE, '/PM/GetBonusInfo', { PromotionId: PID });
const promo = det?.data?.Promotion || det?.data;
const rew = promo?.PromotionRewards?.[0];
if (promo?.PromotionCode !== CODE) { console.error(`pid=${PID} is "${promo?.PromotionCode}", expected ${CODE} — aborting`); process.exit(2); }
if (!rew?.RewardId) { console.error(`${CODE}: no PromotionRewards[0]`); process.exit(2); }

// Dedupe-suffix repair: (CAP888) → (MIN100 / CAP888), sibling style
const newPromoName = (promo.PromotionName || '').trim() === '70% Reload Bonus (CAP888)'
  ? '70% Reload Bonus (MIN100 / CAP888)'
  : promo.PromotionName;

// T&C snapshot for preservation
const ct = await igmpPost(SITE, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
const tncRows = (Array.isArray(ct?.data) ? ct.data : [])
  .filter((r) => stripLen(r.Content) > 0)
  .map((r) => ({ Locale: r.Locale, PromotionRewardName: r.PromotionRewardName || '', Content: r.Content }));

console.log(`${CODE} pid=${PID} rid=${rew.RewardId}`);
console.log(`  PromotionName:       "${promo.PromotionName}" → "${newPromoName}"`);
console.log(`  MinimumActionAmount: ${rew.MinimumActionAmount} → ${NEW_MIN}`);
console.log(`  BonusPct: ${rew.BonusPercentage}%  TO: ${rew.RolloverMultiplier}x  Cap: ${rew.CapBonusAmount}`);
console.log(`  T&C locales: [${tncRows.map((r) => r.Locale).join(',')}]`);

if (Number(rew.MinimumActionAmount) === NEW_MIN) { console.log('\nAlready 100 — nothing to do.'); process.exit(0); }
if (!tncRows.find((r) => r.Locale === 'en')) { console.error('No EN T&C to preserve — aborting.'); process.exit(2); }

// Full pre-change snapshot to disk (restore safety)
const snapPath = `tmp/snapshot-2898-min100-${COMMIT ? 'commit' : 'dry'}.json`;
writeFileSync(snapPath, JSON.stringify({ bonusInfo: det.data, rewardContents: ct.data }, null, 2));
console.log(`  snapshot → ${snapPath}`);

if (!COMMIT) { console.log('\nDRY-RUN — re-run with --commit to apply.'); process.exit(0); }

await igmpPost(SITE, '/PM/UpdatePromotionRewardDetails', {
  RewardId: String(rew.RewardId),
  RewardName: rew.RewardName || '',
  RedeemableQuantity: String(rew.RedeemableQuantity ?? 0),
  MinimumActionAmount: String(NEW_MIN),
  CapBonusAmount: String(rew.CapBonusAmount ?? 0),
  RedeemableKYCStatus: Array.isArray(rew.RedeemableKYCStatus)
    ? rew.RedeemableKYCStatus.join(',')
    : String(rew.RedeemableKYCStatus ?? ''),
  WithdrawalCap: String(rew.WithdrawalCap ?? 0),
  MaximumBalance: String(rew.MaximumBalance ?? 0),
});

await igmpPost(SITE, '/PM/BulkAddorUpdatePromotionRewardContents', {
  RewardId: rew.RewardId,
  PromotionRewardContents: tncRows,
});

// Rename to sibling-style suffix (UpdatePromotionDetails does not touch contents)
if (newPromoName !== promo.PromotionName) {
  const toDateString = (s) => {
    const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
    const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toDateString();
  };
  await igmpPost(SITE, '/PM/UpdatePromotionDetails', {
    PromotionId: PID,
    PromotionName: newPromoName,
    PromotionDescription: promo.PromotionDescription || '',
    PromotionStartDate: toDateString(promo.PromotionStartDate),
    PromotionEndDate: toDateString(promo.PromotionEndDate),
  });
}

// Verify
const after = await igmpPost(SITE, '/PM/GetBonusInfo', { PromotionId: PID });
const promoAfter = after?.data?.Promotion || after?.data;
const rewAfter = promoAfter?.PromotionRewards?.[0];
const ctAfter = await igmpPost(SITE, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
const rowsAfter = Array.isArray(ctAfter?.data) ? ctAfter.data : [];
const minOk = Number(rewAfter?.MinimumActionAmount) === NEW_MIN;
const econOk = Number(rewAfter?.BonusPercentage) === Number(rew.BonusPercentage)
  && Number(rewAfter?.RolloverMultiplier) === Number(rew.RolloverMultiplier)
  && Number(rewAfter?.CapBonusAmount) === Number(rew.CapBonusAmount);
const tncOk = tncRows.every((t) => rowsAfter.some((x) => x.Locale === t.Locale && stripLen(x.Content) > 40));
const nameOk = rewAfter?.RewardName === (rew.RewardName || '') && promoAfter?.PromotionName === newPromoName;
console.log(`\n${minOk && econOk && tncOk && nameOk ? '✓' : '✗'} live: min=${rewAfter?.MinimumActionAmount} econ=${econOk} tnc=${tncOk}[${rowsAfter.map((r) => r.Locale).join(',')}] name=${nameOk}`);
process.exit(minOk && econOk && tncOk && nameOk ? 0 : 1);
