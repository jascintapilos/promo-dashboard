#!/usr/bin/env node
// One-off: clean P026's WS1 names on both sites (2026-07-09).
//
// Saved state (double mechanics suffix from the mapper bug, fixed same day in
// src/api-mapper-igmp.js + src/igmp-tnc.js):
//   PromotionName: "88% Slots Reload Bonus (MIN100) (MIN100 / CAP88 / TO10x)"
//   RewardName / EN T&C title: "88% Slots Reload Bonus (MIN100)"
// Target state (operator's column-X design):
//   PromotionName: "88% Slots Reload Bonus (MIN100)"   (explicit WS1-unique name)
//   RewardName / EN T&C title: "88% Slots Reload Bonus" (player-facing, clean)
//   ZH rows keep the per-locale ZH name.
//
//   node bin/_fix-p026-ws1-names.mjs            # dry-run
//   node bin/_fix-p026-ws1-names.mjs --commit
//
// UpdatePromotionRewardDetails wipes PromotionRewardContents
// (feedback-igmp-reward-details-put-wipes-tnc): snapshot T&C before,
// re-post via BulkAddorUpdatePromotionRewardContents after, verify.
// WS1 v3 quirk: numeric values as STRINGS, RedeemableKYCStatus a CSV string.

import { writeFileSync } from 'node:fs';
import { igmpPost } from '../src/igmp-client.js';

const CODE = 'WHALE_CRM_PROBE_88PCT_100_FTD_LOSE_2';
const BAD_NAME = '88% Slots Reload Bonus (MIN100) (MIN100 / CAP88 / TO10x)';
const UNIQUE_NAME = '88% Slots Reload Bonus (MIN100)';
const CLEAN_NAME = '88% Slots Reload Bonus';
const TARGETS = [
  { site: 'ws1-v3-my', pid: 3773 },
  { site: 'ws1-v3-sg', pid: 2916 },
];
const COMMIT = process.argv.includes('--commit');
const stripLen = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
const toDateString = (s) => {
  const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toDateString();
};

let failures = 0;
for (const { site, pid } of TARGETS) {
  console.log(`\n━━ ${site} pid=${pid} ━━`);
  const det = await igmpPost(site, '/PM/GetBonusInfo', { PromotionId: pid });
  const promo = det?.data?.Promotion || det?.data;
  const rew = promo?.PromotionRewards?.[0];
  if (promo?.PromotionCode !== CODE) { console.error(`  pid=${pid} is "${promo?.PromotionCode}", expected ${CODE} — skipping`); failures++; continue; }
  if (!rew?.RewardId) { console.error('  no PromotionRewards[0] — skipping'); failures++; continue; }

  const ct = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
  const tncRows = (Array.isArray(ct?.data) ? ct.data : [])
    .filter((r) => stripLen(r.Content) > 0)
    .map((r) => ({
      Locale: r.Locale,
      // EN title/name → clean generic; ZH keeps its per-locale name.
      PromotionRewardName: r.Locale === 'en' ? CLEAN_NAME : (r.PromotionRewardName || ''),
      Content: r.Locale === 'en'
        ? String(r.Content).split(UNIQUE_NAME).join(CLEAN_NAME)
        : r.Content,
    }));

  console.log(`  PromotionName: "${promo.PromotionName}"`);
  console.log(`               → "${UNIQUE_NAME}"`);
  console.log(`  RewardName:    "${rew.RewardName}" → "${CLEAN_NAME}"`);
  console.log(`  T&C locales:   [${tncRows.map((r) => r.Locale).join(',')}]`);
  const enRow = tncRows.find((r) => r.Locale === 'en');
  console.log(`  EN title contains "(MIN100)": ${enRow ? String(enRow.Content).includes(UNIQUE_NAME) : 'n/a'} (after replace — expect false)`);

  if (promo.PromotionName !== BAD_NAME) console.log(`  ⚠ live name differs from expected bad value — will still set target name`);
  if (!enRow) { console.error('  No EN T&C to preserve — skipping site.'); failures++; continue; }

  const snapPath = `tmp/snapshot-p026-ws1-names-${site}-${COMMIT ? 'commit' : 'dry'}.json`;
  writeFileSync(snapPath, JSON.stringify({ bonusInfo: det.data, rewardContents: ct.data }, null, 2));
  console.log(`  snapshot → ${snapPath}`);

  if (!COMMIT) { console.log('  DRY-RUN — no writes.'); continue; }

  // 1. Reward name (wipes contents — re-posted right after)
  await igmpPost(site, '/PM/UpdatePromotionRewardDetails', {
    RewardId: String(rew.RewardId),
    RewardName: CLEAN_NAME,
    RedeemableQuantity: String(rew.RedeemableQuantity ?? 0),
    MinimumActionAmount: String(rew.MinimumActionAmount ?? 0),
    CapBonusAmount: String(rew.CapBonusAmount ?? 0),
    RedeemableKYCStatus: Array.isArray(rew.RedeemableKYCStatus)
      ? rew.RedeemableKYCStatus.join(',')
      : String(rew.RedeemableKYCStatus ?? ''),
    WithdrawalCap: String(rew.WithdrawalCap ?? 0),
    MaximumBalance: String(rew.MaximumBalance ?? 0),
  });

  // 2. Re-post T&C with corrected EN title
  await igmpPost(site, '/PM/BulkAddorUpdatePromotionRewardContents', {
    RewardId: rew.RewardId,
    PromotionRewardContents: tncRows,
  });

  // 3. PromotionName (safe endpoint, does not touch contents)
  await igmpPost(site, '/PM/UpdatePromotionDetails', {
    PromotionId: pid,
    PromotionName: UNIQUE_NAME,
    PromotionDescription: promo.PromotionDescription || '',
    PromotionStartDate: toDateString(promo.PromotionStartDate),
    PromotionEndDate: toDateString(promo.PromotionEndDate),
  });

  // 4. Verify
  const after = await igmpPost(site, '/PM/GetBonusInfo', { PromotionId: pid });
  const promoAfter = after?.data?.Promotion || after?.data;
  const rewAfter = promoAfter?.PromotionRewards?.[0];
  const ctAfter = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
  const rowsAfter = Array.isArray(ctAfter?.data) ? ctAfter.data : [];
  const enAfter = rowsAfter.find((r) => r.Locale === 'en');
  const nameOk = promoAfter?.PromotionName === UNIQUE_NAME;
  const rewNameOk = rewAfter?.RewardName === CLEAN_NAME;
  const titleOk = enAfter && !String(enAfter.Content).includes(UNIQUE_NAME) && String(enAfter.Content).includes(CLEAN_NAME);
  const tncOk = tncRows.every((t) => rowsAfter.some((x) => x.Locale === t.Locale && stripLen(x.Content) > 40));
  const econOk = Number(rewAfter?.BonusPercentage) === Number(rew.BonusPercentage)
    && Number(rewAfter?.RolloverMultiplier) === Number(rew.RolloverMultiplier)
    && Number(rewAfter?.CapBonusAmount) === Number(rew.CapBonusAmount)
    && Number(rewAfter?.MinimumActionAmount) === Number(rew.MinimumActionAmount);
  const ok = nameOk && rewNameOk && titleOk && tncOk && econOk;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} live: name=${nameOk} rewardName=${rewNameOk} enTitle=${titleOk} tnc=${tncOk}[${rowsAfter.map((r) => r.Locale).join(',')}] econ=${econOk}`);
}
process.exit(failures ? 1 : 0);
