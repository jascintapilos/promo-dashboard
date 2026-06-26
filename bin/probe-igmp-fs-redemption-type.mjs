#!/usr/bin/env node
// Probe ALL WS1/WS2 FreeSpin promos and report their RedemptionType.
// Flags any with RedemptionType=Claim (1) but MinimumActionAmount > 0 (should be Deposit/0).
// Shows full list so operator-created codes are also visible.
//
// Usage: node bin/probe-igmp-fs-redemption-type.mjs [--all]
//   default: skip TEST_ codes
//   --all:   include TEST_ codes

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

async function probeSite(siteId) {
  const all = [];
  for (let pg = 1; pg <= 40; pg++) {
    const r = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {});
    if (!r?.data?.length) break;
    all.push(...r.data);
    if (r.data.length < 200) break;
  }

  // All FreeSpin promos, optionally skip TEST_ codes
  const fsPromos = all.filter((p) =>
    p.PromotionType === 'FreeSpin' &&
    (SHOW_ALL || !/^TEST[_\s]/i.test(p.PromotionCode))
  );

  if (!fsPromos.length) return [];

  const details = await mapLimit(fsPromos, 5, async (p) => {
    try {
      return await igmpPost(siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: p.PromotionId });
    } catch (e) {
      return { _error: String(e.message || e) };
    }
  });

  const rows = [];
  fsPromos.forEach((p, i) => {
    const d = details[i];
    if (!d || d._error) {
      rows.push({ site: siteId, code: p.PromotionCode, status: p.IsActive ? 'Active' : 'Inactive', redemptionType: 'ERR', minDeposit: '-', verdict: 'FETCH_ERROR' });
      return;
    }
    // GetFreeSpinPromotionInfo returns d.data directly (not d.data.Promotion)
    const rew = d?.data?.PromotionRewards?.[0];
    if (!rew) {
      rows.push({ site: siteId, code: p.PromotionCode, status: p.IsActive ? 'Active' : 'Inactive', redemptionType: 'NO_REWARD', minDeposit: '-', verdict: 'NO_REWARD' });
      return;
    }

    // RedemptionType: 0=Deposit, 1=Claim (numeric on this endpoint)
    const rt = Number(rew.RedemptionType ?? -1);
    const minDeposit = Number(rew.MinimumActionAmount ?? 0);
    const redemptionLabel = rt === 0 ? 'Deposit' : rt === 1 ? 'Claim' : `Unknown(${rt})`;

    // Wrong = Claim type but has a deposit requirement
    const verdict = (rt !== 0 && minDeposit > 0) ? '✗ WRONG' : '✓ OK';

    rows.push({ site: siteId, code: p.PromotionCode, status: p.IsActive ? 'Active' : 'Inactive', redemptionType: redemptionLabel, minDeposit: minDeposit || '-', verdict });
  });

  return rows;
}

const sites = listIgmpSites();
console.log(`Probing ${sites.length} IGMP sites for FreeSpin RedemptionType...`);
if (!SHOW_ALL) console.log('(TEST_ codes skipped — use --all to include them)\n');
else console.log('(--all: including TEST_ codes)\n');

const allRows = [];
for (const siteId of sites) {
  process.stdout.write(`  ${siteId.padEnd(14)} `);
  try {
    const rows = await probeSite(siteId);
    console.log(`${rows.length} FS promos`);
    allRows.push(...rows);
  } catch (e) {
    console.log(`SKIP/FAIL  ${String(e.message || e).slice(0, 80)}`);
  }
}

console.log('\n');

if (!allRows.length) {
  console.log('No FreeSpin promos found.');
  process.exit(0);
}

// Group by site for display
const bySite = {};
for (const r of allRows) {
  (bySite[r.site] = bySite[r.site] || []).push(r);
}

for (const [site, rows] of Object.entries(bySite)) {
  console.log(`━━ ${site} (${rows.length}) ━━`);
  console.log('Verdict  Status    RedemptionType  MinDep   Code');
  console.log('─'.repeat(80));
  for (const r of rows) {
    console.log(
      `${r.verdict.padEnd(9)}${r.status.padEnd(10)}${r.redemptionType.padEnd(16)}${String(r.minDeposit).padEnd(9)}${r.code}`
    );
  }
  console.log('');
}

// Summary of wrong ones
const wrong = allRows.filter((r) => r.verdict === '✗ WRONG');
if (!wrong.length) {
  console.log('✓ No wrong RedemptionType found.');
} else {
  console.log(`\n✗ ACTION REQUIRED — ${wrong.length} FS promo(s) have Claim instead of Deposit:\n`);
  for (const r of wrong) {
    console.log(`  [${r.status}] ${r.site}  ${r.code}  (minDep=${r.minDeposit})`);
  }
  console.log('\nDeactivate each on BO and replace with a new code (new codes will auto-set Deposit).');
}
