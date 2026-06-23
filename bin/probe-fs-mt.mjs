// Find FS promos with MTs on QPRO2 and dump one EN+ZH body
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro2');

// List promotions, filter FS (promo_type=4) with a linked MT
// Try status=0 (inactive) as well — archived FS promos may have MTs
const [a, b] = await Promise.all([
  authedFetch(site, '/api/bo/promotion?limit=200&status=1'),
  authedFetch(site, '/api/bo/promotion?limit=200&status=0'),
]);
const rows = [...(a.data?.rows || []), ...(b.data?.rows || [])];
const fsMt = rows.filter(r => r.promo_type == 4 && r.message_template_id > 0);
console.log(`FS promos with MT on QPRO2: ${fsMt.length}`);
if (!fsMt.length) process.exit();

// Take first one and dump MT bodies
const sample = fsMt[0];
console.log(`\nSample: id=${sample.id} code=${sample.code} MT=${sample.message_template_id}`);
const mt = await authedFetch(site, `/api/bo/messagetemplate?promotion_id=${sample.id}`);
const mtRows = mt.data?.rows || [];
console.log('MT rows count:', mtRows.length);
// Print first row raw to understand shape
if (mtRows.length) console.log('First row keys:', JSON.stringify(Object.keys(mtRows[0])));
// Find rows for this specific MT id
const myRows = mtRows.filter(r => r.message_template_id === sample.message_template_id);
console.log('Rows for MT', sample.message_template_id, ':', myRows.length);
if (myRows.length) console.log(JSON.stringify(myRows[0], null, 2));
