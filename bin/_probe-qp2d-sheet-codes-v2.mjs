// V2: normalized mechanics extraction per-currency, then per-(code, currency)
// comparison across BOs. Handles QPRO (top-level bonus_rate + target.min_transfer)
// vs QP2D (per-currency bonus_rate + min_deposit) differences.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { igmpPost } from '../src/igmp-client.js';

const concArg = process.argv.find(a => a.startsWith('--concurrency='));
const CONCURRENCY = concArg ? Number(concArg.split('=')[1]) : 20;

const { uniqueCodes } = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sheet-cellmap.json', 'utf8'));

const QPRO_TARGETS = [
  { key: 'QP2D',  site: 'ibc22',  merchantId: 4, platform: 'qp2'  },
  { key: 'QPRO2', site: 'qpro2',  platform: 'qpro' },
  { key: 'QPRO3', site: 'qpro3',  platform: 'qpro' },
  { key: 'QPRO4', site: 'qpro4',  platform: 'qpro' },
  { key: 'QPRO6', site: 'qpro6',  platform: 'qpro' },
  { key: 'QPRO8', site: 'qpro8',  platform: 'qpro' },
  { key: 'QPRO10', site: 'qpro10', platform: 'qpro' },
];

const WS1_TARGETS = [
  { key: 'WS1_MY', site: 'ws1-v3-my' },
  { key: 'WS1_SG', site: 'ws1-v3-sg' },
];

