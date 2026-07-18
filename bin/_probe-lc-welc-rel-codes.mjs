#!/usr/bin/env node
// Probe WELC source codes + REL target codes across QPRO1-17 and QP2 merchants.
import { getSite } from '../src/sites.js';
import { findPromotionByCode } from '../src/api-client.js';

const CODES = [
  'ACQ_WELC_120PCT_12X_LC', 'ACQ_WELC_150PCT_12X_LC', 'ACQ_WELC_180PCT_12X_LC',
  'ACQ_REL_120PCT_12X_LC', 'ACQ_REL_150PCT_12X_LC', 'ACQ_REL_180PCT_12X_LC',
];

async function probe(siteId, label, opts = {}) {
  const site = getSite(siteId);
  const results = {};
  for (const code of CODES) {
    try {
      const match = await findPromotionByCode(site, code, { merchantId: opts.merchantId });
      results[code] = match
        ? { found: true, id: match.id, status: match.status === 1 ? 'Active' : 'Inactive' }
        : { found: false };
    } catch (e) {
      results[code] = { found: null, error: e.message.split('\n')[0] };
    }
  }
  return { label, results };
}

const jobs = [];
for (let i = 1; i <= 17; i++) jobs.push(probe(`qpro${i}`, `QPRO${i}`));
jobs.push(probe('ibc22', 'QP2A (IBC22)', { merchantId: 1 }));
jobs.push(probe('ibc22', 'QP2B (KING333)', { merchantId: 2 }));
jobs.push(probe('ibc22', 'QP2C (ACE66)', { merchantId: 3 }));
jobs.push(probe('ibc22', 'QP2D (SPADE66)', { merchantId: 4 }));

const out = await Promise.all(jobs);
for (const { label, results } of out) {
  const hits = Object.entries(results).filter(([, r]) => r.found || r.found === null);
  if (!hits.length) continue;
  console.log(label);
  for (const [code, r] of hits) {
    console.log('  ' + code + ' -> ' + (r.found ? `FOUND id=${r.id} ${r.status}` : `ERROR ${r.error}`));
  }
}
console.log('--- probe complete ---');
