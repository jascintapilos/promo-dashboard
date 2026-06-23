#!/usr/bin/env node
// One-shot: update the 3.3 Promotion Content `image` field on QPRO16 + QPRO17
// to use the mobile (mup) image instead of the desktop that was accidentally uploaded.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { authedFetch, uploadFile } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const BANNER_BASE = 'C:\\Users\\vdiuser\\Downloads\\promo-automation\\Banner\\Microgaming Road to Glory';

const JOBS = [
  {
    siteId: 'qpro16',
    folder: path.join(BANNER_BASE, 'ed98-min'),
    mobileFiles: {
      MY_EN: 'qpro16-ed98-mup-road-to-glory-960x400-my-en.jpg',
      MY_ZH: 'qpro16-ed98-mup-road-to-glory-960x400-my-zh.jpg',
    },
  },
  {
    siteId: 'qpro17',
    folder: path.join(BANNER_BASE, 'xe38-min'),
    mobileFiles: {
      MY_EN: 'qpro17-xe38-mup-road-to-glory-960x400-my-en.jpg',
      MY_ZH: 'qpro17-xe38-mup-road-to-glory-960x400-my-zh.jpg',
    },
  },
];

for (const job of JOBS) {
  const site = getSite(job.siteId);

  // 1. Find EVEMRTG
  const search = await authedFetch(site, '/api/bo/promotioncontent?perPage=50&search=EVEMRTG');
  const found = (search?.data?.rows || []).find((r) => r.code === 'EVEMRTG');
  if (!found) { console.error(job.siteId + ': EVEMRTG not found'); continue; }
  console.log(`\n${job.siteId}: EVEMRTG id=${found.id}`);

  // 2. GET full details — response shape: { data: { content: {...}, details: { "1": {...}, "3": {...} } } }
  const detail = await authedFetch(site, `/api/bo/promotioncontent/${found.id}`);
  const content = detail?.data?.content;
  const details = JSON.parse(JSON.stringify(detail?.data?.details || {})); // deep clone

  // 3. Build locale map
  const locRes = await authedFetch(site, '/api/bo/locale?perPage=100');
  const localeMap = Object.fromEntries((locRes?.data?.rows || []).map((r) => [r.code, r.id]));

  // 4. Upload mobile images and patch image field
  for (const [locCode, filename] of Object.entries(job.mobileFiles)) {
    const locId = localeMap[locCode];
    if (!locId) { console.log(`  ${locCode} not in locale map — skip`); continue; }

    const filePath = path.join(job.folder, filename);
    console.log(`  uploading ${locCode} (${filename})…`);
    await delay(3000);
    const up = await uploadFile(site, readFileSync(filePath), filename, { type: 'promotions' });
    const newUrl = up?.data?.files?.[0];
    if (!newUrl) { console.error(`  upload failed for ${locCode}`); continue; }
    console.log(`  ${locCode} image → ${newUrl}`);

    if (details[String(locId)]) {
      details[String(locId)].image = newUrl;
    } else {
      console.warn(`  detail key "${locId}" not found in details keys: ${Object.keys(details).join(', ')}`);
    }
  }

  // 5. Build PUT body.
  // GET returns category_id as array [2,3,17] and content_type as array [1,2].
  // PUT expects them as objects: category_id={"0":2,"1":3,...}, content_type={"1":true,"2":true}.
  const categoryObj    = Object.fromEntries((content.category_id || []).map((id, i) => [String(i), id]));
  const contentTypeObj = Object.fromEntries((content.content_type || []).map((t) => [String(t), true]));

  // Strip server-assigned fields from each detail before PUT
  const SERVER_FIELDS = new Set(['id', 'promotion_content_id', 'settings_locale_code', 'created_at', 'updated_at']);
  const cleanDetails = {};
  for (const [k, d] of Object.entries(details)) {
    if (!d) { cleanDetails[k] = d; continue; }
    cleanDetails[k] = Object.fromEntries(Object.entries(d).filter(([f]) => !SERVER_FIELDS.has(f)));
  }

  const putBody = {
    code:              content.code,
    category_id:       categoryObj,
    content_type:      contentTypeObj,
    member_visibility: content.member_visibility,
    position:          content.position,
    apply_action:      content.apply_action,
    allow_apply:       content.allow_apply,
    status:            content.status,
    max_application:   content.max_application,
    details:           cleanDetails,
  };

  await delay(1500);
  console.log(`  PUTting updated details…`);
  // Pass body as object (not pre-stringified) so rawFetchJson sets Content-Type: application/json
  const putRes = await authedFetch(site, `/api/bo/promotioncontent/${found.id}`, {
    method: 'PUT',
    body: putBody,
  });
  const ok = putRes?.success !== false;
  console.log(`  ${job.siteId}: PUT ${ok ? '✅ OK' : '❌ FAILED'} — ${JSON.stringify(putRes?.message || '')}`);
}
