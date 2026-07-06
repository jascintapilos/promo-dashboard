#!/usr/bin/env node
// Fix wrong category clause in TLEO reward T&C on WS1 MY + SG.
//
// Promo request sheet (Apr 2026 r64-132, May 2026 r125-164, col M) says:
//   - reload codes WITHOUT an _LC_ token = "Slot only" (not all-games)
//   - FT_TLEO_FC* = "Slot and LC only"
// but live T&C say "valid across all game categories (excluding Blackjack
// and Virtual Sports)" on 18 reloads + 12 FC per site. Wording for the
// combined FC clause confirmed by Wai Yip 2026-07-06.
//
//   node bin/fix-tleo-tnc-categories.mjs           # dry-run
//   node bin/fix-tleo-tnc-categories.mjs --commit
//
// Targeted exact-string replacement inside the existing HTML (clause number
// preserved), written via BulkAddorUpdatePromotionRewardContents — safe, no
// reward-detail PUT (feedback-igmp-reward-details-put-wipes-tnc).

import { igmpPost } from '../src/igmp-client.js';

const COMMIT = process.argv.includes('--commit');
const SITES = ['ws1-v3-my', 'ws1-v3-sg'];

const SLOT_RELOADS = [
  'FT_REL_TLEO_20PCT_100MX', 'FT_REL_TLEO_20PCT_100MX_BR',
  'FT_REL_TLEO_20PCT_200MX', 'FT_REL_TLEO_20PCT_200MX_BR',
  'FT_REL_TLEO_20PCT_20MX_BR', 'FT_REL_TLEO_20PCT_300MX',
  'FT_REL_TLEO_20PCT_300MX_BR', 'FT_REL_TLEO_20PCT_400MX',
  'FT_REL_TLEO_20PCT_400MX_BR', 'FT_REL_TLEO_20PCT_60MX_BR',
  'FT_REL_TLEO_45PCT_138MX', 'FT_REL_TLEO_45PCT_228MX',
  'FT_REL_TLEO_45PCT_228MX_BR', 'FT_REL_TLEO_45PCT_458MX',
  'FT_REL_TLEO_45PCT_458MX_BR', 'FT_REL_TLEO_45PCT_48MX',
  'FT_REL_TLEO_45PCT_688MX', 'FT_REL_TLEO_45PCT_888MX',
];
const FC_CODES = [
  'FT_TLEO_FC10_10X', 'FT_TLEO_FC1088_10X', 'FT_TLEO_FC138_10X',
  'FT_TLEO_FC228_10X', 'FT_TLEO_FC228_10X_BR', 'FT_TLEO_FC458_10X',
  'FT_TLEO_FC458_10X_BR', 'FT_TLEO_FC48_10X', 'FT_TLEO_FC688_10X',
  'FT_TLEO_FC88_10X', 'FT_TLEO_FC888_10X', 'FT_TLEO_FC888_10X_BR',
];

const OLD_EN = 'This promotion is valid across all game categories (excluding Blackjack and Virtual Sports).';
// Two ZH wordings exist in the family (2026-06 replication batch vs the
// 12 rebuilt by _archive/_update-tleo-ws1-tnc.mjs)
const OLD_ZH_VARIANTS = [
  '本优惠适用于所有游戏类别（二十一点和虚拟体育除外）。',
  '本次促销活动适用于所有游戏类别（不包括二十一点和虚拟体育）。',
];
const NEW_EN = {
  SLOT: 'This promotion is valid for Slots only (excluding Arcade and Table games).',
  SLOTLC: 'This promotion is valid for Slots and Live Casino only (excluding Arcade, Table games and Blackjack).',
};
const NEW_ZH = {
  SLOT: '本优惠仅适用于老虎机游戏（街机和桌面游戏除外）。',
  SLOTLC: '本优惠仅适用于老虎机游戏及真人娱乐场（街机、桌面游戏及二十一点除外）。',
};

const TARGETS = [
  ...SLOT_RELOADS.map((code) => ({ code, kind: 'SLOT', fc: false })),
  ...FC_CODES.map((code) => ({ code, kind: 'SLOTLC', fc: true })),
];

let totalPlanned = 0, totalBlocked = 0, totalFail = 0;
const plans = {};

