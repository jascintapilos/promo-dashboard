#!/usr/bin/env node
// Archive QPRO5 id=334 + QPRO9 id=328 (P071 saves that had SGD currency
// row wiped by the QPRO PUT). Re-runs follow via canary-multi-brand on
// the remaining brands.

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { getSite } from '../src/sites.js';

const resolved = JSON.parse(fs.readFileSync('captures/requests/P071-r72.json', 'utf8'));
const targets = [
  { siteId: 'qpro5', brand: 'QPRO5', id: 334 },
  { siteId: 'qpro9', brand: 'QPRO9', id: 328 },
];

for (const t of targets) {
  const site = getSite(t.siteId);
  const before = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
  console.log(`${t.siteId} id=${t.id} code=${before.code} → deactivating + archiving…`);
  const plan = await buildApiPlan(resolved, { brand: t.brand, site });
  const putBody = plan.buildUpdate(t.id, before.message_template_id || 0, null);
  putBody.status = 0;
  await updatePromotion(site, t.id, putBody);
  try {
    await authedFetch(site, `/api/bo/promotion/${t.id}`, { method: 'DELETE' });
    console.log('  ✓ deactivated + archived');
  } catch (e) {
    console.log(`  ⚠ delete: ${(e.message||'').split('\n')[1]?.trim()||'failed'}`);
  }
}
