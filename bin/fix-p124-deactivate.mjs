#!/usr/bin/env node
// Deactivate + archive P124 (REL_BASE_60FS_GOOSS_12X) on QPRO2/3/4.
// The code was registered with wrong promo_sub_type on PP2's side at first
// create; game provider can't update it. Must retire and recreate as _V2.
// Usage: node bin/fix-p124-deactivate.mjs [--commit]

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const TARGETS = [
  { brand: 'QPRO2', siteId: 'qpro2', id: 510 },
  { brand: 'QPRO3', siteId: 'qpro3', id: 533 },
  { brand: 'QPRO4', siteId: 'qpro4', id: 462 },
];

const fixture = JSON.parse(fs.readFileSync('captures/requests/P124-r125.json', 'utf8'));

console.log(`DEACTIVATE P124 (REL_BASE_60FS_GOOSS_12X) — ${commit ? 'LIVE' : 'DRY-RUN'}`);

for (const { brand, siteId, id } of TARGETS) {
  const site = getSite(siteId);
  const before = (await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows;
  console.log(`\n${brand} id=${id}  status=${before.status}  code=${before.code}`);
  if (!commit) {
    console.log(`  [dry-run] would PUT status=0 then DELETE`);
    continue;
  }
  const plan = await buildApiPlan(fixture, { brand, site: siteId });
  const putBody = plan.buildUpdate(id, before.message_template_id || 0, null);
  putBody.status = 0;
  await updatePromotion(site, id, putBody);
  console.log(`  ✓ deactivated (status=0)`);
  try {
    await authedFetch(site, `/api/bo/promotion/${id}`, { method: 'DELETE' });
    console.log(`  ✓ archived (deleted)`);
  } catch (e) {
    console.log(`  ⚠ archive: ${(e.message || '').split('\n')[0]}`);
  }
}

console.log('\nDone.');