for (const site of SITES) {
  console.log(`\n${'━'.repeat(70)}\n  ${site}\n${'━'.repeat(70)}`);
  const plan = [];
  for (const t of TARGETS) {
    try {
      const info = await igmpPost(site, '/PM/GetPromotionInfoByCode', { PromotionCode: t.code });
      const promoId = info?.data?.PromotionId;
      if (!promoId) throw new Error('not found');
      const det = await igmpPost(site, t.fc ? '/PM/GetFreeCreditInfo' : '/PM/GetBonusInfo', { PromotionId: promoId });
      const rew = (det?.data?.Promotion || det?.data)?.PromotionRewards?.[0];
      if (!rew?.RewardId) throw new Error('no PromotionRewards[0]');
      const ct = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
      const rows = (Array.isArray(ct?.data) ? ct.data : []).filter((r) => ['en', 'zh'].includes(r.Locale));
      const en = rows.find((r) => r.Locale === 'en');
      const zh = rows.find((r) => r.Locale === 'zh');
      if (!en) throw new Error('no EN content row');

      const checks = [];
      if (en.Content.includes(NEW_EN[t.kind])) { console.log(`  = ${t.code}: EN already patched — skip`); continue; }
      if (!en.Content.includes(OLD_EN)) checks.push('EN: exact all-categories sentence NOT found');
      const zhOld = zh ? OLD_ZH_VARIANTS.find((v) => zh.Content.includes(v)) : null;
      if (zh && !zhOld && !zh.Content.includes(NEW_ZH[t.kind])) checks.push('ZH: no known all-categories sentence found');

      if (checks.length) {
        totalBlocked++;
        console.log(`  ✗ ${t.code} (pid=${promoId} rid=${rew.RewardId}): ${checks.join('; ')}`);
        continue;
      }

      const contents = [
        { Locale: 'en', PromotionRewardName: en.PromotionRewardName || '', Content: en.Content.replace(OLD_EN, NEW_EN[t.kind]) },
        ...(zh ? [{ Locale: 'zh', PromotionRewardName: zh.PromotionRewardName || '', Content: zhOld ? zh.Content.replace(zhOld, NEW_ZH[t.kind]) : zh.Content }] : []),
      ];
      plan.push({ ...t, promoId, rid: rew.RewardId, contents });
      totalPlanned++;
      console.log(`  ✓ ${t.code} (pid=${promoId} rid=${rew.RewardId}) [${t.kind}] locales=${contents.length}`);
    } catch (e) {
      totalFail++;
      console.log(`  ✗ ${t.code}: ${(e.message || e).slice(0, 100)}`);
    }
  }
  plans[site] = plan;
  console.log(`  ${site}: ${plan.length} planned`);
}

console.log(`\nTotals: ${totalPlanned} planned, ${totalBlocked} blocked, ${totalFail} errors`);
console.log(`\nClause replacements:`);
console.log(`  SLOT   EN: "${NEW_EN.SLOT}"`);
console.log(`         ZH: "${NEW_ZH.SLOT}"`);
console.log(`  SLOTLC EN: "${NEW_EN.SLOTLC}"`);
console.log(`         ZH: "${NEW_ZH.SLOTLC}"`);

if (!COMMIT) {
  console.log('\nDRY-RUN — no changes made. Re-run with --commit.');
  process.exit(totalBlocked || totalFail ? 1 : 0);
}
if (totalBlocked || totalFail) { console.error('\nABORT: blocked/errored items above.'); process.exit(3); }

let ok = 0, fail = 0;
for (const site of SITES) {
  console.log(`\nApplying on ${site}…`);
  for (const r of plans[site]) {
    try {
      await igmpPost(site, '/PM/BulkAddorUpdatePromotionRewardContents', {
        RewardId: r.rid,
        PromotionRewardContents: r.contents,
      });
      ok++;
      console.log(`  ✓ ${r.code}`);
    } catch (e) { fail++; console.log(`  ✗ ${r.code}: ${(e.message || e).slice(0, 100)}`); }
  }
}

console.log('\nPost-save verification…');
let bad = 0;
for (const site of SITES) {
  for (const r of plans[site]) {
    const ct = await igmpPost(site, '/PM/GetPromotionRewardContents', { RewardId: r.rid });
    const rows = Array.isArray(ct?.data) ? ct.data : [];
    const en = rows.find((x) => x.Locale === 'en');
    const zh = rows.find((x) => x.Locale === 'zh');
    const good = en?.Content.includes(NEW_EN[r.kind]) && !en?.Content.includes(OLD_EN)
      && (!zh || (zh.Content.includes(NEW_ZH[r.kind]) && !OLD_ZH_VARIANTS.some((v) => zh.Content.includes(v))));
    if (!good) { bad++; console.log(`  ✗ ${site} ${r.code}`); }
  }
}
console.log(`\n${ok} applied / ${fail} failed / ${bad} verification failures.`);
process.exit(fail || bad ? 1 : 0);
