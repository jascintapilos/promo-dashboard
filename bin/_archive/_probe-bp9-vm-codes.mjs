#!/usr/bin/env node
// Probe QPRO1 (BP9) for all VM_ + VIP_TRIAL_ codes from the BP9MY request CSV.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODES = [
  // Free Credit 5X
  'VM_FC_10_5X_7D','VM_FC_10_5X_14D','VM_FC_20_5X_7D','VM_FC_20_5X_14D',
  'VM_FC_30_5X_7D','VM_FC_30_5X_14D','VM_FC_50_5X_7D','VM_FC_50_5X_14D',
  'VM_FC_80_5X_7D','VM_FC_80_5X_14D','VM_FC_100_5X_7D','VM_FC_100_5X_14D',
  'VM_FC_150_5X_14D','VM_FC_188_5X_14D','VM_FC_288_5X_14D','VM_FC_388_5X_14D','VM_FC_500_5X_14D',
  // Free Credit 8X
  'VM_FC_10_8X_7D','VM_FC_10_8X_14D','VM_FC_20_8X_7D','VM_FC_20_8X_14D',
  'VM_FC_30_8X_7D','VM_FC_30_8X_14D','VM_FC_50_8X_7D','VM_FC_50_8X_14D',
  'VM_FC_80_8X_7D','VM_FC_80_8X_14D','VM_FC_100_8X_7D','VM_FC_100_8X_14D',
  'VM_FC_150_8X_14D','VM_FC_188_8X_14D','VM_FC_288_8X_14D','VM_FC_388_8X_14D','VM_FC_500_8X_14D',
  // Deposit Match step1
  'VM_DM_100_30_5X_14D','VM_DM_150_50_5X_14D','VM_DM_300_100_5X_14D',
  'VM_DM_500_150_5X_14D','VM_DM_600_200_5X_14D','VM_DM_1000_300_5X_14D',
  'VM_DM_300_100_3X_14D',
  // Deposit Match step2 (2X)
  'VM_DM_100_50_2X_7D','VM_DM_100_50_2X_14D',
  'VM_DM_200_100_2X_7D','VM_DM_200_100_2X_14D',
  'VM_DM_300_150_2X_7D','VM_DM_300_150_2X_14D',
  'VM_DM_500_250_2X_14D','VM_DM_600_300_2X_14D','VM_DM_700_350_2X_14D',
  'VM_DM_800_400_2X_14D','VM_DM_1000_500_2X_14D','VM_DM_2000_1000_2X_14D',
  // Deposit Match step3 (1X)
  'VM_DM_500_350_1X_14D','VM_DM_1000_700_1X_14D','VM_DM_1000_800_1X_14D',
  'VM_DM_1500_1050_1X_14D','VM_DM_2000_1400_1X_14D',
  // Deposit Match step2 high-value (1X tagged step2)
  'VM_DM_1000_500_1X_14D','VM_DM_1500_750_1X_14D','VM_DM_2000_1000_1X_14D',
  'VM_DM_2500_1250_1X_14D','VM_DM_3000_1500_1X_14D','VM_DM_5000_2500_1X_14D',
  // Tier Upgrade markers
  'VIP_TRIAL_BRONZE_UPGRADE','VIP_TRIAL_SILVER_UPGRADE','VIP_TRIAL_GOLD_UPGRADE',
  'VIP_TRIAL_PLATINUM_UPGRADE','VIP_TRIAL_DIAMOND_UPGRADE',
];

const site = getSite('qpro1');

async function check(code) {
  try {
    const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
    const row = (list.data?.rows || []).find(r => r.code === code);
    if (!row) return { found: false };
    return { found: true, id: row.id, status: row.status };
  } catch (e) {
    return { found: false, error: e.message.slice(0, 60) };
  }
}

console.log(`Probing ${CODES.length} codes on QPRO1 (BP9)…\n`);

const results = await Promise.all(CODES.map(async code => ({ code, ...(await check(code)) })));

const existing = results.filter(r => r.found);
const missing  = results.filter(r => !r.found && !r.error);
const errors   = results.filter(r => r.error);

console.log(`── EXISTING (${existing.length}) ──────────────────────────────────`);
for (const r of existing) console.log(`  ✓  ${r.code.padEnd(35)}  id=${r.id}  status=${r.status}`);

console.log(`\n── NOT FOUND / NEW (${missing.length}) ─────────────────────────────`);
for (const r of missing) console.log(`  ✗  ${r.code}`);

if (errors.length) {
  console.log(`\n── ERRORS (${errors.length}) ────────────────────────────────────`);
  for (const r of errors) console.log(`  !  ${r.code.padEnd(35)}  ${r.error}`);
}

console.log(`\nSummary: ${existing.length} exist | ${missing.length} new | ${errors.length} error`);
