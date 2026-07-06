#!/usr/bin/env node
// Backfill missing reward T&C for the 42 Bonus-type TLEO promos on WS1 MY.
//
// Probe (bin/_probe-ws1-tleo-tnc.mjs, 2026-07-06) found: all 42 Bonus TLEO
// codes on WS1 MY have ZERO PromotionRewardContents rows, while WS1 SG has
// approved en+zh content for the SAME 42 codes. The MY family was replicated
// (replicate-tleo-ws1.mjs) without the T&C step. FC-type TLEO codes have T&C
// on both sites — out of scope here.
//
// Strategy: clone SG content per code → swap currency prefix (SGD→RM) and
// T&C domain (mb8sg.com→mb8mys.com, per feedback-cross-brand-mt-swap-tncdomain)
// → sanity-check every number in the SG stats table against MY LIVE reward
// economics (MinimumActionAmount / CapBonusAmount / RolloverMultiplier /
// BonusPercentage). Mismatch = flag + skip (never save wrong numbers).
//
//   node bin/fix-ws1-my-tleo-tnc.mjs           # dry-run
//   node bin/fix-ws1-my-tleo-tnc.mjs --commit  # live save + post-save QC
//
// Write endpoint: /PM/BulkAddorUpdatePromotionRewardContents
// (same recipe as bin/_archive/_update-tleo-ws1-tnc.mjs).

import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');
const SRC = 'ws1-v3-sg';
const DST = 'ws1-v3-my';

async function listTleoBonus(siteId) {
  const all = [];
  for (let pg = 1; pg <= 60; pg++) {
    const r = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
      PromotionCode: '', PromotionName: '', PromotionType: '', IsActive: '', IsPublished: '',
    });
    const rows = r?.data || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 200) break;
  }
  return all.filter((p) => /TLEO/i.test(p.PromotionCode || '') && p.PromotionType === 'Bonus');
}

async function rewardOf(siteId, promotionId) {
  const det = await igmpPost(siteId, '/PM/GetBonusInfo', { PromotionId: promotionId });
  const promo = det?.data?.Promotion || det?.data;
  return promo?.PromotionRewards?.[0] || null;
}

// Swap SG-specific strings for MY
function toMy(html) {
  return (html || '')
    .replaceAll('mb8sg.com', 'mb8mys.com')
    .replace(/\bSGD\b/g, 'RM');
}

// Every standalone number in the SG stats-table region must correspond to a
// MY live economics value. We check the strong three: minDep, cap, turnover
// (+ bonus % which also appears in the title).
function econMismatch(sgHtml, myRew) {
  const text = (sgHtml || '').replace(/<[^>]+>/g, ' ');
  const want = {
    minDep: Number(myRew.MinimumActionAmount),
    cap: Number(myRew.CapBonusAmount),
    to: Number(myRew.RolloverMultiplier),
    pct: Number(myRew.BonusPercentage),
  };
  const missing = [];
  if (want.minDep && !new RegExp(`(SGD|RM)\\s*${want.minDep}\\b`).test(text)) missing.push(`minDep=${want.minDep}`);
  if (want.cap && !new RegExp(`(SGD|RM)\\s*${want.cap}\\b`).test(text)) missing.push(`cap=${want.cap}`);
  if (want.to && !new RegExp(`\\b${want.to}x`).test(text)) missing.push(`TO=${want.to}x`);
  if (want.pct && !new RegExp(`\\b${want.pct}%`).test(text)) missing.push(`pct=${want.pct}%`);
  return missing;
}

const [srcList, dstList] = await Promise.all([listTleoBonus(SRC), listTleoBonus(DST)]);
const srcByCode = new Map(srcList.map((p) => [(p.PromotionCode || '').trim(), p]));
console.log(`[tnc-fix] SG: ${srcList.length} Bonus TLEO | MY: ${dstList.length} Bonus TLEO`);

const plan = [];
const problems = [];

