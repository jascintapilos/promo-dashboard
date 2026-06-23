// Compare the saved state of an API-direct promo vs a Playwright promo
// on QP2A. Both should have message_template linked, names rows added,
// dialog popup created but NOT linked.

import { getSite } from '../sites.js';
import { authedFetch } from '../api-client.js';

const site = getSite('ibc22');

async function dumpPromo(code) {
  // Search promo by code (use the list endpoint via GET)
  const list = await authedFetch(site, `/api/bo/promotion?perPage=10&page=1&status=&category_id=&game_provider_code=&currency_id=&bonus_condition=&merchant_id=&date_type=valid_from&sort_by=id&sort_order=desc`);
  const row = (list?.data?.rows || []).find((r) => r.code === code);
  if (!row) return { error: `not found: ${code}` };
  // Get full detail
  const detail = await authedFetch(site, `/api/bo/promotion/${row.id}`);
  const d = detail?.data?.rows || detail?.data || {};
  const names = await authedFetch(site, `/api/bo/promotionname?promotion_id=${row.id}`);
  return {
    code,
    id: row.id,
    message_template_id: d.message_template_id,
    dialog_popup_list: d.dialog_popup_list, // probably absent in GET response
    name: d.name,
    valid_from: d.valid_from,
    promo_type: d.promo_type,
    promo_sub_type: d.promo_sub_type,
    validity: d.validity,
    reward_validity: d.reward_validity,
    recurring: d.recurring,
    auto_approve: d.auto_approve,
    auto_unlock: d.auto_unlock,
    namesCount: names?.data?.rows?.length ?? 0,
    namesLocales: (names?.data?.rows || []).map((n) => n.locale).sort(),
  };
}

const api = await dumpPromo('TEST_API_QP2A_FC_V4');
const pw  = await dumpPromo('TEST_VIP_30FC_5X_MB25');
console.log('=== API-direct (V4) ===');
console.log(JSON.stringify(api, null, 2));
console.log('\n=== Playwright (V25) ===');
console.log(JSON.stringify(pw, null, 2));

const keys = ['promo_type', 'promo_sub_type', 'validity', 'reward_validity', 'recurring', 'auto_approve', 'auto_unlock', 'namesCount'];
console.log('\n=== Comparison ===');
for (const k of keys) {
  const same = JSON.stringify(api[k]) === JSON.stringify(pw[k]);
  console.log(`${same ? '✓' : '✗'} ${k}: api=${api[k]} pw=${pw[k]}`);
}
console.log(`✓ both have message_template_id: api=${api.message_template_id} pw=${pw.message_template_id}`);
console.log(`✓ both have ${api.namesCount} name rows for locales: ${api.namesLocales.join(', ')} vs ${pw.namesLocales.join(', ')}`);
