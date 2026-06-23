#!/usr/bin/env node
// Re-PUT P074 saves so the corrected min_deposit (100) flows through.
// Bug: parser's min_deposit regex required `:` between label and value, so
// "Min dep = 100" (with `=`) silently parsed as min_deposit=undefined. The
// QP2 mapper then defaulted deposit_status to '1' (None) and emitted
// min_deposit=0 on promotion_currency rows. Parser is fixed — this script
// re-runs the mapper against the now-correct fixture and PUT-updates the
// live promotion record(s) so deposit_status flips to '4' (Last Deposit)
// and the per-currency min_deposit lifts to 100.
//
// Usage: node bin/fix-p074-min-deposit.mjs [--commit]

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const resolved = JSON.parse(fs.readFileSync('captures/requests/P074-r75.json', 'utf8'));
const commit = process.argv.includes('--commit');

// QP2: deposit_status + min_deposit + game_provider_codes (FS PP2-only) all
// need correcting. QPRO: only min_transfer on the promotion_currency row
// (the QPRO mapper already restricts game_provider_ids to the FS provider).
const qp2Targets = [
  { site: 'ibc22', brand: 'QP2B', id: 1181, merchantIds: [2] },
];
const qproTargets = [
  { site: 'qpro7',  brand: 'QPRO7',  id: 341 },
  { site: 'qpro10', brand: 'QPRO10', id: 259 },
];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`FIX P074 min_deposit — ${commit ? 'LIVE' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Fixture min_deposit: ${resolved.parsed?.min_deposit}`);
console.log(`Expected deposit_status after PUT: '4' (Last Deposit)`);

