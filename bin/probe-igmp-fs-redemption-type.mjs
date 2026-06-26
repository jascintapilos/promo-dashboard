#!/usr/bin/env node
// Probe all WS1/WS2 FreeSpin promos created by the bot and flag any whose
// RedemptionType is Claim (1) but MinimumActionAmount > 0 (should be Deposit/0).
//
// Root cause: api-mapper-igmp.js defaulted RedemptionType to 1 (Claim) for all
// FS promos regardless of min_deposit. Fixed 2026-06-26 — but all promos created
// before the fix may be wrong and need to be replaced with new codes.
//
// Usage: node bin/probe-igmp-fs-redemption-type.mjs

import { igmpPost, listIgmpSites } from '../src/igmp-client.js';

const BOT_USERS = ['promo_testbot'];

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

  // Filter: FreeSpin type only (CreatedBy is null for all promos in this BO)
  const fsPromos = all.filter((p) => p.PromotionType === 'FreeSpin');

  if (!fsPromos.length) return [];

  const details = await mapLimit(fsPromos, 5, async (p) => {
    try {
      return await igmpPost(siteId, '/PM/GetFreeSpinPromotionInfo', { PromotionId: p.PromotionId });
    } catch (e) {
      return { _error: String(e.message || e) };
    }
  });

  const wrong = [];
  fsPromos.forEach((p, i) => {
    const d = details[i];
    if (!d || d._error) {
      wrong.push({ site: siteId, code: p.PromotionCode, name: p.PromotionName, status: p.IsActive ? 'Active' : 'Inactive', verdict: 'FETCH_ERROR', redemptionType: '?', minDeposit: '?' });
      return;
    }
    // GetFreeSpinPromotionInfo returns d.data directly (not d.data.Promotion)
    const promo = d?.data;
    const rew = promo?.PromotionRewards?.[0];
    if (!rew) {
      wrong.push({ site: siteId, code: p.PromotionCode, name: p.PromotionName, status: p.IsActive ? 'Active' : 'Inactive', verdict: 'NO_REWARD', redemptionType: '?', minDeposit: '?' });
      return;
    }

    // RedemptionType: 0=Deposit, 1=Claim (numeric on this endpoint)
    const redemptionType = Number(rew.RedemptionType ?? -1);
    const minDeposit = Number(rew.MinimumActionAmount ?? 0);
    const redemptionLabel = redemptionType === 0 ? 'Deposit' : redemptionType === 1 ? 'Claim' : String(redemptionType);

    // Wrong = Claim type but has a deposit requirement
    if (redemptionType !== 0 && minDeposit > 0) {
      wrong.push({
        site: siteId,
        code: p.PromotionCode,
        name: p.PromotionName,
        status: p.IsActive ? 'Active' : 'Inactive',
        verdict: 'WRONG — should be Deposit',
        redemptionType: redemptionLabel,
        minDeposit,
      });
    }
  });

  return wrong;
}

const sites = listIgmpSites();
console.log(`Probing ${sites.length} IGMP sites for FS RedemptionType issues...\n`);

const allWrong = [];
for (const siteId of sites) {
  process.stdout.write(`  ${siteId.padEnd(14)} `);
  try {
    const wrong = await probeSite(siteId);
    console.log(`${wrong.length} wrong`);
    allWrong.push(...wrong);
  } catch (e) {
    console.log(`SKIP/FAIL  ${String(e.message || e).slice(0, 80)}`);
  }
}

console.log('\n');

if (!allWrong.length) {
  console.log('✓ No FS promos found with wrong RedemptionType.');
} else {
  console.log(`✗ ${allWrong.length} FS promo(s) with wrong RedemptionType (Claim instead of Deposit):\n`);
  console.log('Site            Status    RedemptionType  MinDep   Code');
  console.log('─'.repeat(90));
  for (const r of allWrong) {
    console.log(
      `${r.site.padEnd(16)}${r.status.padEnd(10)}${r.redemptionType.padEnd(16)}${String(r.minDeposit).padEnd(9)}${r.code}`
    );
  }
  console.log('\nAction required: deactivate each listed code on BO and replace with a new code.');
}
