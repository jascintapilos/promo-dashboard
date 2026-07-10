#!/usr/bin/env node
// P028-r29: 12 of 15 QPRO brands lost their SGD promotioncurrency row after
// the post-create PUT, despite buildUpdateBody() correctly omitting
// promotion_currency (per project_qpro_put_currency_wipe.md, 2026-05-18 fix).
// POST created both rows (verified via api-run log for QPRO4: ids 971 MYR +
// 972 SGD), but only MYR survives live. Root cause of the PUT-side wipe
// recurring despite the omit-fix is not yet nailed down — this is a
// same-values backfill (SGD uses identical min_deposit/max_bonus as MYR,
// since source.per_currency_overrides={} for P028), safe/additive POST only.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const handle = 'P028-r29';
const resolved = JSON.parse(fs.readFileSync('captures/requests/P028-r29.json', 'utf8'));
const commit = process.argv.includes('--commit');

// site -> promotion_id, from the qc-bundles captured at commit time.
const targets = {
  qpro4: 501, qpro5: 439, qpro6: 481, qpro7: 431, qpro8: 564,
  qpro9: 349, qpro10: 347, qpro11: 204, qpro12: 168, qpro15: 338,
  qpro16: 306, qpro17: 158,
};

const CURRENCY_TO_ID = { MYR: '1', SGD: '3', IDR: '4' };

function bodyForDeposit(promotionId, currencyLabel) {
  const o = resolved.per_currency_overrides?.[currencyLabel] || {};
  const r = resolved.parsed || {};
  return {
    promotion_id: promotionId,
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

async function existingCurrencyIds(siteId, promotionId) {
  const r = await authedFetch(siteId, `/api/bo/promotioncurrency?promotion_id=${promotionId}&perPage=10`);
  return new Set((r.data?.rows || []).map((pc) => Number(pc.settings_currency_id)));
}

for (const [siteId, promotionId] of Object.entries(targets)) {
  const site = getSite(siteId);
  const existing = await existingCurrencyIds(siteId, promotionId);
  const need = resolved.currencies.filter((c) => !existing.has(Number(CURRENCY_TO_ID[c])));
  if (need.length === 0) {
    console.log(`${siteId.padEnd(8)} promo=${promotionId} all present [${[...existing].join(',')}]`);
    continue;
  }
  for (const c of need) {
    const body = bodyForDeposit(promotionId, c);
    if (commit) {
      try {
        await authedFetch(site, '/api/bo/promotioncurrency', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        console.log(`${siteId.padEnd(8)} promo=${promotionId} + created ${c}`);
      } catch (e) {
        console.log(`${siteId.padEnd(8)} promo=${promotionId} ✖ FAIL creating ${c}: ${String(e.message).split('\n')[0]}`);
      }
    } else {
      console.log(`${siteId.padEnd(8)} promo=${promotionId} would create ${c} (dry-run)`);
    }
  }
}
console.log('');
console.log('Done.');