for (const t of qp2Targets) {
  const site = getSite(t.site);
  const lst = await authedFetch(site, `/api/bo/promotion?code=${resolved.promo_code}&perPage=5`);
  const before = (lst.data?.rows || []).find((x) => x.id === t.id);
  console.log(`\n${t.brand} id=${t.id}`);
  console.log(`  before: deposit_status="${before?.deposit_status}"`);

  // Inspect promotion_currency rows
  const pcResp = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${t.id}&perPage=20`);
  const pcRows = pcResp.data?.rows || [];
  console.log(`  before: promotion_currency rows: ${pcRows.length}`);
  pcRows.forEach((r) => {
    console.log(`    - id=${r.id} currency_id=${r.currency_id} min_deposit=${r.min_deposit}`);
  });

  if (!commit) {
    console.log('  [dry-run] — skipping PUT. Re-run with --commit to apply.');
    continue;
  }

  const plan = await buildQp2Plan(resolved, { brand: t.brand, site, merchantIds: t.merchantIds });
  const detail = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
  const putBody = plan.buildUpdate(t.id, detail.message_template_id || 0, null);
  // Preserve merchant_ids
  const mIdsObj = {};
  t.merchantIds.forEach((id, i) => { mIdsObj[String(i)] = id; });
  putBody.merchant_ids = mIdsObj;
  // Preserve existing popups
  const popupListResp = await authedFetch(site, '/api/bo/popups?perPage=200&page=1&date_type=start_date&sort_by=id&sort_order=desc');
  const allPopups = popupListResp.data?.rows || [];
  const popupRows = (before?.dialog_popup_list || []).map((d) => allPopups.find((p) => p.id === d.popup_id)).filter(Boolean);
  if (popupRows.length) {
    const dl = {};
    popupRows.forEach((p, i) => { dl[String(i)] = { ...p, promotion_id: t.id }; });
    putBody.dialog_popup_list = dl;
  }
  await updatePromotion(site, t.id, putBody);

  // PUT /api/bo/promotion only refreshes the main record. promotion_currency
  // rows live as separate records keyed by id — update each one with the new
  // min_deposit value. Body shape mirrors what the mapper would POST, with
  // the row's id merged in so PUT routes to the right record.
  for (const row of pcRows) {
    // API responses use `settings_currency_id` (NOT `currency_id` which is
    // what the POST body uses). Cross-reference both.
    const currencyId = row.settings_currency_id ?? row.currency_id;
    const currencyLabel = row.currency || (currencyId === 1 ? 'MYR' : currencyId === 3 ? 'SGD' : null);
    if (!currencyLabel) {
      console.log(`    ! skipping row id=${row.id} — unable to map currency_id=${currencyId}`);
      continue;
    }
    const newBlock = (() => {
      const block = plan.promotion?.promotion_currency || {};
      return Object.values(block).find((b) => String(b.currency_id) === String(currencyId)) || null;
    })();
    if (!newBlock) {
      console.log(`    ! no mapper block for currency_id=${currencyId}, skipping row id=${row.id}`);
      continue;
    }
    // Standalone PUT /api/bo/promotioncurrency/<id> wants `currency_id`,
    // not `settings_currency_id` (which is what GET returns). max_total_*
    // and max_withdraw stay NULL — BO renders blank=Unlimited (operator rule
    // 2026-05-18). The earlier "must be greater than 0" validator cascade
    // was actually caused by null bonus_type — once bonus_type is set, the
    // other null fields are accepted.
    const putRow = {
      ...row,
      ...newBlock,
      id: row.id,
      promotion_id: t.id,
      currency_id: row.settings_currency_id ?? currencyId,
      max_total_applications: null,
      max_total_bonus: null,
      max_withdraw: null,
      bonus_type: row.bonus_type ?? newBlock.bonus_type ?? 1,
    };
    await authedFetch(site, `/api/bo/promotioncurrency/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(putRow),
    });
    console.log(`    ✓ PUT promotioncurrency/${row.id} min_deposit=${putRow.min_deposit} currency=${currencyLabel}`);
  }

  const lst2 = await authedFetch(site, `/api/bo/promotion?code=${resolved.promo_code}&perPage=5`);
  const after = (lst2.data?.rows || []).find((x) => x.id === t.id);
  console.log(`  after: deposit_status="${after?.deposit_status}"`);
  const pcResp2 = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${t.id}&perPage=20`);
  const pcRows2 = pcResp2.data?.rows || [];
  console.log(`  after: promotion_currency rows: ${pcRows2.length}`);
  pcRows2.forEach((r) => {
    console.log(`    - id=${r.id} currency_id=${r.currency_id} min_deposit=${r.min_deposit}`);
  });
}

// ── QPRO targets ─────────────────────────────────────────────────────────
// QPRO FS uses min_transfer on promotion_currency rows (not min_deposit).
// PUT validator is lenient — just send the row back with currency_id
// aliased from settings_currency_id and min_transfer updated.
for (const t of qproTargets) {
  const site = getSite(t.site);
  console.log(`\n${t.brand} id=${t.id}`);
  const pcResp = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${t.id}&perPage=20`);
  const pcRows = pcResp.data?.rows || [];
  console.log(`  before: promotion_currency rows: ${pcRows.length}`);
  pcRows.forEach((r) => {
    console.log(`    - id=${r.id} currency=${r.currency} min_transfer=${r.min_transfer}`);
  });
  if (!commit) {
    console.log('  [dry-run] — skipping PUT.');
    continue;
  }
  for (const row of pcRows) {
    const body = {
      ...row,
      currency_id: row.settings_currency_id,
      min_transfer: resolved.parsed?.min_deposit ?? 0,
    };
    await authedFetch(site, `/api/bo/promotioncurrency/${row.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    console.log(`    ✓ PUT promotioncurrency/${row.id} min_transfer=${body.min_transfer} currency=${row.currency}`);
  }
  const pcResp2 = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${t.id}&perPage=20`);
  const pcRows2 = pcResp2.data?.rows || [];
  pcRows2.forEach((r) => {
    console.log(`    - id=${r.id} currency=${r.currency} min_transfer=${r.min_transfer}`);
  });
}

console.log('\nDone.');
