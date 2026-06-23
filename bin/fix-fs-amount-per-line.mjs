// Fix amount_per_line from 0.02 → 0.20 for 6 GOOSS FS codes on QPRO2/3/4.
// PUT /api/bo/promotioncurrency/{id} requires currency_id (= settings_currency_id).
//
// Usage:
//   node bin/fix-fs-amount-per-line.mjs          # dry run
//   node bin/fix-fs-amount-per-line.mjs --commit # live PUT
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const CODES = [
  'WELC_BASE_80FS_GOOSS_20X',
  'WELC_BOOSTER_100FS_GOOSS_25X',
  'REL_BASE_60FS_GOOSS_12X_V2',
  'REL_BOOSTER_80FS_GOOSS_15X',
  'RET_GOOSS_BASE_50FS_10X',
  'RET_GOOSS_BOOST_60FS_12X',
];
const SITES = ['qpro2', 'qpro3', 'qpro4'];
const TARGET_APL = 0.2;

let fixed = 0, skipped = 0, errors = 0;

for (const siteId of SITES) {
  const s = getSite(siteId);
  for (const code of CODES) {
    const r = await authedFetch(s, `/api/bo/promotion?code=${code}&status=1`);
    const promo = r?.data?.rows?.[0];
    if (!promo) { console.log(`${siteId} ${code}: NOT FOUND`); errors++; continue; }

    const cr = await authedFetch(s, `/api/bo/promotioncurrency?promotion_id=${promo.id}`);
    const rows = cr?.data?.rows || [];
    if (!rows.length) { console.log(`${siteId} ${code}: no currency rows`); errors++; continue; }

    for (const cur of rows) {
      const current = Number(cur.amount_per_line);
      console.log(`${siteId} ${code} [cid=${cur.settings_currency_id}]: ${current} → ${TARGET_APL}`);
      if (current === TARGET_APL) { console.log('  already correct, skip'); skipped++; continue; }

      if (DRY_RUN) { skipped++; continue; }

      const putBody = {
        ...cur,
        currency_id: cur.settings_currency_id,  // required by validator
        amount_per_line: TARGET_APL,
      };
      const res = await authedFetch(s, `/api/bo/promotioncurrency/${cur.id}`, { method: 'PUT', body: putBody });
      if (res?.success) { console.log('  ✓ updated'); fixed++; }
      else { console.log(`  ✗ failed: ${JSON.stringify(res)?.slice(0, 150)}`); errors++; }
    }
  }
}

console.log(`\nSummary: ${fixed} fixed, ${skipped} skipped, ${errors} errors`);
