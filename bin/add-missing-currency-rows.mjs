#!/usr/bin/env node
// For each today's promo, find currencies in the fixture that AREN'T
// attached as promotioncurrency rows and POST them. PUT only updates
// existing rows on the QPRO + QP2 BOs — new currencies need their own POST.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const codes = [
  { code: 'TEST_22FS_GOO_20X',         handle: 'P067-r68', bonus: 'free spin' },
  { code: 'TEST_88FS_GOO_20X_V5',      handle: 'P068-r69', bonus: 'free spin' },
  { code: 'TEST_SIL_REL_50PCT_3X',     handle: 'P069-r70', bonus: 'deposit' },
  { code: 'TEST_GLD_10FC_5X',          handle: 'P070-r71', bonus: 'free credit' },
];
const qproSites = ['qpro1','qpro2','qpro3','qpro4','qpro5','qpro6','qpro7','qpro8','qpro9','qpro10','qpro11','qpro12','qpro13','qpro14','qpro15','qpro16','qpro17'];
const CURRENCY_TO_ID = { MYR: '1', SGD: '3', IDR: '4' };
const ID_TO_CURRENCY = Object.fromEntries(Object.entries(CURRENCY_TO_ID).map(([k,v]) => [Number(v),k]));
const commit = process.argv.includes('--commit');

function bodyForDeposit(resolved, currencyLabel) {
  const o = resolved.per_currency_overrides?.[currencyLabel] || {};
  const r = resolved.parsed || {};
  return {
    currency_id: CURRENCY_TO_ID[currencyLabel],
    min_transfer: o.min_deposit ?? r.min_deposit ?? 0,
    max_bonus: o.max_bonus ?? r.max_bonus ?? 0,
    max_total_applications: 0,
    max_total_bonus: 0,
    status: '1',
    max_transfer_out: 0,
    promo_type: 2,
    currency: currencyLabel,
    current_players: 0,
    used_budget: 0,
  };
}
function bodyForFC(resolved, currencyLabel) {
  const o = resolved.per_currency_overrides?.[currencyLabel] || {};
  const r = resolved.parsed || {};
  return {
    currency_id: CURRENCY_TO_ID[currencyLabel],
    max_balance_claim: 0,
    max_total_applications: 0,
    max_total_bonus: 0,
    free_credit_amount: o.free_credit_amount ?? r.free_credit_amount ?? 0,
    status: '1',
    max_transfer_out: o.max_transfer_out ?? r.max_transfer_out ?? 0,
    promo_type: 3,
    currency: currencyLabel,
    current_players: 0,
    used_budget: 0,
  };
}
function bodyForFS(resolved, currencyLabel) {
  const o = resolved.per_currency_overrides?.[currencyLabel] || {};
  const r = resolved.parsed || {};
  const spinCount = o.spin_count ?? r.spin_count ?? 0;
  const valuePerSpin = o.value_per_spin ?? r.value_per_spin ?? 0;
  return {
    currency_id: CURRENCY_TO_ID[currencyLabel],
    coins: 1,
    amount_per_line: Number((valuePerSpin / 20).toFixed(4)),
    rounds: spinCount,
    lines: 10,
    min_transfer: o.min_deposit ?? r.min_deposit ?? 0,
    max_total_applications: 0,
    max_total_bonus: 0,
    status: '1',
    max_transfer_out: o.max_transfer_out ?? r.max_transfer_out ?? 0,
    promo_type: 4,
    currency: currencyLabel,
    current_players: 0,
    used_budget: 0,
  };
}

async function findPromo(siteId, code) {
  try {
    const r = await authedFetch(siteId, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
    return (r.data?.rows || []).find((x) => x.code === code) || null;
  } catch { return null; }
}

async function existingCurrencyIds(siteId, promotionId) {
  const r = await authedFetch(siteId, `/api/bo/promotioncurrency?promotion_id=${promotionId}&perPage=10`);
  return new Set((r.data?.rows || []).map((pc) => Number(pc.settings_currency_id)));
}

async function fixPromo(siteId, code, handle, bonus) {
  const site = getSite(siteId);
  const found = await findPromo(siteId, code);
  if (!found) return null;
  const resolved = JSON.parse(fs.readFileSync(`captures/requests/${handle}.json`, 'utf8'));
  // FS may have currency filter — refresh effective currencies from current row's currencies_ids
  // for non-FS, use resolved.currencies
  let targetCurrencies = resolved.currencies || [];
  // Pull existing
  const existing = await existingCurrencyIds(siteId, found.id);
  const missing = targetCurrencies.filter((c) => {
    const id = Number(CURRENCY_TO_ID[c]);
    return id && !existing.has(id);
  });
  if (missing.length === 0) return { id: found.id, status: 'all-present', existing: [...existing] };

  const builder = bonus === 'free spin' ? bodyForFS
                : bonus === 'free credit' ? bodyForFC
                : bodyForDeposit;
  const created = [];
  for (const c of missing) {
    const body = { promotion_id: found.id, ...builder(resolved, c) };
    if (commit) {
      try {
        await authedFetch(site, '/api/bo/promotioncurrency', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        created.push(c);
      } catch (e) {
        created.push(`${c} (FAIL: ${String(e.message).split('\n')[1]?.trim() || ''})`);
      }
    } else {
      created.push(`${c} (would POST)`);
    }
  }
  return { id: found.id, status: 'updated', existing: [...existing], created };
}

for (const { code, handle, bonus } of codes) {
  for (const siteId of [...qproSites, 'ibc22']) {
    const r = await fixPromo(siteId, code, handle, bonus);
    if (!r) continue;
    const existingLabels = r.existing.map((id) => ID_TO_CURRENCY[id] || id).join('/');
    if (r.status === 'all-present') {
      console.log(`${siteId.padEnd(8)} ${code.padEnd(28)} id=${r.id} all present [${existingLabels}]`);
    } else {
      console.log(`${siteId.padEnd(8)} ${code.padEnd(28)} id=${r.id} had [${existingLabels}] → added [${r.created.join(', ')}]`);
    }
  }
}
console.log('');
console.log('Done.');
