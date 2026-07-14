// Fix 1: QPRO16 MT 395 — remove WS1 "Refresh button" clause from locale 1
// Fix 2: QP2A promo 1394 promotionname records — rename from QPRO to QP2 name
//   node bin/fix-p065-misc.mjs           # dry-run
//   node bin/fix-p065-misc.mjs --commit  # live

import { authedFetch, updatePromotionName } from '../src/api-client.js';

const DRY_RUN = !process.argv.includes('--commit');
const QP2_NAME = '50 Free Spins (Gates of Olympus)';
const REFRESH_CLAUSE = /<li>Members are advised to use the Refresh button[^<]*<\/li>/gi;

// ── Fix 1: QPRO16 MT ────────────────────────────────────────────────────────
console.log('=== Fix 1: QPRO16 MT 395 — remove Refresh button clause ===');
{
  const r = await authedFetch('qpro16', '/api/bo/messagetemplate/395');
  const mt = r.data.message_template;
  const details = r.data.message_details;

  let anyFixed = false;
  const fixedDetails = {};
  for (const [lid, d] of Object.entries(details)) {
    const orig = d.message || '';
    const fixed = orig.replace(REFRESH_CLAUSE, '');
    if (fixed !== orig) { anyFixed = true; console.log('locale', lid, ': clause removed'); }
    fixedDetails[lid] = { settings_locale_id: d.settings_locale_id, subject: d.subject, message: fixed };
  }

  if (!anyFixed) {
    console.log('No Refresh clause found — already clean.');
  } else if (DRY_RUN) {
    console.log('[DRY RUN] would PUT /api/bo/messagetemplate/395');
  } else {
    const res = await authedFetch('qpro16', '/api/bo/messagetemplate/395', {
      method: 'PUT',
      body: { name: mt.name, section: mt.section, type: mt.type, status: mt.status, details: fixedDetails },
    });
    console.log('✓ MT 395 updated:', JSON.stringify(res).substring(0, 80));
  }
}

// ── Fix 2: QP2A promotionname records ────────────────────────────────────────
console.log('\n=== Fix 2: QP2A promo 1394 — rename all 4 promotionname records ===');
{
  const PROMO_ID = 1394;
  const pn = await authedFetch('ibc22', `/api/bo/promotionname?promotion_id=${PROMO_ID}`);
  const names = pn.data.rows;

  for (const n of names) {
    const { promotion_name_id, settings_locale_id, currency_id, promotion_name } = n;
    if (promotion_name === QP2_NAME) {
      console.log('id=' + promotion_name_id + ' locale=' + n.locale + ': already correct — skipping');
      continue;
    }
    if (DRY_RUN) {
      console.log('[DRY RUN] id=' + promotion_name_id + ' locale=' + n.locale + ': "' + promotion_name.substring(0,50) + '" → "' + QP2_NAME + '"');
      continue;
    }
    try {
      const res = await updatePromotionName('ibc22', promotion_name_id, {
        promotion_id: PROMO_ID,
        currency_id,
        settings_locale_id,
        promotion_name: QP2_NAME,
        rewards_name: QP2_NAME,
      });
      console.log('✓ id=' + promotion_name_id + ' locale=' + n.locale + ': updated');
    } catch (e) {
      console.error('✗ id=' + promotion_name_id + ': PUT failed — ' + e.message.split('\n')[0]);
    }
  }
}

console.log(DRY_RUN ? '\n[DRY RUN] Re-run with --commit to apply.' : '\nDone.');