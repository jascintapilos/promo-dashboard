#!/usr/bin/env node
// One-off probe: scan every QPRO + QP2 BO for ACTIVE deposit promos and rank
// by aggressiveness across rate%, max cap, TO, and min deposit.
//
// LIST endpoint /api/bo/promotion?status=1 gives a partial row — QPRO list
// has `bonus_rate` but no `target` / `promotion_currency`; QP2 list has
// `target_multiplier` but no `bonus_rate` / `promotion_currency`. So we hit
// the DETAIL endpoint /api/bo/promotion/{id} per row (capped concurrency)
// to assemble the full picture.
//
// Currency ID map (project_bo_currency_id_catalog): MYR=1, SGD=3, IDR=4.

import fs from 'node:fs';
import { authedFetch, getAllPromotions } from '../src/api-client.js';
import { getSite, listSites } from '../src/sites.js';

const CCY_ID_TO_CODE = { 1: 'MYR', 2: '?2', 3: 'SGD', 4: 'IDR', 5: '?5' };
const CONCURRENCY = 16;
const today = new Date();

function isActiveWindow(validFrom, validTo) {
  const start = validFrom ? new Date(validFrom) : null;
  let end = null;
  if (validTo && !String(validTo).startsWith('-')) end = new Date(validTo);
  if (start && start > today) return false;
  if (end && end < today) return false;
  return true;
}

