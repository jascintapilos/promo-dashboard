#!/usr/bin/env node
// Restore PromotionRewardContents on the 5 WS1 SG TLEO promos wiped by the
// 2026-07-06 wrong-rate name fix (root cause: /PM/UpdatePromotionRewardDetails
// silently deletes the reward's PromotionRewardContents — same wipe that
// emptied all 42 MY TLEO T&C during the 2026-07-04 RewardName pass).
//
// Source: each code's MY twin (whose content was itself cloned FROM SG two
// days ago), reverse-swapped: RM→SGD, mb8mys.com→mb8sg.com. Econ-gated
// against SG live values.
//
//   node bin/_restore-sg-tleo-tnc-5.mjs           # dry-run
//   node bin/_restore-sg-tleo-tnc-5.mjs --commit

import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');
const CODES = [
  'FT_REL_TLEO_20PCT_300MX_BR',
  'FT_REL_TLEO_20PCT_400MX_BR',
  'FT_REL_TLEO_LC_20PCT_20MX_BR',
  'FT_REL_TLEO_LC_20PCT_300MX_BR',
  'FT_REL_TLEO_LC_20PCT_400MX_BR',
];

const toSg = (html) => (html || '').replaceAll('mb8mys.com', 'mb8sg.com').replace(/\bRM\b/g, 'SGD');

async function rewardOf(siteId, code) {
  const info = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
  const promoId = info?.data?.PromotionId;
  if (!promoId) throw new Error(`${code} not found on ${siteId}`);
  const det = await igmpPost(siteId, '/PM/GetBonusInfo', { PromotionId: promoId });
  const rew = (det?.data?.Promotion || det?.data)?.PromotionRewards?.[0];
  if (!rew?.RewardId) throw new Error(`${code}: no PromotionRewards[0] on ${siteId}`);
  return rew;
}

const plan = [];
let blocked = 0;
for (const code of CODES) {
  try {
    const sgRew = await rewardOf('ws1-v3-sg', code);
    const myRew = await rewardOf('ws1-v3-my', code);

    // safety: SG must currently be empty (we only restore what was wiped)
    const sgCt = await igmpPost('ws1-v3-sg', '/PM/GetPromotionRewardContents', { RewardId: sgRew.RewardId });
    const sgRows = Array.isArray(sgCt?.data) ? sgCt.data : [];
    if (sgRows.some((r) => (r.Content || '').replace(/<[^>]+>/g, '').trim().length > 40)) {
      console.log(`= ${code}: SG already has content — skipped`);
      continue;
    }

    const myCt = await igmpPost('ws1-v3-my', '/PM/GetPromotionRewardContents', { RewardId: myRew.RewardId });
    const myRows = (Array.isArray(myCt?.data) ? myCt.data : []).filter((r) => ['en', 'zh'].includes(r.Locale));
    if (!myRows.find((r) => r.Locale === 'en')) throw new Error('MY twin has no EN content to clone');

    // econ gate: numbers in MY content must match SG live economics
    const text = toSg(myRows.find((r) => r.Locale === 'en').Content).replace(/<[^>]+>/g, ' ');
    const bad = [];
    if (!new RegExp(`SGD\\s*${Number(sgRew.MinimumActionAmount)}\\b`).test(text)) bad.push(`minDep=${sgRew.MinimumActionAmount}`);
    if (!new RegExp(`SGD\\s*${Number(sgRew.CapBonusAmount)}\\b`).test(text)) bad.push(`cap=${sgRew.CapBonusAmount}`);
    if (!new RegExp(`\\b${Number(sgRew.RolloverMultiplier)}x`).test(text)) bad.push(`to=${sgRew.RolloverMultiplier}x`);
    if (bad.length) { blocked++; console.log(`✗ ${code}: MY content ≠ SG live econ [${bad.join(', ')}] — BLOCKED`); continue; }

    const contents = myRows.map((r) => ({ Locale: r.Locale, PromotionRewardName: r.PromotionRewardName || '', Content: toSg(r.Content) }));
    plan.push({ code, sgRid: sgRew.RewardId, contents });
    const preview = contents[0].Content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    console.log(`✓ ${code}  SG rid=${sgRew.RewardId} ← MY rid=${myRew.RewardId}  [${contents.map((c) => c.Locale).join(',')}]`);
    console.log(`    "${preview}…"`);
  } catch (e) {
    blocked++;
    console.log(`✗ ${code}: ${(e.message || e).slice(0, 120)}`);
  }
}

if (!COMMIT) {
  console.log(`\nDRY-RUN — ${plan.length} would be restored (${blocked} blocked). Re-run with --commit.`);
  process.exit(blocked ? 1 : 0);
}
if (blocked) { console.error('ABORT: blocked items above.'); process.exit(3); }

console.log('\nApplying…');
let fail = 0;
for (const r of plan) {
  try {
    await igmpPost('ws1-v3-sg', '/PM/BulkAddorUpdatePromotionRewardContents', {
      RewardId: r.sgRid,
      PromotionRewardContents: r.contents,
    });
    console.log(`  ✓ ${r.code}`);
  } catch (e) { fail++; console.log(`  ✗ ${r.code}: ${(e.message || e).slice(0, 100)}`); }
}

console.log('\nPost-save verification…');
let bad = 0;
for (const r of plan) {
  const ct = await igmpPost('ws1-v3-sg', '/PM/GetPromotionRewardContents', { RewardId: r.sgRid });
  const rows = Array.isArray(ct?.data) ? ct.data : [];
  const good = ['en', 'zh'].every((loc) => rows.some((x) => x.Locale === loc && (x.Content || '').replace(/<[^>]+>/g, '').trim().length > 40));
  const clean = !rows.some((x) => /mb8mys\.com|\bRM\b/.test(x.Content || ''));
  if (!(good && clean)) bad++;
  console.log(`  ${good && clean ? '✓' : '✗'} ${r.code}: en+zh=${good} noMyLeak=${clean}`);
}
console.log(`\n${plan.length - fail}/${plan.length} restored, ${bad} verification failures.`);
process.exit(fail || bad ? 1 : 0);
