import { renderBody } from '../src/message-template-renderer.js';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
// fetch configured promo names
let names = {};
try {
  const nm = await authedFetch(site, `/api/bo/promotion/360/promotionname`);
  const rows = nm?.data?.rows || nm?.data || [];
  for (const r of rows) names[r.settings_locale_id] = r.name;
  console.log('promotionname rows:', JSON.stringify(rows));
} catch (e) { console.log('name err', e.message.split('\n')[0]); }

const resolved = {
  promo_code: 'REL_79FS_GOO_100425',
  validity_days: 7,            // sheet col P = after-claim expiry
  rewards_validity_days: 30,   // sheet col Q = claim window
  per_currency_overrides: { SGD: { min_deposit: 100 } },
  promotion_name_en: names[1] || '79 Free Spins - Gates of Olympus',
  promotion_name_zh_id: names[3] || '79次免费旋转 - Gates of Olympus',
  parsed: {
    min_deposit: 50,
    spin_count: 79,
    game_provider: 'PRAGMATIC PLAY',
    game: 'Gates Of Olympus',
    to_multiplier: 20,
    value_per_spin: 0.20,
    categories: ['Slot'],
  },
};

const LOCALES = [
  ['MY_EN', 1], ['MY_ZH', 3], ['SG_EN', 6], ['SG_ZH', 7],
];
for (const [loc] of LOCALES) {
  const out = await renderBody({ bonusType: 'Free Spin', locale: loc, brand: 'QP2A', platform: 'qp2', resolved });
  console.log(`\n${'='.repeat(70)}\nLOCALE ${loc}  subject="${out.subject}"\n${'='.repeat(70)}`);
  console.log(out.html);
}
