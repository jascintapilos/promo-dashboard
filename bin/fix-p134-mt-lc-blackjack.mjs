// Fix MT bodies for P134 on QP2A and QPRO8.
//
// The original commit saved MTs without the Blackjack exclusion clause in
// T&C item 4. The current renderer correctly produces "Live Casino categories
// are eligible for this promotion except Blackjack." — this script re-renders
// the MT and PUTs the corrected body to both existing template IDs.
//
// Usage:
//   node bin/fix-p134-mt-lc-blackjack.mjs             # dry run (prints bodies)
//   node bin/fix-p134-mt-lc-blackjack.mjs --commit    # live PUT

import { authedFetch } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { buildApiPlan as buildApiPlanQpro } from '../src/api-mapper-qpro.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute live PUTs\n');

const TARGETS = [
  { siteId: 'qp2a',  brand: 'QP2A',  platform: 'qp2',  mtId: 1199, buildPlan: buildApiPlan },
  { siteId: 'qpro8', brand: 'QPRO8', platform: 'qpro', mtId: 639,  buildPlan: buildApiPlanQpro },
];

const fixture = JSON.parse(readFileSync('./captures/requests/P134-r135.json', 'utf8'));

for (const { siteId, brand, platform, mtId, buildPlan } of TARGETS) {
  console.log(`\n=== ${siteId.toUpperCase()} (MT id=${mtId}) ===`);
  const site = getSite(siteId);

  // 1. GET current MT to preserve name/section/type/status/code
  const getRes = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
  const current = getRes?.data?.message_template;
  if (!current) {
    console.log(`  ✗ GET /api/bo/messagetemplate/${mtId} returned nothing — skip`);
    console.log(`  raw: ${JSON.stringify(getRes).slice(0, 200)}`);
    continue;
  }
  console.log(`  current name: "${current.name}"  code: "${current.code}"`);

  // 2. Build plan to get re-rendered MT details (with Blackjack exclusion)
  const plan = await buildPlan(fixture, { brand, site });
  if (!plan?.messageTemplate?.details) {
    console.log(`  ✗ buildApiPlan did not produce messageTemplate.details — check fixture`);
    continue;
  }
  const locales = Object.keys(plan.messageTemplate.details);
  console.log(`  re-rendered locales: ${locales.join(', ')}`);

  // 3. Verify the fix is present in locale '1' (MY_EN)
  const enBody = plan.messageTemplate.details['1']?.message || '';
  const hasBlackjack = enBody.includes('Blackjack');
  const isLcOnly = enBody.includes('Live Casino');
  console.log(`  EN clause check → Live Casino: ${isLcOnly}, Blackjack exclusion: ${hasBlackjack}`);
  if (!hasBlackjack || !isLcOnly) {
    console.log(`  ✗ Blackjack exclusion not found in re-rendered body — aborting`);
    continue;
  }

  if (DRY_RUN) {
    console.log('\n  [DRY RUN] Would PUT the following details:');
    for (const [key, detail] of Object.entries(plan.messageTemplate.details)) {
      const snippet = (detail.message || '').slice(0, 200).replace(/\s+/g, ' ');
      console.log(`    locale key ${key}: subject="${detail.subject}" body="${snippet}..."`);
    }
    console.log(`\n  Run with --commit to apply.`);
    continue;
  }

  // 4. PUT corrected MT body, preserving all non-body fields from current
  const putBody = {
    name:    current.name,
    section: current.section,
    type:    current.type,
    status:  current.status,
    details: plan.messageTemplate.details,
  };
  const putRes = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`, {
    method: 'PUT',
    body: putBody,
  });
  if (putRes?.success === true) {
    console.log(`  ✓ PUT /api/bo/messagetemplate/${mtId} — MT updated`);
  } else {
    console.log(`  ✗ PUT failed: ${JSON.stringify(putRes).slice(0, 300)}`);
  }
}

console.log('\nDone.');