function isTestCode(code, name) {
  if (/^TEST[_-]/i.test(code || '')) return true;
  if (/^DUMMY[_-]/i.test(code || '')) return true;
  if (/\btest\b/i.test(name || '')) return true;
  return false;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function rowsFromDetail(site, listRow, detail, ccyDetail) {
  const main = detail?.data?.rows;
  if (!main) return [];
  const rate = Number(main.bonus_rate ?? listRow.bonus_rate ?? 0);
  const to = Number(main.target?.[0]?.multiplier ?? main.target_multiplier ?? listRow.target_multiplier ?? 0);
  // promotion_currency lives at /api/bo/promotioncurrency?promotion_id=<id> (separate endpoint).
  const ccyArr = ccyDetail?.data?.rows || [];
  // QP2 detail also has merchant_ids; capture so we can attribute to the right merchant.
  const merchantIds = (main.merchant_ids || []).map((m) => m.prefix || m.name).join('|');
  if (!ccyArr.length) {
    return [{
      site: site.id,
      brand: site.loginMerchantCode,
      platform: site.platform,
      merchants: merchantIds || site.loginMerchantCode,
      promo_id: main.id,
      code: main.code,
      name: main.name,
      promo_type: main.promo_type,
      rate_pct: rate,
      to_mult: to,
      ccy: null,
      min_dep: null,
      max_bonus: null,
      max_total_bonus: null,
      max_per_player: main.max_per_player ?? null,
      valid_from: main.valid_from,
      valid_to: main.valid_to,
    }];
  }
  return ccyArr.map((c) => ({
    site: site.id,
    brand: site.loginMerchantCode,
    platform: site.platform,
    merchants: merchantIds || site.loginMerchantCode,
    promo_id: main.id,
    code: main.code,
    name: main.name,
    promo_type: main.promo_type,
    rate_pct: rate,
    to_mult: to,
    // promotioncurrency rows use `currency` (string code) directly.
    ccy: c.currency || CCY_ID_TO_CODE[Number(c.settings_currency_id)] || `id${c.settings_currency_id}`,
    min_dep: Number(c.min_transfer ?? 0),
    max_bonus: Number(c.max_bonus ?? 0),
    max_total_bonus: Number(c.max_total_bonus ?? 0),
    max_per_player: main.max_per_player ?? null,
    valid_from: main.valid_from,
    valid_to: main.valid_to,
  }));
}

async function probeSite(siteId) {
  const site = getSite(siteId);
  const t0 = Date.now();
  try {
    const { rows: listRows } = await getAllPromotions(site, { status: 1, perPage: 200 });
    const deposits = listRows
      .filter((p) => Number(p.promo_type) === 2 && isActiveWindow(p.valid_from, p.valid_to))
      .filter((p) => !isTestCode(p.code, p.name));
    const details = await mapLimit(deposits, CONCURRENCY, async (p) => {
      try {
        const [main, ccy] = await Promise.all([
          authedFetch(site, `/api/bo/promotion/${p.id}`),
          authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${p.id}`),
        ]);
        return { main, ccy };
      } catch (e) {
        return { _error: String(e.message || e) };
      }
    });
    const out = [];
    let failed = 0;
    deposits.forEach((p, i) => {
      const d = details[i];
      if (d?._error) { failed++; return; }
      for (const r of rowsFromDetail(site, p, d.main, d.ccy)) out.push(r);
    });
    return { ok: true, ms: Date.now() - t0, listCount: deposits.length, detailFailed: failed, rows: out };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e.message || e) };
  }
}

async function main() {
  const all = listSites();
  const sites = all.filter((s) => s.platform === 'qpro' || s.id === 'ibc22');

  console.log(`Probing ${sites.length} BOs for active non-TEST deposit promos…\n`);

  const results = {};
  const allRows = [];
  for (const s of sites) {
    process.stdout.write(`  ${s.id.padEnd(8)} ${s.loginMerchantCode.padEnd(10)} `);
    const r = await probeSite(s.id);
    results[s.id] = r;
    if (r.ok) {
      console.log(`${String(r.listCount).padStart(4)} deposits → ${String(r.rows.length).padStart(4)} ccy-rows${r.detailFailed ? `, ${r.detailFailed} detail-fail` : ''}  (${(r.ms / 1000).toFixed(1)}s)`);
      allRows.push(...r.rows);
    } else {
      console.log(`FAIL  (${(r.ms / 1000).toFixed(1)}s)  ${r.error.slice(0, 120)}`);
    }
  }

  fs.mkdirSync('tmp', { recursive: true });
  const dumpPath = 'tmp/aggressive-deposits.json';
  fs.writeFileSync(dumpPath, JSON.stringify({ probedAt: new Date().toISOString(), results, rows: allRows }, null, 2));
  console.log(`\nDumped ${allRows.length} ccy-rows → ${dumpPath}\n`);

  // Reporting helpers ----------------------------------------------------
  function fmt(r) {
    const rate = r.rate_pct ? `${r.rate_pct}%`.padStart(5) : '   - ';
    const to = r.to_mult ? `${r.to_mult}x`.padStart(5) : '   - ';
    const min = (r.min_dep != null && r.min_dep !== 0) ? String(r.min_dep).padStart(7) : '      -';
    const cap = (r.max_bonus != null && r.max_bonus !== 0) ? String(r.max_bonus).padStart(9) : '        -';
    return `${(r.merchants || r.brand).padEnd(8)} ${String(r.ccy || '?').padEnd(3)} rate=${rate}  TO=${to}  min=${min}  cap=${cap}  ${r.code}`;
  }

  function top(label, sorter, take = 12, filter) {
    let pool = allRows.slice();
    if (filter) pool = pool.filter(filter);
    console.log(`── TOP ${take} BY ${label} (${pool.length} eligible) ──`);
    pool.sort(sorter);
    for (const r of pool.slice(0, take)) console.log(`  ${fmt(r)}`);
    console.log('');
  }

  // Filter: must have a non-zero rate AND a non-zero cap for cap/min sorts
  // (otherwise we're ranking placeholder rows).
  const hasNumbers = (r) => (r.rate_pct > 0 || r.to_mult > 0 || r.max_bonus > 0 || r.min_dep > 0);

  top('RATE %', (a, b) => (b.rate_pct || 0) - (a.rate_pct || 0), 15, (r) => r.rate_pct > 0);

  top('MAX BONUS CAP', (a, b) => (b.max_bonus || 0) - (a.max_bonus || 0), 15, (r) => r.max_bonus > 0);

  top('LOWEST TO (TO > 0)', (a, b) => (a.to_mult || 9e9) - (b.to_mult || 9e9), 15, (r) => r.to_mult > 0 && r.rate_pct > 0);

  top('LOWEST MIN DEPOSIT (min > 0)', (a, b) => (a.min_dep || 9e9) - (b.min_dep || 9e9), 15, (r) => r.min_dep > 0 && r.rate_pct > 0);

  // Composite — normalize each axis over the eligible pool, weight equally.
  const pool = allRows.filter((r) => r.rate_pct > 0 && r.max_bonus > 0 && r.to_mult > 0 && r.min_dep > 0);
  const maxRate = Math.max(...pool.map((r) => r.rate_pct));
  const maxCap = Math.max(...pool.map((r) => r.max_bonus));
  const maxTo = Math.max(...pool.map((r) => r.to_mult));
  const maxMin = Math.max(...pool.map((r) => r.min_dep));

  const scored = pool.map((r) => {
    const rateNorm = r.rate_pct / maxRate;
    const capNorm = r.max_bonus / maxCap;
    const toNorm = 1 - (r.to_mult / maxTo);
    const minNorm = 1 - (r.min_dep / maxMin);
    const score = rateNorm + capNorm + toNorm + minNorm;
    return { ...r, score, parts: { rateNorm, capNorm, toNorm, minNorm } };
  }).sort((a, b) => b.score - a.score);

  console.log(`── TOP 20 BY COMPOSITE AGGRESSIVENESS (${pool.length} rows with all 4 fields populated) ──`);
  console.log(`  Composite = rate% / max + cap / max + (1 - TO / max) + (1 - min / max).  Higher = more aggressive.\n`);
  for (const r of scored.slice(0, 20)) {
    console.log(`  ${r.score.toFixed(3)}  ${fmt(r)}`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
