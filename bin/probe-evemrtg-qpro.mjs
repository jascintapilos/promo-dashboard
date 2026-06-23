#!/usr/bin/env node
// Quick probe: check EVEMRTG promotion categories + ZH title/desc on qpro15/16/17

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const JOBS = [
  { siteId: 'qpro15', contentId: 53 },
  { siteId: 'qpro16', contentId: 53 },
  { siteId: 'qpro17', contentId: 52 },
];

for (const { siteId, contentId } of JOBS) {
  const site = getSite(siteId);
  console.log(`\n══ ${siteId}  content_id=${contentId} ══`);

  // --- 3.3 content: ZH title/description ---
  const cd = await authedFetch(site, `/api/bo/promotioncontent/${contentId}`);
  const details = cd?.data?.details || {};
  for (const [locId, d] of Object.entries(details)) {
    if (!d) continue;
    console.log(`  locale ${locId}  title="${d.title}"  desc="${d.description}"`);
    const ptype = d.promotion_type ?? '(n/a)';
    const brand = (d.content || '').match(/:brandname/g)?.length || 0;
    const merch = (d.content || '').match(/:merchantname/g)?.length || 0;
    console.log(`         promotion_type=${ptype}  :brandname=${brand}  :merchantname=${merch}`);
  }

  // --- 3.1 promotion: find by code EVEMRTG* ---
  const code = cd?.data?.content?.code;
  console.log(`  content code: ${code}`);

  // Find linked promotion
  const promoList = await authedFetch(site, `/api/bo/promotion?perPage=50&search=${code}`);
  const rows = promoList?.data?.rows || [];
  for (const row of rows) {
    if (row.promotion_content_code !== code && row.code !== code) continue;
    console.log(`  promotion id=${row.id}  code=${row.code || row.promotion_content_code}`);
    // Get full detail for categories
    const pd = await authedFetch(site, `/api/bo/promotion/${row.id}`);
    const cats = pd?.data?.promotion_category || pd?.data?.categories || pd?.data?.promotion?.categories;
    const targets = pd?.data?.promotion_target || pd?.data?.promotion?.promotion_target;
    console.log(`    categories raw:`, JSON.stringify(cats)?.slice(0, 300));
    if (targets) console.log(`    targets sample:`, JSON.stringify(targets).slice(0, 200));
  }
}
