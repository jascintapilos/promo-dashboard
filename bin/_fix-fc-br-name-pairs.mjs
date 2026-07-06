#!/usr/bin/env node
// Dedupe the TLEO FreeCredit BR name pairs on WS1 MY + SG (deep-QC finding
// 2026-07-06): FT_TLEO_FC228/458/888_10X_BR share PromotionName + RewardName
// "Exclusive Offer - N Free Credit" with their non-BR twins — Manual Reward
// picks by name, so a BR-segment player can be granted the non-BR reward.
//
// Fix: BR variant gets " (BR)" suffix on both names; non-BR twin keeps the
// clean name. 3 codes × 2 sites = 6 promos.
//
//   node bin/_fix-fc-br-name-pairs.mjs           # dry-run
//   node bin/_fix-fc-br-name-pairs.mjs --commit
//
// CRITICAL (memory: feedback-igmp-reward-details-put-wipes-tnc):
// UpdatePromotionRewardDetails WIPES PromotionRewardContents. This script
// reads the T&C BEFORE the reward rename and re-posts them immediately
// AFTER, then verifies names + content. Commit is fail-fast: the first
// promo is a canary — any verification failure aborts the rest.

import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');
const SITES = ['ws1-v3-my', 'ws1-v3-sg'];
const CODES = ['FT_TLEO_FC228_10X_BR', 'FT_TLEO_FC458_10X_BR', 'FT_TLEO_FC888_10X_BR'];

async function listAllNames(site) {
  const names = new Map();
  for (let pg = 1; pg <= 60; pg++) {
    const r = await igmpPost(site, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
      PromotionCode: '', PromotionName: '', PromotionType: '', IsActive: '', IsPublished: '',
    });
    const rows = r?.data || [];
    if (!rows.length) break;
    rows.forEach((p) => names.set((p.PromotionName || '').trim(), (p.PromotionCode || '').trim()));
    if (rows.length < 200) break;
  }
  return names;
}

function toDateString(s) {
  const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toDateString();
}

const stripLen = (h) => (h || '').replace(/<[^>]+>/g, '').trim().length;

const plan = [];
let blocked = 0;

