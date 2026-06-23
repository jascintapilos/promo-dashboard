#!/usr/bin/env node
// READ-ONLY: full snapshot of one promo (detail + currency rows + dialog link)
// so we can diff before/after a PUT. Usage: node bin/_snapshot-promo.mjs <id> <label>
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { writeFileSync } from 'node:fs';

const id = process.argv[2];
const label = process.argv[3] || 'snap';
if (!id) { console.error('usage: _snapshot-promo.mjs <id> [label]'); process.exit(1); }

const site = getSite('ibc22');
const [det, cur] = await Promise.all([
  authedFetch(site, `/api/bo/promotion/${id}`),
  authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${id}`),
]);
const detail = det.data.rows;
const currency = cur.data.rows || [];
// listing row (carries dialog_popup_list, deposit_status string)
const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(detail.code)}&perPage=10`);
const listRow = (list.data.rows || []).find((r) => r.id === Number(id)) || null;

const snap = { id: Number(id), code: detail.code, detail, currency, dialog_popup_list: listRow?.dialog_popup_list || [], listing_deposit_status: listRow?.deposit_status };
const path = `captures/canary-${id}-${label}.json`;
writeFileSync(path, JSON.stringify(snap, null, 2));

console.log(`code=${detail.code}  type=${detail.promo_type}  status=${detail.status}`);
console.log(`auto_reward_activation=${detail.auto_reward_activation}  auto_approve=${detail.auto_approve}`);
console.log(`member_group_ids=${(detail.member_group_ids||[]).length}  promotion_category_ids=${(detail.promotion_category_ids||[]).length}`);
console.log(`target.gpc=${detail.target?.[0]?.game_provider_codes?.length}  blacklist_sub=${(detail.blacklist_sub_categories||[]).length}  promo_linked=${(detail.promo_linked_ids||[]).length}`);
console.log(`dialog_popups=${(listRow?.dialog_popup_list||[]).map(d=>d.popup_id).join(',')||'-'}  deposit_status(list)=${listRow?.deposit_status}`);
console.log(`\ncurrency rows (${currency.length}):`);
for (const c of currency) {
  console.log(`  ${c.currency} id=${c.currency_id} bonus_type=${c.bonus_type} bonus_amount=${c.bonus_amount ?? '-'} bonus_rate=${c.bonus_rate ?? '-'} min_deposit=${c.min_deposit ?? c.min_transfer ?? '-'} max_bonus=${c.max_bonus ?? '-'} rounds=${c.rounds ?? '-'} amount_per_line=${c.amount_per_line ?? '-'} max_withdraw=${c.max_withdraw ?? '-'}`);
}
console.log(`\nsaved → ${path}`);
