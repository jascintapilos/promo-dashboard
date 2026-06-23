// Two fixes for P128-P133 on QPRO1:
//   1. Create dialog popups + link to all 6 promos (dialog=0 currently)
//   2. DELETE the MYR currency row from P128-P131 (already status=0 but
//      row still visible; user confirmed SGD-only scope)
//
// NOTE: Cannot use PUT with promotion_currency to drop MYR — that
// silently soft-deletes the SGD row too (verified 2026-05-18). DELETE on
// the currency row ID is the safe path.
//
// Usage:
//   node bin/fix-p128-p133-dialog-myr.mjs          # dry run
//   node bin/fix-p128-p133-dialog-myr.mjs --commit  # live

import { readFileSync } from 'fs';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const s    = getSite('qpro1');
const BRAND = 'QPRO1';

const ROWS = [
  { rn:'P128', handle:'P128-r129', promoId:788,  mtId:820, myrCurrencyId:1744 },
  { rn:'P129', handle:'P129-r130', promoId:789,  mtId:821, myrCurrencyId:1747 },
  { rn:'P130', handle:'P130-r131', promoId:790,  mtId:816, myrCurrencyId:1748 },
  { rn:'P131', handle:'P131-r132', promoId:791,  mtId:817, myrCurrencyId:1751 },
  { rn:'P132', handle:'P132-r133', promoId:812,  mtId:836, myrCurrencyId:null },
  { rn:'P133', handle:'P133-r134', promoId:813,  mtId:837, myrCurrencyId:null },
];

function toMysql(iso) {
  if (!iso) return iso;
  return String(iso).replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
}

let dialogOk = 0, dialogErr = 0, myrOk = 0, myrErr = 0;

for (const row of ROWS) {
  console.log(`\n── ${row.rn} (promo_id=${row.promoId}) ──`);

  const rec = JSON.parse(readFileSync(`captures/requests/${row.handle}.json`));
  const plan = await buildApiPlan(rec, { brand: BRAND, site: s });

  // ── 1. Dialog popup ────────────────────────────────────────────────────
  if (!plan.dialogPopup) {
    console.log('  ⚠ no dialogPopup in plan (popup_dialog not true?) — skip');
  } else {
    if (DRY_RUN) {
      const locales = Object.keys(plan.dialogPopup.contents||{});
      console.log(`  [DRY] dialog: POST popup label="${plan.dialogPopup.label}" locales=${locales.join(',')}`);
      console.log(`  [DRY] PUT promo ${row.promoId}: link mt=${row.mtId} + dialog`);
      dialogOk++;
    } else {
      // POST popup
      let dialogPopup;
      try {
        const r = await authedFetch(s, '/api/bo/popups', { method: 'POST', body: plan.dialogPopup });
        const rows = r?.data?.rows || r?.data;
        if (!rows?.id) throw new Error(`no id: ${JSON.stringify(r).slice(0, 200)}`);
        dialogPopup = {
          id: rows.id,
          code: rows.code,
          start_date: rows.start_date || plan.dialogPopup.start_date,
          label: plan.dialogPopup.label,
        };
        console.log(`  ✓ dialog POST id=${dialogPopup.id} code=${dialogPopup.code}`);
      } catch (e) {
        console.log(`  ✗ dialog POST failed: ${e.message.slice(0, 150)}`);
        dialogErr++;
        // Still try MYR removal
      }

      if (dialogPopup) {
        // PUT promo to link dialog (+ preserve existing mt)
        const putBody = plan.buildUpdate(row.promoId, row.mtId, dialogPopup);
        try {
          await updatePromotion(s, row.promoId, putBody);
          console.log(`  ✓ PUT linked mt=${row.mtId} dialog=${dialogPopup.id}`);
          dialogOk++;
        } catch (e) {
          console.log(`  ✗ PUT link failed: ${e.message.slice(0, 150)}`);
          dialogErr++;
        }
      }
    }
  }

  // ── 2. MYR currency row removal ────────────────────────────────────────
  if (!row.myrCurrencyId) {
    console.log('  ─ No MYR row to remove');
    continue;
  }

  if (DRY_RUN) {
    console.log(`  [DRY] DELETE /api/bo/promotioncurrency/${row.myrCurrencyId} (MYR, status=0)`);
    myrOk++;
    continue;
  }

  try {
    const r = await authedFetch(s, `/api/bo/promotioncurrency/${row.myrCurrencyId}`, { method: 'DELETE' });
    if (r?.success || r?.status === 'success' || r?.message?.toLowerCase()?.includes('delet') || r === null) {
      console.log(`  ✓ MYR currency row ${row.myrCurrencyId} deleted`);
      myrOk++;
    } else {
      console.log(`  ✗ MYR DELETE unexpected response: ${JSON.stringify(r).slice(0, 150)}`);
      myrErr++;
    }
  } catch (e) {
    console.log(`  ✗ MYR DELETE failed: ${e.message.slice(0, 150)}`);
    myrErr++;
  }
}

console.log(`\nSummary: dialog ${dialogOk} ok / ${dialogErr} err | MYR removal ${myrOk} ok / ${myrErr} err`);
