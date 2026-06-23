#!/usr/bin/env node
// P071 inbox refer fix: operator wrote "Pls refer QPRO2 inbox code
// PROMOTIONS.MESSAGE.FT_RND_SLOTS_25PCT" in column N. The canary created
// a NEW template from the standard renderer instead. This one-off:
//   1. Fetches template id=246 (code PROMOTIONS.MESSAGE.FT_RND_SLOTS_25PCT)
//      from QPRO2 with all per-locale message_details.
//   2. POSTs a new template on ibc22 with same code/name/details.
//   3. PUTs promo 1178 (QP2A P071) to link the new template_id.
//
// Old template (1044) stays in BO — operator can archive via UI if desired.

import { authedFetch, createMessageTemplate, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';
import fs from 'node:fs';

const SOURCE_SITE = 'qpro2';
const SOURCE_TEMPLATE_ID = 246;
const TARGET_SITE = 'ibc22';
const TARGET_PROMO_ID = 1178;
const commit = process.argv.includes('--commit');

const resolved = JSON.parse(fs.readFileSync('captures/requests/P071-r72.json', 'utf8'));

// 1. Fetch source template + details
const srcResp = await authedFetch(SOURCE_SITE, `/api/bo/messagetemplate/${SOURCE_TEMPLATE_ID}?edit=1`);
const srcTpl = srcResp.data?.message_template;
const srcDetails = srcResp.data?.message_details;
console.log(`Source: ${srcTpl.code} (${srcTpl.name}) — ${Object.keys(srcDetails||{}).length} locales`);
for (const [k, v] of Object.entries(srcDetails||{})) {
  console.log(`  locale_id=${k} subject="${v.subject?.slice(0,50)||''}" msg_len=${v.message?.length||0}`);
}

// 2. Build POST body for target site
const details = {};
for (const [k, v] of Object.entries(srcDetails)) {
  details[k] = {
    settings_locale_id: Number(k),
    subject: v.subject,
    message: v.message,
  };
}
const targetSite = getSite(TARGET_SITE);
const body = {
  code: srcTpl.code,         // same code (admin can rename per-brand if needed)
  name: srcTpl.name,
  section: srcTpl.section,
  type: srcTpl.type,
  status: 1,
  details,
};

console.log('');
console.log(`POST /api/bo/messagetemplate on ${TARGET_SITE} (code="${body.code}", ${Object.keys(details).length} locales)`);
let newTemplateId = null;
if (commit) {
  try {
    const r = await createMessageTemplate(targetSite, body);
    newTemplateId = r?.data?.rows?.id || r?.data?.message_template?.id;
    console.log(`  ✓ new template id=${newTemplateId}`);
  } catch (e) {
    // If template already exists (e.g. earlier attempt), find it
    if (/already.*been\s+taken/i.test(e.message || '')) {
      const list = await authedFetch(targetSite, `/api/bo/messagetemplate?perPage=20&code=${encodeURIComponent(body.code)}`);
      const existing = (list.data?.rows || []).find((t) => t.code === body.code);
      if (existing) {
        newTemplateId = existing.id;
        console.log(`  ⚠ template with that code already exists — using id=${newTemplateId}`);
      } else {
        throw e;
      }
    } else {
      throw e;
    }
  }
}

// 3. PUT promo 1178 to link new template
if (commit && newTemplateId) {
  console.log('');
  console.log(`PUT /api/bo/promotion/${TARGET_PROMO_ID} (link template ${newTemplateId})…`);
  const det = (await authedFetch(targetSite, `/api/bo/promotion/${TARGET_PROMO_ID}`)).data.rows;
  const merchantIds = (det.merchant_ids||[]).map((m) => m.id || m);
  const plan = await buildApiPlan(resolved, { brand: 'QP2A', site: targetSite, merchantIds });
  const putBody = plan.buildUpdate(TARGET_PROMO_ID, newTemplateId, null);
  const mObj = {}; merchantIds.forEach((id, i) => { mObj[String(i)] = id; });
  putBody.merchant_ids = mObj;
  // Preserve popups
  const lst = await authedFetch(targetSite, `/api/bo/promotion?code=${encodeURIComponent(det.code)}&perPage=5`);
  const lrow = (lst.data?.rows||[]).find(x=>x.id===TARGET_PROMO_ID);
  const popupResp = await authedFetch(targetSite, '/api/bo/popups?perPage=200&page=1&date_type=start_date&sort_by=id&sort_order=desc');
  const allPopups = popupResp.data?.rows || [];
  const popupRows = (lrow?.dialog_popup_list||[]).map((d)=>allPopups.find(p=>p.id===d.popup_id)).filter(Boolean);
  if (popupRows.length) {
    const dl = {};
    popupRows.forEach((p, i) => { dl[String(i)] = { ...p, promotion_id: TARGET_PROMO_ID }; });
    putBody.dialog_popup_list = dl;
  }
  await updatePromotion(targetSite, TARGET_PROMO_ID, putBody);
  console.log('  ✓ linked');
}

if (!commit) console.log('\n(dry-run; add --commit to apply)');
