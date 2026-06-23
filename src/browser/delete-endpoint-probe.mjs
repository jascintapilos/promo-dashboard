// Probe whether DELETE is supported on /api/bo/promotion/<id> and
// /api/bo/popups/<id>. Tries the LATEST TEST promo from the multi-brand
// V1 run so we know the target is recent + disposable.

import { getSite } from '../sites.js';
import { authedFetch } from '../api-client.js';

async function probe(siteId, kind, id) {
  const site = getSite(siteId);
  try {
    const r = await authedFetch(site, `/api/bo/${kind}/${id}`, { method: 'DELETE' });
    console.log(`✅ DELETE /api/bo/${kind}/${id} on ${siteId}: OK ${JSON.stringify(r).slice(0, 120)}`);
    return true;
  } catch (e) {
    const m = e.message.match(/HTTP \d+/);
    console.log(`❌ DELETE /api/bo/${kind}/${id} on ${siteId}: ${m?.[0] || 'fail'} ${e.message.split('\n')[0].slice(0, 100)}`);
    return false;
  }
}

console.log('=== Probing DELETE support ===');
console.log('Target: TEST_MULTI_API_V1 — promo 171 + popup 27 on QPRO11; promo 1156 + popup 1075 on QP2A');
console.log('');
// Try in this order: QPRO promo, QPRO popup, QP2 promo, QP2 popup.
await probe('qpro11', 'promotion', 171);
await probe('qpro11', 'popups', 27);
await probe('ibc22', 'promotion', 1156);
await probe('ibc22', 'popups', 1075);
