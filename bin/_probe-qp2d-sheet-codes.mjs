// Parallel BO probe for the QP2D Promo Codes sheet.
// For each unique source code, probes 9 BOs (QP2D source + 6 QPRO targets
// + WS1 MY + WS1 SG) and captures heavy mechanics:
//   - existence + promotion_id + status
//   - bonus_rate, min_deposit, max_bonus, to_multiplier, free_credit_amount
//   - promotion_category_turnover (ids → names), game_provider_ids count
//   - currency rows count, locale-name rows count
//
// Run: node bin/_probe-qp2d-sheet-codes.mjs [--concurrency=20]

import fs from 'node:fs';
import { authedFetch, findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { igmpPost } from '../src/igmp-client.js';

const concArg = process.argv.find(a => a.startsWith('--concurrency='));
const CONCURRENCY = concArg ? Number(concArg.split('=')[1]) : 20;

const { uniqueCodes } = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sheet-cellmap.json', 'utf8'));

const QPRO_TARGETS = [
  { key: 'QP2D',  site: 'ibc22',  merchantId: 4 },
  { key: 'QPRO2', site: 'qpro2'  },
  { key: 'QPRO3', site: 'qpro3'  },
  { key: 'QPRO4', site: 'qpro4'  },
  { key: 'QPRO6', site: 'qpro6'  },
  { key: 'QPRO8', site: 'qpro8'  },
  { key: 'QPRO10', site: 'qpro10' },
];
const WS1_TARGETS = [
  { key: 'WS1_MY', site: 'ws1-v3-my' },
  { key: 'WS1_SG', site: 'ws1-v3-sg' },
];

// Returns mechanics record for a code on a QPRO/QP2 site (heavy).
async function probeQpro(target, code) {
  const site = getSite(target.site);
  try {
    // listing endpoint returns dialog_popup_list, message_template_id, promotion_currency, target[].multiplier, etc.
    const params = new URLSearchParams({ perPage: '5', page: '1', code });
    if (target.merchantId != null) params.set('merchant_id', String(target.merchantId));
    const r = await authedFetch(site, `/api/bo/promotion?${params}`);
    const rows = r?.data?.rows || [];
    const row = rows.find(x => x.code === code);
    if (!row) return { key: target.key, present: false };
    // Heavy: pull currency + names separately.
    const [c, n] = await Promise.all([
      authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${row.id}`),
      authedFetch(site, `/api/bo/promotionname?promotion_id=${row.id}`),
    ]);
    const currencies = c?.data?.rows || [];
    const names = n?.data?.rows || [];
    const firstCurr = currencies[0] || {};
    return {
      key: target.key,
      present: true,
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      message_template_id: row.message_template_id,
      popup_count: Array.isArray(row.dialog_popup_list) ? row.dialog_popup_list.length : 0,
      bonus_rate: row.bonus_rate != null ? Number(row.bonus_rate) : null,
      to_multiplier: row.target?.[0]?.multiplier ?? null,
      promo_type: row.promo_type,
      promo_sub_type: row.promo_sub_type,
      categories_count: Array.isArray(row.promotion_category) ? row.promotion_category.length : 0,
      game_providers_count: Array.isArray(row.game_provider) ? row.game_provider.length : 0,
      currency_count: currencies.length,
      currencies: currencies.map(cc => cc.currency).sort(),
      min_deposit: firstCurr.min_transfer != null ? Number(firstCurr.min_transfer) : null,
      max_bonus: firstCurr.max_bonus != null ? Number(firstCurr.max_bonus) : null,
      free_credit_amount: firstCurr.free_credit_amount != null ? Number(firstCurr.free_credit_amount) : null,
      name_count: names.length,
      locales: [...new Set(names.map(nn => nn.locale).filter(Boolean))].sort(),
    };
  } catch (e) {
    return { key: target.key, present: false, error: e.message };
  }
}

// IGMP /PM/GetPromotionInfoByCode returns the full record in one call.
// For WS1 the code is auto-prefixed with FT_ if missing.
async function probeWs1(target, code) {
  const candidates = code.startsWith('FT_') ? [code] : [`FT_${code}`, code];
  for (const candidate of candidates) {
    try {
      const r = await igmpPost(target.site, '/PM/GetPromotionInfoByCode', { PromotionCode: candidate });
      const data = r?.data;
      if (data && data.PromotionId != null) {
        return {
          key: target.key,
          present: true,
          id: data.PromotionId,
          code: data.PromotionCode,
          name: data.PromotionName,
          status: data.IsActive ? 1 : 0,
          promo_type: data.PromotionType,
          // IGMP doesn't expose all the rich fields the QPRO API does;
          // we compare what we can (name + active).
        };
      }
    } catch (e) {
      // continue trying other candidate
    }
  }
  return { key: target.key, present: false };
}

async function probeOne(code) {
  const tasks = [
    ...QPRO_TARGETS.map(t => probeQpro(t, code)),
    ...WS1_TARGETS.map(t => probeWs1(t, code)),
  ];
  const results = await Promise.all(tasks);
  const out = { code };
  for (const r of results) out[r.key] = r;
  return out;
}

async function runBatched(items, fn, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
      done++;
      if (done % 5 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

console.log(`Probing ${uniqueCodes.length} codes × 9 BOs (concurrency=${CONCURRENCY}) — ${uniqueCodes.length * 9} probes total`);
const t0 = Date.now();
const results = await runBatched(uniqueCodes, probeOne, CONCURRENCY);
const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Done in ${dur}s`);

fs.writeFileSync('captures/api-runs/qp2d-sheet-probe.json', JSON.stringify({ generated: new Date().toISOString(), results }, null, 2));
console.log(`Saved → captures/api-runs/qp2d-sheet-probe.json`);

// Quick tally
const tally = {};
for (const r of results) {
  for (const key of [...QPRO_TARGETS, ...WS1_TARGETS].map(t => t.key)) {
    tally[key] = tally[key] || { present: 0, missing: 0 };
    if (r[key]?.present) tally[key].present++;
    else tally[key].missing++;
  }
}
console.log('\nPer-BO existence tally:');
for (const [bo, t] of Object.entries(tally)) {
  console.log(`  ${bo.padEnd(8)} present=${t.present}/${uniqueCodes.length}  missing=${t.missing}`);
}
