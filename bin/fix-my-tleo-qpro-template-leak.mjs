#!/usr/bin/env node
// Fix 3 WS1 MY TLEO promos whose reward T&C carries the QPRO/QP2 8-clause
// template (with the "Refresh button" reminder clause) instead of WS1's own
// 5-clause format (reference-inbox-tnc-docs). Alysa caught and manually
// corrected the SG twins on 2026-07-06; MY was never fixed (last touched
// 2026-07-04, before this QC pass). Auditor's Q1 check added same day after
// this was found — previously misclassified as a harmless "newer template".
//
//   node bin/fix-my-tleo-qpro-template-leak.mjs           # dry-run
//   node bin/fix-my-tleo-qpro-template-leak.mjs --commit
//
// Clone the now-correct SG content (SGD→RM, mb8sg.com→mb8mys.com), gated on
// SG's numbers matching MY's live economics — same recipe as
// fix-ws1-my-tleo-tnc.mjs. Write-only via BulkAddorUpdatePromotionRewardContents
// (no reward-detail PUT — no T&C-wipe risk).

import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');
const CODES = ['FT_REL_TLEO_LC_20PCT_100MX', 'FT_REL_TLEO_LC_45PCT_138MX_BR', 'FT_REL_TLEO_LC_45PCT_48MX_BR'];

const toMy = (html) => (html || '').replaceAll('mb8sg.com', 'mb8mys.com').replace(/\bSGD\b/g, 'RM');
const strip = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const plan = [];
let blocked = 0;

for (const code of CODES) {
  try {
    const [myInfo, sgInfo] = await Promise.all([
      igmpPost('ws1-v3-my', '/PM/GetPromotionInfoByCode', { PromotionCode: code }),
      igmpPost('ws1-v3-sg', '/PM/GetPromotionInfoByCode', { PromotionCode: code }),
    ]);
    const myPid = myInfo?.data?.PromotionId;
    const sgPid = sgInfo?.data?.PromotionId;
    if (!myPid || !sgPid) throw new Error('code not found on one of the sites');

    const [myDet, sgDet] = await Promise.all([
      igmpPost('ws1-v3-my', '/PM/GetBonusInfo', { PromotionId: myPid }),
      igmpPost('ws1-v3-sg', '/PM/GetBonusInfo', { PromotionId: sgPid }),
    ]);
    const myRew = (myDet?.data?.Promotion || myDet?.data)?.PromotionRewards?.[0];
    const sgRew = (sgDet?.data?.Promotion || sgDet?.data)?.PromotionRewards?.[0];
    if (!myRew?.RewardId || !sgRew?.RewardId) throw new Error('no PromotionRewards[0]');

    // current MY content must still show the defect (rerun-safe guard)
    const myCt = await igmpPost('ws1-v3-my', '/PM/GetPromotionRewardContents', { RewardId: myRew.RewardId });
    const myEn = (Array.isArray(myCt?.data) ? myCt.data : []).find((r) => r.Locale === 'en');
    if (!/Refresh button/i.test(strip(myEn?.Content))) { console.log(`= ${code}: MY already fixed — skip`); continue; }

    const sgCt = await igmpPost('ws1-v3-sg', '/PM/GetPromotionRewardContents', { RewardId: sgRew.RewardId });
    const sgRows = (Array.isArray(sgCt?.data) ? sgCt.data : []).filter((r) => ['en', 'zh'].includes(r.Locale));
    const sgEn = sgRows.find((r) => r.Locale === 'en');
    if (!sgEn) throw new Error('SG source has no EN content to clone');
    if (/Refresh button/i.test(strip(sgEn.Content))) throw new Error('SG source ITSELF still has the QPRO template — do not clone a broken source');

    // econ gate: SG numbers must match MY live economics
    const text = toMy(sgEn.Content);
    const bad = [];
    if (!new RegExp(`RM\\s*${Number(myRew.MinimumActionAmount)}\\b`).test(strip(text))) bad.push(`minDep=${myRew.MinimumActionAmount}`);
    if (!new RegExp(`RM\\s*${Number(myRew.CapBonusAmount)}\\b`).test(strip(text))) bad.push(`cap=${myRew.CapBonusAmount}`);
    if (!new RegExp(`\\b${Number(myRew.RolloverMultiplier)}x`).test(strip(text))) bad.push(`to=${myRew.RolloverMultiplier}x`);
    if (bad.length) { blocked++; console.log(`✗ ${code}: SG content ≠ MY live economics [${bad.join(', ')}] — BLOCKED`); continue; }

    const contents = sgRows.map((r) => ({ Locale: r.Locale, PromotionRewardName: r.PromotionRewardName || '', Content: toMy(r.Content) }));
    plan.push({ code, myRid: myRew.RewardId, sgRid: sgRew.RewardId, contents });
    console.log(`✓ ${code}  MY rid=${myRew.RewardId} ← SG rid=${sgRew.RewardId}  [${contents.map((c) => c.Locale).join(',')}]`);
    console.log(`    old (MY, broken): "${strip(myEn.Content).slice(0, 100)}…"`);
    console.log(`    new (from SG):    "${strip(contents[0].Content).slice(0, 100)}…"`);
  } catch (e) {
    blocked++;
    console.log(`✗ ${code}: ${(e.message || e).slice(0, 120)}`);
  }
}

if (!COMMIT) {
  console.log(`\nDRY-RUN — ${plan.length} of ${CODES.length} would be fixed (${blocked} blocked). Re-run with --commit.`);
  process.exit(blocked ? 1 : 0);
}
if (blocked) { console.error('\nABORT: blocked items above.'); process.exit(3); }

console.log('\nApplying…\n');
let ok = 0, fail = 0;
for (const r of plan) {
  try {
    await igmpPost('ws1-v3-my', '/PM/BulkAddorUpdatePromotionRewardContents', {
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

console.log('\nPost-save verification…');
let bad = 0;
for (const r of plan) {
  const ct = await igmpPost('ws1-v3-my', '/PM/GetPromotionRewardContents', { RewardId: r.myRid });
  const rows = Array.isArray(ct?.data) ? ct.data : [];
  const en = rows.find((x) => x.Locale === 'en');
  const zh = rows.find((x) => x.Locale === 'zh');
  const clean = en && !/Refresh button/i.test(strip(en.Content)) && !/mb8sg\.com|\bSGD\b/.test(en.Content)
    && (!zh || (!/刷新按钮/.test(strip(zh.Content)) && !/mb8sg\.com|SGD/.test(zh.Content)));
  if (!clean) { bad++; console.log(`  ✗ ${r.code}: still shows QPRO template or SG leakage`); }
  else console.log(`  ✓ ${r.code}: QPRO template gone, proper WS1 5-clause format, no SG leakage`);
}
console.log(`\n${ok} applied / ${fail} failed / ${bad} verification failures.`);
process.exit(fail || bad ? 1 : 0);
