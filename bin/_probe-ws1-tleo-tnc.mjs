#!/usr/bin/env node
// Probe: T&C (PromotionRewardContents) coverage for ALL TLEO-coded promos
// on WS1 MY + SG. Read-only. For each TLEO promo: PromotionId → GetBonusInfo
// (RewardId + live economics) → GetPromotionRewardContents (locales present).
//
//   node bin/_probe-ws1-tleo-tnc.mjs
//
// Flags per promo: MISSING (no rows), EN-ONLY / ZH-ONLY, EMPTY (rows with
// blank content), OK (en+zh with non-trivial content).

import { igmpPost } from '../src/igmp-client.js';

const SITES = [
  { siteId: 'ws1-v3-my', label: 'WS1 MY' },
  { siteId: 'ws1-v3-sg', label: 'WS1 SG' },
];

async function listAll(siteId) {
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
  return all;
}

let sampleDumped = false;
const summary = [];

for (const { siteId, label } of SITES) {
  let tleo;
  try {
    tleo = (await listAll(siteId)).filter((p) => /TLEO/i.test(p.PromotionCode || ''));
  } catch (e) {
    console.log(`\n${label}: LIST FAILED — ${e.message.slice(0, 120)}`);
    continue;
  }
  console.log(`\n${'━'.repeat(70)}\n  ${label} — ${tleo.length} TLEO promos\n${'━'.repeat(70)}`);
  const counts = { OK: 0, MISSING: 0, PARTIAL: 0, EMPTY: 0, ERR: 0 };

  for (const p of tleo.sort((a, b) => (a.PromotionCode || '').localeCompare(b.PromotionCode || ''))) {
    const code = (p.PromotionCode || '').trim();
    const detailEndpoint = {
      FreeCredit: '/PM/GetFreeCreditInfo',
      FreeSpin: '/PM/GetFreeSpinPromotionInfo',
    }[p.PromotionType] || '/PM/GetBonusInfo';
    try {
      const det = await igmpPost(siteId, detailEndpoint, { PromotionId: p.PromotionId });
      const promo = det?.data?.Promotion || det?.data;
      const reward = promo?.PromotionRewards?.[0];
      if (!reward?.RewardId) {
        counts.ERR++;
        console.log(`  ✗ ${code}: no PromotionRewards[0]`);
        continue;
      }
      if (!sampleDumped) {
        sampleDumped = true;
        console.log(`  [sample GetBonusInfo economics keys for plan-drafting]`);
        console.log(`    Promotion keys: ${Object.keys(promo).join(', ')}`);
        console.log(`    Reward keys:    ${Object.keys(reward).join(', ')}`);
        const bd = det?.data?.BonusDetails || det?.data?.Bonus || promo?.BonusDetails;
        if (bd) console.log(`    BonusDetails:   ${JSON.stringify(bd).slice(0, 600)}`);
      }

      const ct = await igmpPost(siteId, '/PM/GetPromotionRewardContents', { RewardId: reward.RewardId });
      const rows = Array.isArray(ct?.data) ? ct.data : [];
      const locs = rows.map((r) => `${r.Locale}:${(r.Content || '').replace(/<[^>]+>/g, '').trim().length}ch`);
      const nonTrivial = rows.filter((r) => (r.Content || '').replace(/<[^>]+>/g, '').trim().length > 40);
      const hasEn = nonTrivial.some((r) => r.Locale === 'en');
      const hasZh = nonTrivial.some((r) => r.Locale === 'zh');

      let status;
      if (!rows.length) status = 'MISSING';
      else if (!nonTrivial.length) status = 'EMPTY';
      else if (hasEn && hasZh) status = 'OK';
      else status = 'PARTIAL';
      counts[status]++;

      const mark = status === 'OK' ? '✓' : '✗';
      console.log(`  ${mark} ${status.padEnd(8)} ${code.padEnd(38)} pid=${String(p.PromotionId).padEnd(5)} rid=${String(reward.RewardId).padEnd(6)} active=${p.IsActive === true || p.IsActive === 1 ? 'Y' : 'n'} [${locs.join(' ') || 'no rows'}]`);
      summary.push({ site: siteId, code, pid: p.PromotionId, rid: reward.RewardId, status });
    } catch (e) {
      counts.ERR++;
      console.log(`  ✗ ERR      ${code}: ${(e.message || e).slice(0, 100)}`);
    }
  }
  console.log(`\n  ${label} totals: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`);
}

const needFix = summary.filter((s) => s.status !== 'OK');
console.log(`\n${'═'.repeat(70)}\nTotal needing T&C fix: ${needFix.length} of ${summary.length} probed`);
