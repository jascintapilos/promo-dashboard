#!/usr/bin/env node
// Fix the 5 WS1 SG TLEO promos whose PromotionName/RewardName say "45%
// Reload Bonus" while live BonusPercentage=20 (deep-QC finding 2026-07-06,
// memory: project-ws1-sg-tleo-name-issues). Wrong-reward risk: Manual
// Reward team picks by name.
//
// New name = the MY twin's name (same code, already rate-correct, unique,
// and convention-matching: "Time Limited Exclusive Offer - 20% Reload
// Bonus (…CAP… / BR)").
//
//   node bin/_fix-sg-tleo-wrong-rate-names.mjs           # dry-run
//   node bin/_fix-sg-tleo-wrong-rate-names.mjs --commit
//
// Two passes per promo (trim-wc26 + reward-rename recipes):
//   1. /PM/UpdatePromotionDetails      — PromotionName (desc+dates passthrough)
//   2. /PM/UpdatePromotionRewardDetails — RewardName (WS1 v3 quirk: numeric
//      values as STRINGS, RedeemableKYCStatus as CSV string)

import { igmpPost } from '../src/igmp-client.js';

const SITE = 'ws1-v3-sg';
const COMMIT = process.argv.includes('--commit');

const TARGETS = [
  { code: 'FT_REL_TLEO_20PCT_300MX_BR',    newName: 'Time Limited Exclusive Offer - 20% Reload Bonus (CAP300 / BR)' },
  { code: 'FT_REL_TLEO_20PCT_400MX_BR',    newName: 'Time Limited Exclusive Offer - 20% Reload Bonus (CAP400 / BR)' },
  { code: 'FT_REL_TLEO_LC_20PCT_20MX_BR',  newName: 'Time Limited Exclusive Offer - 20% Reload Bonus (LC / CAP20 / BR)' },
  { code: 'FT_REL_TLEO_LC_20PCT_300MX_BR', newName: 'Time Limited Exclusive Offer - 20% Reload Bonus (LC / CAP300 / BR)' },
  { code: 'FT_REL_TLEO_LC_20PCT_400MX_BR', newName: 'Time Limited Exclusive Offer - 20% Reload Bonus (LC / CAP400 / BR)' },
];

function toDateString(s) {
  const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toDateString();
}

// Site-wide name collision probe (all types)
async function listAllNames() {
  const names = new Map();
  for (let pg = 1; pg <= 60; pg++) {
    const r = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
      PromotionCode: '', PromotionName: '', PromotionType: '', IsActive: '', IsPublished: '',
    });
    const rows = r?.data || [];
    if (!rows.length) break;
    rows.forEach((p) => names.set((p.PromotionName || '').trim(), (p.PromotionCode || '').trim()));
    if (rows.length < 200) break;
  }
  return names;
}

const existingNames = await listAllNames();
const plan = [];
let blocked = 0;

for (const t of TARGETS) {
  try {
    const info = await igmpPost(SITE, '/PM/GetPromotionInfoByCode', { PromotionCode: t.code });
    const promoId = info?.data?.PromotionId;
    if (!promoId) throw new Error('not found');
    const det = await igmpPost(SITE, '/PM/GetBonusInfo', { PromotionId: promoId });
    const promo = det?.data?.Promotion || det?.data;
    const rew = promo?.PromotionRewards?.[0];
    if (!rew?.RewardId) throw new Error('no PromotionRewards[0]');

    const pct = Number(rew.BonusPercentage);
    const cap = Number(rew.CapBonusAmount);
    const capTok = Number((t.newName.match(/CAP(\d+)/) || [])[1]);

    const checks = [];
    if (pct !== 20) checks.push(`live pct=${pct}, expected 20 — is this still the right promo?`);
    if (capTok !== cap) checks.push(`new name says CAP${capTok} but live cap=${cap}`);
    if (existingNames.has(t.newName)) checks.push(`name collision: "${t.newName}" already used by ${existingNames.get(t.newName)}`);
    if (!/45%/.test(promo.PromotionName || '')) checks.push(`current name no longer says 45% ("${promo.PromotionName}") — already fixed?`);

    console.log(`${checks.length ? '✗' : '✓'} ${t.code}  pid=${promoId} rid=${rew.RewardId}  pct=${pct} cap=${cap}`);
    console.log(`    PromotionName: "${promo.PromotionName}"`);
    console.log(`    RewardName:    "${rew.RewardName}"`);
    console.log(`    → "${t.newName}"`);
    checks.forEach((c) => console.log(`    ⚠ ${c}`));
    console.log();

    if (checks.length) { blocked++; continue; }
    plan.push({ ...t, promoId, promo, rew });
  } catch (e) {
    blocked++;
    console.log(`✗ ${t.code}: ${(e.message || e).slice(0, 100)}\n`);
  }
}

if (!COMMIT) {
  console.log(`DRY-RUN — ${plan.length} of ${TARGETS.length} would be renamed (${blocked} blocked). Re-run with --commit.`);
  process.exit(blocked ? 1 : 0);
}
if (blocked) {
  console.error('ABORT: blocked checks above — resolve before committing.');
  process.exit(3);
}

console.log('Applying…\n');
let fail = 0;
for (const r of plan) {
  try {
    await igmpPost(SITE, '/PM/UpdatePromotionDetails', {
      PromotionId: r.promoId,
      PromotionName: r.newName,
      PromotionDescription: r.promo.PromotionDescription || '',
      PromotionStartDate: toDateString(r.promo.PromotionStartDate),
      PromotionEndDate: toDateString(r.promo.PromotionEndDate),
    });
    await igmpPost(SITE, '/PM/UpdatePromotionRewardDetails', {
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
    console.log(`  ✓ ${r.code}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${r.code}: ${(e.message || e).slice(0, 120)}`);
  }
}

// Post-save verify: re-read both names live
console.log('\nPost-save verification…');
let bad = 0;
for (const r of plan) {
  const det = await igmpPost(SITE, '/PM/GetBonusInfo', { PromotionId: r.promoId });
  const promo = det?.data?.Promotion || det?.data;
  const rew = promo?.PromotionRewards?.[0];
  const ok = promo?.PromotionName === r.newName && rew?.RewardName === r.newName;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${r.code}: PromotionName="${promo?.PromotionName}" RewardName="${rew?.RewardName}"`);
}
console.log(`\n${plan.length - fail}/${plan.length} renamed, ${bad} verification failures.`);
process.exit(fail || bad ? 1 : 0);
