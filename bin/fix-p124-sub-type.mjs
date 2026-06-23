#!/usr/bin/env node
// Fix P124 promo_sub_type from 1 (Welcome) to 2 (Reload) on QPRO2/3/4.
// P124 fixture had bonus_sub_type="Welcome" at save time — code/name are REL_.
// Usage: node bin/fix-p124-sub-type.mjs [--commit]

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

// Fix fixture in memory — bonus_sub_type must be Reload for the mapper to emit promo_sub_type=2
const fixture = JSON.parse(fs.readFileSync('captures/requests/P124-r125.json', 'utf8'));
fixture.bonus_sub_type = 'Reload';

console.log(`FIX P124 promo_sub_type → 2 (Reload) — ${commit ? 'LIVE' : 'DRY-RUN'}`);

for (const { brand, siteId, id } of TARGETS) {
  const site = getSite(siteId);
  const before = (await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows;
  console.log(`\n${brand} id=${id}  before: promo_sub_type=${before.promo_sub_type}`);
  if (!commit) {
    console.log(`  [dry-run] would PUT promo_sub_type=2`);
    continue;
  }
  const plan = await buildApiPlan(fixture, { brand, site: siteId });
  // No dialog on P124 (confirmed in QC: none expected/linked)
  const putBody = plan.buildUpdate(id, before.message_template_id || 0, null);
  await updatePromotion(site, id, putBody);
  const after = (await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows;
  console.log(`  after:  promo_sub_type=${after.promo_sub_type} ${after.promo_sub_type === 2 ? '✓' : '✗'}`);
}

console.log('\nDone.');
