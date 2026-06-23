#!/usr/bin/env node
// For each today's promo, audit promotioncurrency + promotionname rows.
// Add what's missing so each locale's name row attaches to its proper
// currency_id (MY→MYR/1, SG→SGD/3, ID→IDR/4). Existing MYR-only name rows
// for SG/ID locales are left in place (BO accepts duplicate locale+currency
// per probe 2026-05-17) — operator can prune the orphan MYR rows later.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';

const codes = [
  { code: 'TEST_22FS_GOO_20X',         handle: 'P067-r68', bonus: 'free spin'   },
  { code: 'TEST_88FS_GOO_20X_V5',      handle: 'P068-r69', bonus: 'free spin'   },
  { code: 'TEST_SIL_REL_50PCT_3X',     handle: 'P069-r70', bonus: 'deposit'     },
  { code: 'TEST_GLD_10FC_5X',          handle: 'P070-r71', bonus: 'free credit' },
];
const qproSites = ['qpro1','qpro2','qpro3','qpro4','qpro5','qpro6','qpro7','qpro8','qpro9','qpro10','qpro11','qpro12','qpro13','qpro14','qpro15','qpro16','qpro17'];
const CURRENCY_TO_ID = { MYR: '1', SGD: '3', IDR: '4' };
const ID_TO_CURRENCY = Object.fromEntries(Object.entries(CURRENCY_TO_ID).map(([k,v]) => [String(v), k]));
const LOCALE_TO_ID = { MY_EN: 1, MY_ZH: 3, SG_EN: 6, SG_ZH: 7, ID_EN: 8, ID_ID: 9 };
const REGION_TO_CCY = { MY: 'MYR', SG: 'SGD', ID: 'IDR' };
const commit = process.argv.includes('--commit');

