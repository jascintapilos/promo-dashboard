#!/usr/bin/env node
// Pull full config of ACQ_WELC_*_12X_LC on QPRO2 (579-581) and QP2 (1400-1402).
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const TARGETS = [
  { siteId: 'qpro2', label: 'QPRO2', ids: [579, 580, 581] },
  { siteId: 'ibc22', label: 'QP2', ids: [1400, 1401, 1402] },
];

for (const t of TARGETS) {
  const site = getSite(t.siteId);
  for (const id of t.ids) {
    const det = await authedFetch(site, `/api/bo/promotion/${id}`);
    const d = det?.data?.rows || det?.data || det;
    const cur = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${id}`);
    const rows = cur?.data?.rows || [];
    console.log(`\n=== ${t.label} #${id} ${d.code || d.promo_code || ''} ===`);
    const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
    console.log('detail:', JSON.stringify(pick(d, [
      'code','name','status','promo_type','sub_type','start_date','end_date',
      'turnover_multiplier','rollover','validity_days','reward_validity_days',
      'valid_days','expired_days','claim_expired_days','game_categories','category_ids',
      'game_provider_ids','blacklist_template_id','merchant_ids','member_group_ids',
      'auto_reward_activation','deposit_status','message_template_id','role_id','roles',
      'apply_limit','apply_limit_type','max_apply','periodic_type','reset_period',
    ])));
    for (const r of rows) {
      console.log('currency:', JSON.stringify(pick(r, [
        'currency','bonus_type','bonus_rate','bonus_amount','min_deposit','min_transfer',
        'max_bonus','min_bonus','max_withdraw','max_withdraw_type','rounds','threshold',
        'max_total_applications','max_total_bonus','amount_per_line','lines',
      ])));
    }
  }
}
