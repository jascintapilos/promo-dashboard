#!/usr/bin/env node
// IGMP companion to probe-aggressive-deposits.mjs.
// Lists active Bonus (deposit) promos on iGMP (WS1/WS2 kiosk sites) and
// pulls per-promo detail to extract rate% / TO / cap / min so they can be
// merged into the cross-platform aggressiveness ranking.
//
// Endpoints:
//   POST /PM/GetPromotionsList?pageNum=N&rowPerPage=N        list
//   POST /PM/GetBonusInfo { PromotionId }                     detail
//
// Only probes sites that have a cookie in igmp-sessions.local.json.

import fs from 'node:fs';
import { igmpPost, listIgmpSites } from '../src/igmp-client.js';

const CCY_BY_SITE = {
  'ws1-v3-my': 'MYR',
  'ws1-v3-sg': 'SGD',
  'ws1-v3-id': 'IDR',
  'ws1-v3-th': 'THB',
  'ws1-v3-kh': 'KHR',
  'ws2': 'MYR',
};

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

async function probeSite(siteId) {
  const t0 = Date.now();
  try {
    const all = [];
    for (let pg = 1; pg <= 40; pg++) {
      const r = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {});
      if (!r?.data?.length) break;
      all.push(...r.data);
      if (r.data.length < 200) break;
    }
    const deposits = all.filter((p) => p.PromotionType === 'Bonus' && p.IsActive);
    const details = await mapLimit(deposits, 10, async (p) => {
      try { return await igmpPost(siteId, '/PM/GetBonusInfo', { PromotionId: p.PromotionId }); }
      catch (e) { return { _error: String(e.message || e) }; }
    });
    const out = [];
    let failed = 0;
    deposits.forEach((p, i) => {
      const d = details[i];
      if (!d || d._error) { failed++; return; }
      const rewards = d?.data?.Promotion?.PromotionRewards || [];
      for (const r of rewards) {
        // Only Deposit-redemption, percentage-based bonus rewards.
        if (r.RedemptionTypeString !== 'Deposit') continue;
        if (r.RewardTypeString !== 'PercentageBased') continue;
        out.push({
          site: siteId,
          brand: siteId === 'ws2' ? 'WS2' : 'WS1',
          platform: 'igmp',
          merchants: siteId === 'ws2' ? 'WS2' : 'WS1',
          promo_id: p.PromotionId,
          code: p.PromotionCode,
          name: p.PromotionName,
          promo_type: 2,
          rate_pct: Number(r.BonusPercentage || 0),
          to_mult: Number(r.RolloverMultiplier || 0),
          ccy: CCY_BY_SITE[siteId] || '?',
          min_dep: Number(r.MinimumActionAmount || 0),
          max_bonus: Number(r.CapBonusAmount || 0),
          max_total_bonus: 0,
          max_per_player: r.RedeemableQuantity ?? null,
          valid_from: p.PromotionStartDate,
          valid_to: p.PromotionEndDate,
        });
      }
    });
    return { ok: true, ms: Date.now() - t0, listCount: deposits.length, detailFailed: failed, rows: out };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e.message || e) };
  }
}

async function main() {
  const sites = listIgmpSites();
  console.log(`Probing ${sites.length} IGMP sites (requires cookie per site)…\n`);

  const results = {};
  const allRows = [];
  for (const s of sites) {
    process.stdout.write(`  ${s.padEnd(14)} `);
    const r = await probeSite(s);
    results[s] = r;
    if (r.ok) {
      console.log(`${String(r.listCount).padStart(4)} active deposits → ${String(r.rows.length).padStart(4)} reward-rows  (${(r.ms / 1000).toFixed(1)}s)`);
      allRows.push(...r.rows);
    } else {
      console.log(`SKIP/FAIL  ${r.error.slice(0, 100)}`);
    }
  }

  fs.mkdirSync('tmp', { recursive: true });
  const out = 'tmp/aggressive-deposits-igmp.json';
  fs.writeFileSync(out, JSON.stringify({ probedAt: new Date().toISOString(), results, rows: allRows }, null, 2));
  console.log(`\nDumped ${allRows.length} reward-rows → ${out}\n`);

  if (!allRows.length) return;

  const real = allRows.filter((r) => !/^TEST[_-]/i.test(r.code) && !/\btest\b/i.test(r.name || ''));

  const fmt = (r) => {
    const rate = r.rate_pct ? `${r.rate_pct}%`.padStart(5) : '   - ';
    const to = r.to_mult ? `${r.to_mult}x`.padStart(5) : '   - ';
    const min = r.min_dep ? String(r.min_dep).padStart(7) : '      -';
    const cap = r.max_bonus ? String(r.max_bonus).padStart(9) : '        -';
    return `${(r.brand).padEnd(6)} ${String(r.ccy).padEnd(3)} rate=${rate}  TO=${to}  min=${min}  cap=${cap}  ${r.code}`;
  };

  console.log('── IGMP TOP 15 BY RATE % ──');
  real.slice().sort((a, b) => b.rate_pct - a.rate_pct).slice(0, 15).forEach((r) => console.log(`  ${fmt(r)}`));
  console.log('');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