for (const site of SITES) {
  const existingNames = await listAllNames(site);
  for (const code of CODES) {
    try {
      const info = await igmpPost(site, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
      const promoId = info?.data?.PromotionId;
      if (!promoId) throw new Error('not found');
      const det = await igmpPost(site, '/PM/GetFreeCreditInfo', { PromotionId: promoId });
      const promo = det?.data?.Promotion || det?.data;
      const rew = promo?.PromotionRewards?.[0];
      if (!rew?.RewardId) throw new Error('no PromotionRewards[0]');

      const base = (promo.PromotionName || '').trim();
      const newName = `${base} (BR)`;

      // T&C snapshot for preservation across the reward-detail PUT
      const ct = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
      const tncRows = (Array.isArray(ct?.data) ? ct.data : [])
        .filter((r) => stripLen(r.Content) > 0)
        .map((r) => ({ Locale: r.Locale, PromotionRewardName: r.PromotionRewardName || '', Content: r.Content }));

      const checks = [];
      if (base.endsWith('(BR)')) { console.log(`= ${site} ${code}: already suffixed — skip`); continue; }
      if (!/Free Credit$/.test(base)) checks.push(`unexpected current name "${base}"`);
      if ((rew.RewardName || '').trim() !== base) checks.push(`RewardName "${rew.RewardName}" ≠ PromotionName "${base}"`);
      if (existingNames.has(newName)) checks.push(`collision: "${newName}" already used by ${existingNames.get(newName)}`);
      if (!tncRows.find((r) => r.Locale === 'en')) checks.push('no EN T&C to preserve');
      const fcTok = Number((code.match(/FC(\d+)/) || [])[1]);
      if (fcTok !== Number(rew.FixedBonusAmount)) checks.push(`code FC${fcTok} ≠ live amount ${rew.FixedBonusAmount}`);

      console.log(`${checks.length ? '✗' : '✓'} ${site}  ${code}  pid=${promoId} rid=${rew.RewardId}  FC=${rew.FixedBonusAmount} TO=${rew.RolloverMultiplier}x`);
      console.log(`    "${base}" → "${newName}"   [T&C preserved: ${tncRows.map((r) => r.Locale).join(',')}]`);
      checks.forEach((c) => console.log(`    ⚠ ${c}`));

      if (checks.length) { blocked++; continue; }
      plan.push({ site, code, promoId, promo, rew, newName, tncRows });
    } catch (e) {
      blocked++;
      console.log(`✗ ${site} ${code}: ${(e.message || e).slice(0, 100)}`);
    }
  }
}

if (!COMMIT) {
  console.log(`\nDRY-RUN — ${plan.length} of 6 would be renamed (${blocked} blocked). Re-run with --commit.`);
  process.exit(blocked ? 1 : 0);
}
if (blocked) { console.error('\nABORT: blocked checks above.'); process.exit(3); }

console.log('\nApplying (fail-fast; first promo is the FC-type canary)…\n');
let done = 0;
for (const r of plan) {
  try {
    // pass 1: PromotionName
    await igmpPost(r.site, '/PM/UpdatePromotionDetails', {
      PromotionId: r.promoId,
      PromotionName: r.newName,
      PromotionDescription: r.promo.PromotionDescription || '',
      PromotionStartDate: toDateString(r.promo.PromotionStartDate),
      PromotionEndDate: toDateString(r.promo.PromotionEndDate),
    });
    // pass 2: RewardName (wipes T&C — restored right after)
    await igmpPost(r.site, '/PM/UpdatePromotionRewardDetails', {
      RewardId: String(r.rew.RewardId),
      RewardName: r.newName,
      RedeemableQuantity: String(r.rew.RedeemableQuantity ?? 0),
      CapBonusAmount: String(r.rew.CapBonusAmount ?? 0),
      RedeemableKYCStatus: Array.isArray(r.rew.RedeemableKYCStatus)
        ? r.rew.RedeemableKYCStatus.join(',')
        : String(r.rew.RedeemableKYCStatus ?? ''),
      WithdrawalCap: String(r.rew.WithdrawalCap ?? 0),
      MaximumBalance: String(r.rew.MaximumBalance ?? 0),
    });
    // pass 3: restore T&C
    await igmpPost(r.site, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: r.rew.RewardId,
      PromotionRewardContents: r.tncRows,
    });

    // verify: names + economics + T&C all live-correct
    const det = await igmpPost(r.site, '/PM/GetFreeCreditInfo', { PromotionId: r.promoId });
    const promo = det?.data?.Promotion || det?.data;
    const rew = promo?.PromotionRewards?.[0];
    const ct = await igmpPost(r.site, '/PM/GetPromotionRewardContents', { RewardId: r.rew.RewardId });
    const rows = Array.isArray(ct?.data) ? ct.data : [];
    const tncOk = r.tncRows.every((t) => rows.some((x) => x.Locale === t.Locale && stripLen(x.Content) > 40));
    const econOk = Number(rew.FixedBonusAmount) === Number(r.rew.FixedBonusAmount)
      && Number(rew.RolloverMultiplier) === Number(r.rew.RolloverMultiplier)
      && Number(rew.WithdrawalCap ?? 0) === Number(r.rew.WithdrawalCap ?? 0);
    const nameOk = promo.PromotionName === r.newName && rew.RewardName === r.newName;
    if (!nameOk || !tncOk || !econOk) {
      console.log(`  ✗ ${r.site} ${r.code}: VERIFY FAILED (name=${nameOk} tnc=${tncOk} econ=${econOk}) — ABORTING remaining renames`);
      process.exit(1);
    }
    done++;
    console.log(`  ✓ ${r.site} ${r.code} → "${r.newName}"  (names ✓, T&C restored ✓, econ ✓)`);
  } catch (e) {
    console.log(`  ✗ ${r.site} ${r.code}: ${(e.message || e).slice(0, 120)} — ABORTING remaining renames`);
    process.exit(1);
  }
}
console.log(`\n${done}/${plan.length} renamed with T&C preserved.`);