for (const my of dstList.sort((a, b) => (a.PromotionCode || '').localeCompare(b.PromotionCode || ''))) {
  const code = (my.PromotionCode || '').trim();
  try {
    const myRew = await rewardOf(DST, my.PromotionId);
    if (!myRew?.RewardId) throw new Error('MY: no PromotionRewards[0]');

    // Skip if MY already has non-trivial content (rerun-safe)
    const existing = await igmpPost(DST, '/PM/GetPromotionRewardContents', { RewardId: myRew.RewardId });
    const existingRows = Array.isArray(existing?.data) ? existing.data : [];
    if (existingRows.some((r) => (r.Content || '').replace(/<[^>]+>/g, '').trim().length > 40)) {
      problems.push(`= ${code}: MY already has content — skipped (rerun-safe)`);
      continue;
    }

    const sg = srcByCode.get(code);
    if (!sg) throw new Error('no matching SG promo for this code');
    const sgRew = await rewardOf(SRC, sg.PromotionId);
    if (!sgRew?.RewardId) throw new Error('SG: no PromotionRewards[0]');

    const sgCt = await igmpPost(SRC, '/PM/GetPromotionRewardContents', { RewardId: sgRew.RewardId });
    const sgRows = (Array.isArray(sgCt?.data) ? sgCt.data : []).filter((r) => ['en', 'zh'].includes(r.Locale));
    if (!sgRows.find((r) => r.Locale === 'en')) throw new Error('SG has no EN content row');

    // Economics sanity: SG content numbers must match MY live economics
    const enRow = sgRows.find((r) => r.Locale === 'en');
    const mism = econMismatch(enRow.Content, myRew);
    if (mism.length) {
      problems.push(`⚠ ${code}: SG content numbers ≠ MY live economics [${mism.join(', ')}] — SKIPPED, needs rebuild from MY econ`);
      continue;
    }

    const contents = sgRows.map((r) => ({
      Locale: r.Locale,
      PromotionRewardName: r.PromotionRewardName || '',
      Content: toMy(r.Content),
    }));
    plan.push({ code, myRid: myRew.RewardId, sgRid: sgRew.RewardId, contents, econ: `min=${myRew.MinimumActionAmount} cap=${myRew.CapBonusAmount} to=${myRew.RolloverMultiplier}x pct=${myRew.BonusPercentage}%` });
  } catch (e) {
    problems.push(`✗ ${code}: ${(e.message || e).slice(0, 120)}`);
  }
}

console.log(`\nT&C backfill plan — ${plan.length} promos:\n`);
for (const r of plan) {
  const preview = r.contents[0].Content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
  console.log(`  ${r.code}  MY rid=${r.myRid} ← SG rid=${r.sgRid}  locales=[${r.contents.map((c) => c.Locale).join(',')}]  ${r.econ}`);
  console.log(`     "${preview}…"\n`);
}
if (problems.length) {
  console.log('Notes / problems:');
  problems.forEach((x) => console.log(`  ${x}`));
}

if (!COMMIT) {
  console.log(`\nDRY-RUN — no changes made. ${plan.length} would be written. Re-run with --commit.`);
  process.exit(0);
}

console.log('\nApplying…\n');
let ok = 0, fail = 0;
for (const r of plan) {
  try {
    await igmpPost(DST, '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: r.myRid,
      PromotionRewardContents: r.contents,
    });
    ok++;
    console.log(`  ✓ ${r.code}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${r.code}: ${(e.message || e).slice(0, 100)}`);
  }
}

// Post-save QC: re-read every MY TLEO Bonus reward's contents
console.log('\nPost-save verification…');
let qcOk = 0, qcBad = 0;
for (const my of dstList) {
  const code = (my.PromotionCode || '').trim();
  try {
    const rew = await rewardOf(DST, my.PromotionId);
    const ct = await igmpPost(DST, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
    const rows = Array.isArray(ct?.data) ? ct.data : [];
    const good = ['en', 'zh'].every((loc) => rows.some((r) => r.Locale === loc && (r.Content || '').replace(/<[^>]+>/g, '').trim().length > 40));
    const noSgLeak = !rows.some((r) => /mb8sg\.com|\bSGD\b/.test(r.Content || ''));
    if (good && noSgLeak) qcOk++;
    else { qcBad++; console.log(`  ✗ ${code}: en+zh=${good} noSgLeak=${noSgLeak}`); }
  } catch (e) {
    qcBad++;
    console.log(`  ✗ ${code}: QC error ${(e.message || e).slice(0, 80)}`);
  }
}
console.log(`\nApplied ${ok} ok / ${fail} failed. QC: ${qcOk}/${dstList.length} verified with en+zh MY-localised T&C.`);
process.exit(fail || qcBad ? 1 : 0);
