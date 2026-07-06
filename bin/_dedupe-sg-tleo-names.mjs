#!/usr/bin/env node
// Dedupe ALL WS1 SG TLEO reload names (deep-QC finding 2026-07-06): SG never
// got the MY uniqueness pass — "20% Reload Bonus" ×17, "45% Reload Bonus" ×9,
// "Time Limited Exclusive Offer - 45% Reload Bonus" ×9, "50% Reload Bonus" ×2.
//
// Target name per code = the MY twin's PromotionName (unique, rate-correct,
// CAP/category tokens verified). FC codes skipped — already unique after the
// BR-pair fix, and identical names across sites are fine (different BOs).
//
//   node bin/_dedupe-sg-tleo-names.mjs           # dry-run
//   node bin/_dedupe-sg-tleo-names.mjs --commit
//
// Per promo: pass-1 UpdatePromotionDetails (PromotionName), pass-2
// UpdatePromotionRewardDetails (RewardName) with T&C snapshot + restore
// (feedback-igmp-reward-details-put-wipes-tnc), live verify, fail-fast.
// Gates: MY-name rate/CAP/MIN tokens must match SG LIVE economics; no
// site-wide name collisions on SG.

import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');

async function listAll(site) {
  const all = [];
  for (let pg = 1; pg <= 60; pg++) {
    const r = await igmpPost(site, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
      PromotionCode: '', PromotionName: '', PromotionType: '', IsActive: '', IsPublished: '',
    });
    const rows = r?.data || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 200) break;
  }
  return all;
}

function toDateString(s) {
  const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toDateString();
}
const stripLen = (h) => (h || '').replace(/<[^>]+>/g, '').trim().length;

const [myAll, sgAll] = [await listAll('ws1-v3-my'), await listAll('ws1-v3-sg')];
const myTleo = new Map(myAll.filter((p) => /TLEO/i.test(p.PromotionCode || '') && p.PromotionType === 'Bonus')
  .map((p) => [(p.PromotionCode || '').trim(), (p.PromotionName || '').trim()]));
const sgTleo = sgAll.filter((p) => /TLEO/i.test(p.PromotionCode || '') && p.PromotionType === 'Bonus');
const sgTleoIds = new Set(sgTleo.map((p) => p.PromotionId));
// names used by SG promos OUTSIDE the rename batch
const sgOtherNames = new Map(sgAll.filter((p) => !sgTleoIds.has(p.PromotionId))
  .map((p) => [(p.PromotionName || '').trim(), (p.PromotionCode || '').trim()]));

console.log(`[sg-dedupe] MY: ${myTleo.size} Bonus TLEO | SG: ${sgTleo.length} Bonus TLEO`);

const plan = [];
let blocked = 0, skipped = 0;
const targetSeen = new Map();

