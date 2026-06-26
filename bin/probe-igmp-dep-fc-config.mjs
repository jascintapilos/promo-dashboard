#!/usr/bin/env node
// Probe all WS1/WS2 Deposit Bonus and Free Credit promos for sensitive misconfigs:
//
//   Deposit Bonus (GetBonusInfo → d.data.Promotion.PromotionRewards[0]):
//     ✗ ZERO_TO    — RolloverMultiplier = 0 (no turnover, member can withdraw immediately)
//     ✗ ZERO_AMT   — RewardType=Percentage but BonusPercentage=0, OR RewardType=Fixed but FixedBonusAmount=0
//
//   Free Credit (GetFreeCreditInfo → d.data.Promotion.PromotionRewards[0]):
//     ✗ ZERO_TO    — RolloverMultiplier = 0
//     ✗ ZERO_AMT   — FixedBonusAmount=0 (member gets nothing)
//
// Only probes ACTIVE promos. TEST_ skipped by default (--all to include).
//
// Usage: node bin/probe-igmp-dep-fc-config.mjs [--all]

import { igmpPost, listIgmpSites } from '../src/igmp-client.js';

const SHOW_ALL = process.argv.includes('--all');

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

const DETAIL_EP = {
  Bonus:      '/PM/GetBonusInfo',
  FreeCredit: '/PM/GetFreeCreditInfo',
};

function checkReward(rew, type) {
  const flags = [];
  const to = Number(rew.RolloverMultiplier ?? -1);
  if (to === 0) flags.push('ZERO_TO');

  if (type === 'Bonus') {
    const rt = Number(rew.RewardType ?? -1);
    if (rt === 0 && Number(rew.BonusPercentage ?? 0) === 0) flags.push('ZERO_AMT(pct=0%)');
    if (rt === 1 && Number(rew.FixedBonusAmount ?? 0) === 0) flags.push('ZERO_AMT(fixed=0)');
  } else {
    // Free Credit — always fixed amount on wire
    if (Number(rew.FixedBonusAmount ?? 0) === 0 && Number(rew.BonusPercentage ?? 0) === 0) {
      flags.push('ZERO_AMT');
    }
  }
  return { flags, to, pct: Number(rew.BonusPercentage ?? 0), fixed: Number(rew.FixedBonusAmount ?? 0) };
}

async function probeSite(siteId) {
  // Fetch full list
  const all = [];
  for (let pg = 1; pg <= 40; pg++) {
    const r = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {});
    if (!r?.data?.length) break;
    all.push(...r.data);
    if (r.data.length < 200) break;
  }

  // Active Dep + FC promos, skip TEST_ unless --all
  const targets = all.filter((p) =>
    (p.PromotionType === 'Bonus' || p.PromotionType === 'FreeCredit') &&
    p.IsActive &&
    (SHOW_ALL || !/^TEST[_\s]/i.test(p.PromotionCode))
  );

  if (!targets.length) return [];

  const details = await mapLimit(targets, 5, async (p) => {
    const ep = DETAIL_EP[p.PromotionType];
    try {
      return await igmpPost(siteId, ep, { PromotionId: p.PromotionId });
    } catch (e) {
      return { _error: String(e.message || e) };
    }
  });

  const rows = [];
  targets.forEach((p, i) => {
    const d = details[i];
    const type = p.PromotionType === 'Bonus' ? 'Dep' : 'FC';

    if (!d || d._error) {
      rows.push({ site: siteId, type, code: p.PromotionCode, flags: ['FETCH_ERROR'], to: '-', pct: '-', fixed: '-' });
      return;
    }

    // Dep + FC both wrap under d.data.Promotion
    const rew = d?.data?.Promotion?.PromotionRewards?.[0];
    if (!rew) {
      rows.push({ site: siteId, type, code: p.PromotionCode, flags: ['NO_REWARD'], to: '-', pct: '-', fixed: '-' });
      return;
    }

    const { flags, to, pct, fixed } = checkReward(rew, p.PromotionType);
    if (flags.length > 0) {
      rows.push({ site: siteId, type, code: p.PromotionCode, flags, to, pct, fixed });
    }
  });

  return rows;
}

const sites = listIgmpSites();
console.log(`Probing ${sites.length} IGMP sites — active Dep + FC misconfigs...`);
if (!SHOW_ALL) console.log('(TEST_ codes skipped — use --all to include)\n');
else console.log('(--all: including TEST_ codes)\n');

const allFlags = [];
for (const siteId of sites) {
  process.stdout.write(`  ${siteId.padEnd(14)} `);
  try {
    const rows = await probeSite(siteId);
    console.log(`${rows.length} flagged`);
    allFlags.push(...rows);
  } catch (e) {
    console.log(`SKIP/FAIL  ${String(e.message || e).slice(0, 80)}`);
  }
}

console.log('\n');

if (!allFlags.length) {
  console.log('✓ No misconfigs found.');
  process.exit(0);
}

// Group by site
const bySite = {};
for (const r of allFlags) {
  (bySite[r.site] = bySite[r.site] || []).push(r);
}

for (const [site, rows] of Object.entries(bySite)) {
  console.log(`━━ ${site} (${rows.length} flagged) ━━`);
  console.log('Type  Flags                    TO    Pct%  Fixed  Code');
  console.log('─'.repeat(90));
  for (const r of rows) {
    console.log(
      `${r.type.padEnd(6)}${r.flags.join(',').padEnd(25)}${String(r.to).padEnd(6)}${String(r.pct).padEnd(6)}${String(r.fixed).padEnd(7)}${r.code}`
    );
  }
  console.log('');
}

// ZERO_TO summary
const zeroTo = allFlags.filter((r) => r.flags.includes('ZERO_TO'));
const zeroAmt = allFlags.filter((r) => r.flags.some((f) => f.startsWith('ZERO_AMT')));

if (zeroTo.length) {
  console.log(`⚠ ZERO_TO — ${zeroTo.length} active promo(s) with RolloverMultiplier=0 (no turnover):`);
  for (const r of zeroTo) console.log(`  [${r.type}] ${r.site}  ${r.code}`);
  console.log('  → Verify these are intentionally no-TO promos before actioning.\n');
}

if (zeroAmt.length) {
  console.log(`✗ ZERO_AMT — ${zeroAmt.length} active promo(s) with bonus amount = 0 (members get nothing):`);
  for (const r of zeroAmt) console.log(`  [${r.type}] ${r.site}  ${r.code}  (${r.flags.find((f) => f.startsWith('ZERO_AMT'))})`);
  console.log('  → These are likely misconfigured and should be deactivated immediately.\n');
}
