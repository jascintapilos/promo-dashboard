#!/usr/bin/env node
// Retroactively set blacklist_template_id=10 ("Sports and Slots") on QP2
// P083 (id=1242, WEL_WC26_100PCT_50_25x) and P084 (id=1243, WELC_188PCT_25X).
//
// Uses buildApiPlan so promotion_currency is built from fixture, not guessed.
// QP2 PUT must preserve promotion_currency (opposite of QPRO).

import fs from 'fs';
import { getSite } from '../src/sites.js';
import { authedFetch } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qp2.js';

const site = getSite('qp2a');

const JOBS = [
  {
    label: 'P083',
    fixture: 'captures/requests/P083-r84.json',
    promoId: 1242,
    templateId: 1170,
    brand: 'QP2C',
    merchantIds: [3, 4],   // QP2C + QP2D — already live on this promo
  },
  {
    label: 'P084',
    fixture: 'captures/requests/P084-r85.json',
    promoId: 1243,
    templateId: 1171,
    brand: 'QP2D',
    merchantIds: [4],      // QP2D only — as currently saved
  },
];

for (const job of JOBS) {
  console.log(`\n── ${job.label} (promo ${job.promoId}) ──`);
  const resolved = JSON.parse(fs.readFileSync(job.fixture, 'utf8'));

  // buildApiPlan resolves: categories, member groups, blacklist template
  // blacklist_template_id auto-selected via exact set-match on SPORT+SLOTS → id=10
  const plan = await buildApiPlan(resolved, {
    brand: job.brand,
    site,
    merchantIds: job.merchantIds,
  });

  console.log(`  blacklist_template_id resolved: ${plan.blacklistTemplateId}`);

  const putBody = plan.buildUpdate(job.promoId, job.templateId, null);
  // Override merchant_ids — buildUpdateBody only emits one merchant; manually set all
  const merchantIdsObj = {};
  job.merchantIds.forEach((id, i) => { merchantIdsObj[String(i)] = id; });
  putBody.merchant_ids = merchantIdsObj;
  console.log(`  merchant_ids in PUT: ${JSON.stringify(putBody.merchant_ids)}`);

  const res = await authedFetch(site, `/api/bo/promotion/${job.promoId}`, {
    method: 'PUT',
    body: putBody,
  });
  const ok = res?.data?.rows?.id === job.promoId;
  console.log(`  PUT: ${ok ? '✓ success' : '✗ unexpected response'}  ${JSON.stringify(res?.data || res).slice(0, 150)}`);

  // QC
  const verify = await authedFetch(site, `/api/bo/promotion/${job.promoId}`);
  const updated = verify?.data?.rows;
  const bl = updated?.blacklist_template_id;
  const merchants = updated?.merchant_ids?.map((m) => m.id);
  console.log(`  QC blacklist_template_id: ${bl} (expected 10) ${bl === 10 ? '✓' : '✗'}`);
  console.log(`  QC merchant_ids: ${JSON.stringify(merchants)} ${JSON.stringify(merchants) === JSON.stringify(job.merchantIds) ? '✓' : '✗'}`);
}