function nz(v) { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

async function probeQpro(target, code) {
  const site = getSite(target.site);
  try {
    const params = new URLSearchParams({ perPage: '5', page: '1', code });
    if (target.merchantId != null) params.set('merchant_id', String(target.merchantId));
    const r = await authedFetch(site, `/api/bo/promotion?${params}`);
    const row = (r?.data?.rows || []).find(x => x.code === code);
    if (!row) return { key: target.key, present: false };
    const [c, n] = await Promise.all([
      authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${row.id}`),
      authedFetch(site, `/api/bo/promotionname?promotion_id=${row.id}`),
    ]);
    const currencies = c?.data?.rows || [];
    const names = n?.data?.rows || [];

    // Normalize per-currency mechanics. Field locations vary by platform:
    //   QP2: bonus_rate + min_deposit live in promotioncurrency row.
    //   QPRO: bonus_rate is TOP-LEVEL on promotion row; min_deposit lives
    //         in promotioncurrency.min_transfer (not min_deposit).
    // Fetch detail for top-level fields the listing endpoint omits (target).
    const detail = await authedFetch(site, `/api/bo/promotion/${row.id}`);
    const main = detail?.data?.rows || {};
    const topBonusRate = nz(row.bonus_rate) ?? nz(main.bonus_rate);
    const topToMultiplier = nz(main.target?.[0]?.multiplier);
    // Free-credit amount and max_bonus are per-currency on both.
    // min_deposit: QP2 has it explicitly; QPRO uses min_transfer.
    const perCurrency = currencies.map(cc => ({
      currency: cc.currency,
      bonus_rate: nz(cc.bonus_rate) ?? topBonusRate,
      min_deposit: nz(cc.min_deposit) ?? nz(cc.min_transfer),
      max_bonus: nz(cc.max_bonus),
      // QPRO stores FC amount as free_credit_amount; QP2 stores it as bonus_amount.
      free_credit_amount: nz(cc.free_credit_amount) ?? nz(cc.bonus_amount),
    }));

    return {
      key: target.key,
      present: true,
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      to_multiplier: topToMultiplier,
      categories_count: Array.isArray(row.promotion_category) ? row.promotion_category.length : 0,
      providers_count: Array.isArray(row.game_provider) ? row.game_provider.length : 0,
      message_template_id: row.message_template_id,
      popup_count: Array.isArray(row.dialog_popup_list) ? row.dialog_popup_list.length : 0,
      per_currency: perCurrency,
      name_count: names.length,
      locales: [...new Set(names.map(nn => nn.locale).filter(Boolean))].sort(),
    };
  } catch (e) {
    return { key: target.key, present: false, error: e.message };
  }
}

async function probeWs1(target, code) {
  const candidates = code.startsWith('FT_') ? [code] : [`FT_${code}`, code];
  for (const candidate of candidates) {
    try {
      const r = await igmpPost(target.site, '/PM/GetPromotionInfoByCode', { PromotionCode: candidate });
      const data = r?.data;
      if (data && data.PromotionId != null) {
        return {
          key: target.key, present: true,
          id: data.PromotionId, code: data.PromotionCode, name: data.PromotionName,
          status: data.IsActive ? 1 : 0,
          promo_type: data.PromotionType,
        };
      }
    } catch {}
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
  let next = 0, done = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
      done++;
      if (done % 10 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

console.log(`Probing ${uniqueCodes.length} codes × 9 BOs (concurrency=${CONCURRENCY})`);
const t0 = Date.now();
const results = await runBatched(uniqueCodes, probeOne, CONCURRENCY);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

fs.writeFileSync('captures/api-runs/qp2d-sheet-probe-v2.json', JSON.stringify({ generated: new Date().toISOString(), results }, null, 2));
console.log(`Saved → captures/api-runs/qp2d-sheet-probe-v2.json`);

// Per-(code, currency) comparison
console.log('\nPer-(code, currency) mechanics comparison:');
const mismatches = [];
const QPRO_BO_KEYS = ['QP2D','QPRO2','QPRO3','QPRO4','QPRO6','QPRO8','QPRO10'];
for (const r of results) {
  const presentBos = QPRO_BO_KEYS.filter(k => r[k]?.present);
  if (presentBos.length < 2) continue;
  // For each currency present in QP2D, compare to other BOs that have it.
  const ref = r.QP2D;
  if (!ref?.present) continue;
  const refCurr = ref.per_currency || [];
  const codeIssues = [];
  for (const refRow of refCurr) {
    const curr = refRow.currency;
    for (const bo of presentBos) {
      if (bo === 'QP2D') continue;
      const boData = r[bo];
      const boRow = (boData.per_currency || []).find(x => x.currency === curr);
      if (!boRow) continue; // brand may not support this currency
      const diffs = [];
      // 0 and null are functionally equivalent for FC/min/max fields
      // (different platforms write the "not applicable" sentinel differently).
      const norm = (v) => (v === 0 || v === null) ? null : v;
      for (const f of ['bonus_rate', 'min_deposit', 'max_bonus', 'free_credit_amount']) {
        const a = norm(refRow[f]), b = norm(boRow[f]);
        if (a == null && b == null) continue;
        if (a !== b) diffs.push(`${f}: ${b} ≠ QP2D:${a}`);
      }
      // Top-level to_multiplier
      if (ref.to_multiplier != null && boData.to_multiplier != null && ref.to_multiplier !== boData.to_multiplier) {
        diffs.push(`to_multiplier: ${boData.to_multiplier} ≠ QP2D:${ref.to_multiplier}`);
      }
      if (diffs.length) codeIssues.push({ bo, currency: curr, diffs });
    }
  }
  if (codeIssues.length) mismatches.push({ code: r.code, issues: codeIssues });
}

console.log(`  Codes with per-currency mismatches: ${mismatches.length}/${results.length}`);
for (const m of mismatches.slice(0, 10)) {
  console.log(`  ${m.code}`);
  for (const i of m.issues) console.log(`    ${i.bo} [${i.currency}]: ${i.diffs.join('; ')}`);
}

fs.writeFileSync('captures/api-runs/qp2d-sheet-mismatches-v2.json', JSON.stringify({ mismatches }, null, 2));
console.log(`\nMismatch report → captures/api-runs/qp2d-sheet-mismatches-v2.json`);