for (const p of sgTleo.sort((a, b) => (a.PromotionCode || '').localeCompare(b.PromotionCode || ''))) {
  const code = (p.PromotionCode || '').trim();
  try {
    const target = myTleo.get(code);
    if (!target) throw new Error('no MY twin');
    const det = await igmpPost('ws1-v3-sg', '/PM/GetBonusInfo', { PromotionId: p.PromotionId });
    const promo = det?.data?.Promotion || det?.data;
    const rew = promo?.PromotionRewards?.[0];
    if (!rew?.RewardId) throw new Error('no PromotionRewards[0]');

    const cur = (promo.PromotionName || '').trim();
    if (cur === target && (rew.RewardName || '').trim() === target) { skipped++; continue; }

    // T&C snapshot for preservation
    const ct = await igmpPost('ws1-v3-sg', '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
    const tncRows = (Array.isArray(ct?.data) ? ct.data : [])
      .filter((r) => stripLen(r.Content) > 0)
      .map((r) => ({ Locale: r.Locale, PromotionRewardName: r.PromotionRewardName || '', Content: r.Content }));

    const checks = [];
    const rateTok = target.match(/(\d+)%/);
    if (rateTok && Number(rateTok[1]) !== Number(rew.BonusPercentage)) checks.push(`target says ${rateTok[1]}% but SG live pct=${rew.BonusPercentage}`);
    const capTok = target.match(/CAP(\d+)/);
    if (capTok && Number(capTok[1]) !== Number(rew.CapBonusAmount)) checks.push(`target says CAP${capTok[1]} but SG live cap=${rew.CapBonusAmount}`);
    const minTok = target.match(/MIN(\d+)/);
    if (minTok && Number(minTok[1]) !== Number(rew.MinimumActionAmount)) checks.push(`target says MIN${minTok[1]} but SG live minDep=${rew.MinimumActionAmount}`);
    if (sgOtherNames.has(target)) checks.push(`collision with non-TLEO SG promo ${sgOtherNames.get(target)}`);
    if (targetSeen.has(target)) checks.push(`target name also planned for ${targetSeen.get(target)}`);
    if (!tncRows.find((r) => r.Locale === 'en')) checks.push('no EN T&C to preserve');

    console.log(`${checks.length ? '✗' : '✓'} ${code}  pid=${p.PromotionId} rid=${rew.RewardId}  pct=${rew.BonusPercentage} cap=${rew.CapBonusAmount}`);
    console.log(`    "${cur}"`);
    console.log(`  → "${target}"   [T&C: ${tncRows.map((r) => r.Locale).join(',')}]`);
    checks.forEach((c) => console.log(`    ⚠ ${c}`));

    if (checks.length) { blocked++; continue; }
    targetSeen.set(target, code);
    plan.push({ code, promoId: p.PromotionId, promo, rew, newName: target, tncRows });
  } catch (e) {
    blocked++;
    console.log(`✗ ${code}: ${(e.message || e).slice(0, 100)}`);
  }
}

console.log(`\n${plan.length} to rename, ${skipped} already correct, ${blocked} blocked.`);

if (!COMMIT) {
  console.log('DRY-RUN — no changes made. Re-run with --commit.');
  process.exit(blocked ? 1 : 0);
}
if (blocked) { console.error('ABORT: blocked checks above.'); process.exit(3); }

console.log('\nApplying (fail-fast, per-promo verify)…\n');
let done = 0;
for (const r of plan) {
  try {
    await igmpPost('ws1-v3-sg', '/PM/UpdatePromotionDetails', {
      PromotionId: r.promoId,
      PromotionName: r.newName,
      PromotionDescription: r.promo.PromotionDescription || '',
      PromotionStartDate: toDateString(r.promo.PromotionStartDate),
      PromotionEndDate: toDateString(r.promo.PromotionEndDate),
    });
    await igmpPost('ws1-v3-sg', '/PM/UpdatePromotionRewardDetails', {
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
    await igmpPost('ws1-v3-sg', '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: r.rew.RewardId,
      PromotionRewardContents: r.tncRows,
    });
    // verify
    const det = await igmpPost('ws1-v3-sg', '/PM/GetBonusInfo', { PromotionId: r.promoId });
    const promo = det?.data?.Promotion || det?.data;
    const rew = promo?.PromotionRewards?.[0];
    const ct = await igmpPost('ws1-v3-sg', '/PM/GetPromotionRewardContents', { RewardId: r.rew.RewardId });
    const rows = Array.isArray(ct?.data) ? ct.data : [];
    const tncOk = r.tncRows.every((t) => rows.some((x) => x.Locale === t.Locale && stripLen(x.Content) > 40));
    const econOk = Number(rew.CapBonusAmount) === Number(r.rew.CapBonusAmount)
      && Number(rew.BonusPercentage) === Number(r.rew.BonusPercentage)
      && Number(rew.MinimumActionAmount) === Number(r.rew.MinimumActionAmount)
      && Number(rew.RolloverMultiplier) === Number(r.rew.RolloverMultiplier);
    const nameOk = promo.PromotionName === r.newName && rew.RewardName === r.newName;
    if (!nameOk || !tncOk || !econOk) {
      console.log(`  ✗ ${r.code}: VERIFY FAILED (name=${nameOk} tnc=${tncOk} econ=${econOk}) — ABORTING`);
      process.exit(1);
    }
    done++;
    console.log(`  ✓ ${r.code} → "${r.newName}"`);
  } catch (e) {
    console.log(`  ✗ ${r.code}: ${(e.message || e).slice(0, 120)} — ABORTING`);
    process.exit(1);
  }
}

// Post-save: uniqueness across the whole SG TLEO set (both name fields)
console.log('\nPost-save uniqueness check…');
const after = (await listAll('ws1-v3-sg')).filter((p) => /TLEO/i.test(p.PromotionCode || ''));
const counts = new Map();
after.forEach((p) => {
  const n = (p.PromotionName || '').trim();
  counts.set(n, (counts.get(n) || 0) + 1);
});
const dups = [...counts.entries()].filter(([, c]) => c > 1);
if (dups.length) {
  console.log(`  ✗ duplicates remain:`);
  dups.forEach(([n, c]) => console.log(`     "${n}" ×${c}`));
} else {
  console.log(`  ✓ all ${after.length} SG TLEO PromotionNames unique.`);
}
console.log(`\n${done}/${plan.length} renamed with T&C preserved.`);
process.exit(dups.length ? 1 : 0);
