import { authedFetch } from '../../src/api-client.js';
import { getSite } from '../../src/sites.js';

const site = getSite('ibc22');

// Check SMS message templates matching WHALE_CRM_PROBE
// QP2 sections: 1=Promotion, 2=SMS, 3=? — probe both
for (const section of [1, 2, 3]) {
  const resp = await authedFetch(site, `/api/bo/messagetemplate?section=${section}&perPage=200&page=1`);
  const rows = resp?.data?.rows || [];
  const whale = rows.filter(r => (r.name || '').includes('WHALE_CRM') || (r.code || '').includes('WHALE_CRM'));
  if (whale.length) {
    console.log(`\nSection ${section}: ${whale.length} WHALE_CRM templates`);
    for (const r of whale.slice(0, 5)) {
      console.log(`  id=${r.id}  name="${r.name}"  code="${r.code}"`);
    }
    if (whale.length > 5) console.log(`  ... and ${whale.length - 5} more`);
  }
}

// Also check current SMS MT id on a sample promo (P026/1345)
console.log('\n── Current promo detail sample (P026/1345) ──');
const det = (await authedFetch(site, `/api/bo/promotion/1345`)).data.rows;
console.log(`  message_template_id=${det.message_template_id}  message_template_sms_id=${det.message_template_sms_id}`);
