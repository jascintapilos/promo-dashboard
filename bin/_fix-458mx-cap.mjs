#!/usr/bin/env node
// One-off: correct CapBonusAmount 450 → 458 on FT_REL_TLEO_45PCT_458MX
// (WS1 MY, pid=3616). Code + SG twin both say 458; MY was misconfigured at
// 450, which blocked the T&C backfill (fix-ws1-my-tleo-tnc.mjs econ gate).
// Confirmed 458 correct by Wai Yip 2026-07-06.
//
//   node bin/_fix-458mx-cap.mjs           # dry-run (show current values)
//   node bin/_fix-458mx-cap.mjs --commit
//
// UpdatePromotionRewardDetails is full-replace on its field set; WS1 v3
// quirk: numeric values must be STRINGS, RedeemableKYCStatus a CSV string.

import { igmpPost } from '../src/igmp-client.js';

const SITE = 'ws1-v3-my';
const CODE = 'FT_REL_TLEO_45PCT_458MX';
const NEW_CAP = 458;
const COMMIT = process.argv.includes('--commit');

const info = await igmpPost(SITE, '/PM/GetPromotionInfoByCode', { PromotionCode: CODE });
const promoId = info?.data?.PromotionId;
if (!promoId) { console.error(`${CODE}: not found on ${SITE}`); process.exit(2); }

const det = await igmpPost(SITE, '/PM/GetBonusInfo', { PromotionId: promoId });
const promo = det?.data?.Promotion || det?.data;
const rew = promo?.PromotionRewards?.[0];
if (!rew?.RewardId) { console.error(`${CODE}: no PromotionRewards[0]`); process.exit(2); }

// The dedupe suffix was derived from the wrong live cap — correct the names too.
const newRewardName = (rew.RewardName || '').replace('(CAP450)', `(CAP${NEW_CAP})`);
const newPromoName = (promo.PromotionName || '').replace('(CAP450)', `(CAP${NEW_CAP})`);

console.log(`${CODE} pid=${promoId} rid=${rew.RewardId}`);
console.log(`  RewardName:      "${rew.RewardName}" → "${newRewardName}"`);
console.log(`  PromotionName:   "${promo.PromotionName}" → "${newPromoName}"`);
console.log(`  CapBonusAmount:  ${rew.CapBonusAmount} → ${NEW_CAP}`);
console.log(`  MinimumAction:   ${rew.MinimumActionAmount}  BonusPct: ${rew.BonusPercentage}%  TO: ${rew.RolloverMultiplier}x`);

if (Number(rew.CapBonusAmount) === NEW_CAP) {
  console.log('\nAlready 458 — nothing to do.');
  process.exit(0);
}
if (!COMMIT) {
  console.log('\nDRY-RUN — re-run with --commit to apply.');
  process.exit(0);
}

await igmpPost(SITE, '/PM/UpdatePromotionRewardDetails', {
  RewardId: String(rew.RewardId),
  RewardName: newRewardName,
  RedeemableQuantity: String(rew.RedeemableQuantity ?? 0),
  CapBonusAmount: String(NEW_CAP),
  RedeemableKYCStatus: Array.isArray(rew.RedeemableKYCStatus)
    ? rew.RedeemableKYCStatus.join(',')
    : String(rew.RedeemableKYCStatus ?? ''),
  WithdrawalCap: String(rew.WithdrawalCap ?? 0),
  MaximumBalance: String(rew.MaximumBalance ?? 0),
});

// Sync PromotionName (trim-wc26 recipe: passthrough description + dates)
if (newPromoName !== promo.PromotionName) {
  const toDateString = (s) => {
    const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
    const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toDateString();
  };
  await igmpPost(SITE, '/PM/UpdatePromotionDetails', {
    PromotionId: promoId,
    PromotionName: newPromoName,
    PromotionDescription: promo.PromotionDescription || '',
    PromotionStartDate: toDateString(promo.PromotionStartDate),
    PromotionEndDate: toDateString(promo.PromotionEndDate),
  });
}

// Verify
const after = await igmpPost(SITE, '/PM/GetBonusInfo', { PromotionId: promoId });
const promoAfter = after?.data?.Promotion || after?.data;
const rewAfter = promoAfter?.PromotionRewards?.[0];
const ok = Number(rewAfter?.CapBonusAmount) === NEW_CAP
  && rewAfter?.RewardName === newRewardName
  && promoAfter?.PromotionName === newPromoName;
console.log(`\n${ok ? '✓' : '✗'} live: cap=${rewAfter?.CapBonusAmount}  RewardName="${rewAfter?.RewardName}"  PromotionName="${promoAfter?.PromotionName}"`);
process.exit(ok ? 0 : 1);
