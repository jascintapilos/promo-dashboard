#!/usr/bin/env node
// QC the dummy-fc0 clones: read back raw config for QPRO3(507), QPRO4(424),
// and inspect QPRO10's pre-existing dummy-fc0(81) to see if it matches.
import { authedFetch, getAllCategories, getAllGameProviders } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const TARGETS = [
  { brand: 'qpro3', id: 507 },
  { brand: 'qpro4', id: 424 },
  { brand: 'qpro10', id: 81 },
];

for (const { brand, id } of TARGETS) {
  const site = getSite(brand);
  console.log(`\n════ ${brand} (${site.loginMerchantCode}) — promotion id ${id} ════`);
  try {
    const [d, c, n, cats, gps] = await Promise.all([
      authedFetch(site, `/api/bo/promotion/${id}`),
      authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${id}`),
      authedFetch(site, `/api/bo/promotionname?promotion_id=${id}`),
      getAllCategories(site),
      getAllGameProviders(site),
    ]);
    const m = d.data.rows;
    const catName = (cid) => cats.find((x) => x.id === cid)?.name || `?${cid}`;
    const gpName = (gid) => gps.rows.find((x) => x.id === gid)?.name || `?${gid}`;
    const catIds = (m.promotion_category || []).map((x) => x.category_id);
    const tgtGps = (m.target?.[0]?.game_provider_ids) || [];
    console.log(`  code=${m.code}  name="${m.name}"`);
    console.log(`  promo_type=${m.promo_type} (3=FC)  sub_type=${m.promo_sub_type}  status=${m.status}`);
    console.log(`  validity=${m.validity}  reward_validity=${m.reward_validity}  recurring=${m.recurring}  daily_max=${m.daily_max}  max_per_player=${m.max_per_player}`);
    console.log(`  categories=[${catIds.map((x) => `${x}:${catName(x)}`).join(', ')}]`);
    console.log(`  TO target: type=${m.target?.[0]?.type} mult=${m.target?.[0]?.multiplier} providers=[${tgtGps.map((x) => `${x}:${gpName(x)}`).join(', ')}]`);
    console.log(`  kyc(basic/adv/pro)=${m.kyc_basic}/${m.kyc_advanced}/${m.kyc_pro}  eligible_types=${m.eligible_types}  blacklist_id=${m.blacklist_id}  auto_approve=${m.auto_approve}  auto_unlock=${m.auto_unlock}`);
    console.log(`  currencies: ${(c.data.rows || []).map((cc) => `${cc.currency}(fc=${cc.free_credit_amount},maxb=${cc.max_bonus})`).join(', ')}`);
    console.log(`  names: ${(n.data.rows || []).length === 0 ? '(none)' : n.data.rows.map((x) => `${x.locale}:${x.promotion_name}`).join(', ')}`);
  } catch (e) {
    console.log(`  ERROR: ${e.message.slice(0, 200)}`);
  }
}
