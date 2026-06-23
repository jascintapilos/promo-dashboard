import { getSite } from '../src/sites.js';
import { authedFetch } from '../src/api-client.js';
const site = getSite('qpro1');
const r = await authedFetch(site, '/api/bo/messagetemplate?code=WELC_188PCT_25X');
const row = r.data?.rows?.[0];
console.log('id:', row?.id, '| locale_ids:', row?.locale_ids);
// Show tail of locale 7 (ZH) message — T&C clauses are at the end
console.log('\nlocale 7 (ZH) tail:\n', row?.message?.slice(-500));
