import { authedFetch, findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const site = getSite('qpro4');
const row = await findPromotionByCode(site, '50FS_5X_001_GOO_WCF');
if (!row) { console.log('not found'); process.exit(); }
console.log('MT id:', row.message_template_id);
const mt = await authedFetch(site, `/api/bo/messagetemplate/${row.message_template_id}`);
for (const r of mt.data?.rows || []) {
  console.log(`\n--- locale ${r.settings_locale_id} ---`);
  console.log('subject:', r.subject);
  console.log('body:', r.body);
}