function depositCurrencyBody(resolved, currencyLabel, promoTypeInt) {
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
    promo_type: promoTypeInt,
    currency: currencyLabel,
    current_players: 0,
    used_budget: 0,
  };
}
function fcCurrencyBody(resolved, currencyLabel, promoTypeInt) {
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
    promo_type: promoTypeInt,
    currency: currencyLabel,
    current_players: 0,
    used_budget: 0,
  };
}
function fsCurrencyBody(resolved, currencyLabel, promoTypeInt) {
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
    promo_type: promoTypeInt,
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

async function getCurrencyRows(siteId, promoId) {
  const r = await authedFetch(siteId, `/api/bo/promotioncurrency?promotion_id=${promoId}&perPage=20`);
  return r.data?.rows || [];
}

async function getNameRows(siteId, promoId) {
  const r = await authedFetch(siteId, `/api/bo/promotionname?promotion_id=${promoId}&perPage=50`);
  return r.data?.rows || [];
}

for (const { code, handle, bonus } of codes) {
  const resolved = JSON.parse(fs.readFileSync(`captures/requests/${handle}.json`, 'utf8'));
  const promoTypeInt = bonus === 'free spin' ? 4 : (bonus === 'free credit' ? 3 : 2);
  const curBuilder = bonus === 'free spin' ? fsCurrencyBody : (bonus === 'free credit' ? fcCurrencyBody : depositCurrencyBody);

  for (const siteId of [...qproSites, 'ibc22']) {
    const found = await findPromo(siteId, code);
    if (!found) continue;
    const promoId = found.id;
    const site = getSite(siteId);
    const log = [];

    // 1. Audit currency rows. POST any missing.
    const curRows = await getCurrencyRows(siteId, promoId);
    const haveCcyIds = new Set(curRows.map((pc) => String(pc.settings_currency_id)));
    const wantCcyIds = new Set((resolved.currencies || []).map((c) => CURRENCY_TO_ID[c]).filter(Boolean));
    const missingCcyIds = [...wantCcyIds].filter((id) => !haveCcyIds.has(id));
    // For QP2 use the mapper's full per-currency builder (has the extra
    // fields the QP2 BO requires: reset, bonus_type, start/end_time, etc.).
    // For QPRO continue with the simple builder.
    let qp2Builders = null;
    if (siteId === 'ibc22') {
      const merchantIds = (found.merchant_ids || []).map((m) => m.id || m);
      const plan = await buildQp2Plan(resolved, { brand: 'QP2A', site, merchantIds });
      // The plan.promotion.promotion_currency is keyed by index. Build a
      // currency_id → block map so we can look up by missing currency.
      qp2Builders = {};
      for (const block of Object.values(plan.promotion.promotion_currency || {})) {
        qp2Builders[String(block.currency_id)] = block;
      }
    }
    for (const id of missingCcyIds) {
      const ccy = ID_TO_CURRENCY[id];
      if (!ccy) continue;
      const block = siteId === 'ibc22' ? qp2Builders?.[id] : curBuilder(resolved, ccy, promoTypeInt);
      if (!block) { log.push(`?ccy ${ccy} (no block)`); continue; }
      const body = { promotion_id: promoId, ...block };
      // QP2 standalone POST /promotioncurrency rejects max_total_*=0 with
      // "must be > 0" but accepts null. (PUT /promotion/{id} promotion_currency
      // accepts 0 but rejects null. The two endpoints validate differently.)
      if (siteId === 'ibc22') {
        body.max_total_applications = null;
        body.max_total_bonus = null;
        // FC validator wants max_bonus to be a number (0 ok). Deposit & FS
        // need max_withdraw > 0 → null for unlimited. max_balance_claim
        // also wants a number (0 ok on FC).
        if (bonus === 'free credit') {
          // leave max_bonus = 0 (number)
          if (body.max_withdraw === 0) body.max_withdraw = null;
        } else if (bonus === 'deposit') {
          if (body.max_withdraw === 0) body.max_withdraw = null;
        }
      }
      if (commit) {
        try { await authedFetch(site, '/api/bo/promotioncurrency', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
              log.push(`+ccy ${ccy}`);
        } catch (e) { log.push(`!ccy ${ccy} (${(e.message||'').split('\n')[1]?.trim().slice(0,60) || ''})`); }
      } else log.push(`?ccy ${ccy}`);
    }

    // 2. Audit name rows. For each locale, POST a row tied to its region's currency_id if missing.
    const nameRows = await getNameRows(siteId, promoId);
    const existingKey = new Set(nameRows.map((n) => `${n.settings_locale_id||n.locale_id}:${n.settings_currency_id||n.currency_id}`));
    for (const locale of resolved.locales || []) {
      const region = (locale.match(/^([A-Z]{2})_/) || [])[1];
      const ccyLabel = REGION_TO_CCY[region] || 'MYR';
      const ccyId = CURRENCY_TO_ID[ccyLabel] || '1';
      const localeId = LOCALE_TO_ID[locale];
      if (!localeId) continue;
      const key = `${localeId}:${ccyId}`;
      if (existingKey.has(key)) continue;
      const isEn = locale.endsWith('_EN');
      const isZh = locale.endsWith('_ZH') || locale.endsWith('_ID');
      const name = isEn
        ? (resolved.promotion_name_en || resolved.promo_code)
        : isZh
          ? (resolved.promotion_name_zh_id || resolved.promotion_name_en || resolved.promo_code)
          : (resolved.promotion_name_en || resolved.promo_code);
      const body = {
        promotion_id: promoId,
        currency_id: ccyId,
        settings_locale_id: String(localeId),
        promotion_name: name,
        rewards_name: name,
      };
      if (commit) {
        try { await authedFetch(site, '/api/bo/promotionname', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
              log.push(`+name ${locale}/${ccyLabel}`);
        } catch (e) { log.push(`!name ${locale}/${ccyLabel} (${(e.message||'').split('\n')[1]?.trim().slice(0,60) || ''})`); }
      } else log.push(`?name ${locale}/${ccyLabel}`);
    }

    const haveLabels = [...haveCcyIds].map((id) => ID_TO_CURRENCY[id] || id).join('/');
    const summary = log.length ? log.join(', ') : 'all present';
    console.log(`${siteId.padEnd(8)} ${code.padEnd(28)} id=${promoId} had-ccy=[${haveLabels}] → ${summary}`);
  }
}
console.log('');
console.log('Done.');
