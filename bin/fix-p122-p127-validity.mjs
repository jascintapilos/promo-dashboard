// Fix validity / reward_validity on P122-P127 (QPRO2/3/4).
// Original save had validity=30, reward_validity=7 (swapped).
// Correct values: validity=7 (bonus expires 7d after claim), reward_validity=30 (30d to claim).
//
// Usage:
//   node bin/fix-p122-p127-validity.mjs             # dry run
//   node bin/fix-p122-p127-validity.mjs --commit    # live PUT
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const CORRECT_VALIDITY        = 7;   // bonus expires 7d after claim
const CORRECT_REWARD_VALIDITY = 30;  // 30d claim window

const PROMOS = [
  { rn: 'P122', code: 'WELC_BASE_80FS_GOOSS_20X',    fixture: 'P122-r123' },
  { rn: 'P123', code: 'WELC_BOOSTER_100FS_GOOSS_25X', fixture: 'P123-r124' },
  { rn: 'P124', code: 'REL_BASE_60FS_GOOSS_12X_V2',  fixture: 'P124-r125' },
  { rn: 'P125', code: 'REL_BOOSTER_80FS_GOOSS_15X',  fixture: 'P125-r126' },
  { rn: 'P126', code: 'RET_GOOSS_BASE_50FS_10X',      fixture: 'P126-r127' },
  { rn: 'P127', code: 'RET_GOOSS_BOOST_60FS_12X',     fixture: 'P127-r128' },
];

const SITES = ['qpro2', 'qpro3', 'qpro4'];

let fixed = 0, skipped = 0, errors = 0;

for (const { rn, code, fixture: fixtureFile } of PROMOS) {
  const raw = JSON.parse(readFileSync(`./captures/requests/${fixtureFile}.json`, 'utf8'));
  // Inject correct parsed fields (missing from re-ingest) so buildApiPlan works
  const fixture = {
    ...raw,
    parsed: { ...raw.parsed, min_deposit: raw.parsed.min_deposit ?? 0, value_per_spin: 0.02, to_multiplier: raw.parsed.to_multiplier ?? 12 },
  };

  for (const siteId of SITES) {
    const site = getSite(siteId);

    // Lookup promo
    const listRes = await authedFetch(site, `/api/bo/promotion?code=${code}&status=1`);
    const promoRow = (listRes?.data?.rows || []).find(r => r.code === code);
    if (!promoRow) {
      console.log(`${rn} ${siteId}: not found (may be inactive/archived)`);
      skipped++;
      continue;
    }
    const promotionId   = promoRow.id;
    const currentV      = promoRow.validity;
    const currentRV     = promoRow.reward_validity;
    const currentMtId   = promoRow.message_template_id || 0;

    if (currentV === CORRECT_VALIDITY && currentRV === CORRECT_REWARD_VALIDITY) {
      console.log(`${rn} ${siteId} id=${promotionId}: already correct (validity=${currentV}, reward_validity=${currentRV}) — skipped`);
      skipped++;
      continue;
    }
    console.log(`${rn} ${siteId} id=${promotionId}: validity ${currentV}→${CORRECT_VALIDITY}  reward_validity ${currentRV}→${CORRECT_REWARD_VALIDITY}`);

    if (DRY_RUN) continue;

    // Get existing dialog popup (must preserve in PUT)
    const detailRes = await authedFetch(site, `/api/bo/promotion/${promotionId}`);
    const detail = detailRes?.data?.rows;
    const dialogArg = (detail?.dialog_popup_list && Object.keys(detail.dialog_popup_list).length > 0)
      ? detail.dialog_popup_list['0'] : null;

    // Build plan with corrected validity values
    const correctedFixture = { ...fixture, validity_days: CORRECT_VALIDITY, rewards_validity_days: CORRECT_REWARD_VALIDITY };
    const plan = await buildApiPlan(correctedFixture, { brand: siteId, site });
    const putBody = plan.buildUpdate(promotionId, currentMtId, dialogArg);

    const putRes = await updatePromotion(site, promotionId, putBody);
    const ok = putRes?.status === 0 || putRes?.code === 0 || putRes?.data != null;
    if (ok) {
      console.log(`  ✓ fixed`);
      fixed++;
    } else {
      console.log(`  ✗ PUT failed: ${JSON.stringify(putRes).slice(0, 200)}`);
      errors++;
    }
  }
}

console.log(`\nSummary: ${fixed} fixed, ${skipped} skipped, ${errors} errors`);
