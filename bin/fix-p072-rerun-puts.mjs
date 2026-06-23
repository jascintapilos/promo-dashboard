#!/usr/bin/env node
// Re-PUT P072 saves + add clean per-locale name rows.
//   - QPRO7 id=339 + QPRO10 id=257: re-PUT (mapper now excludes DG/SSG)
//   - QP2B id=1179: re-PUT (mapper now sets deposit_status=4 = Last Deposit)
//   - All three: POST new promotion_name rows with clean EN + ZH text
//     (old REL-suffixed rows left in place — operator can prune via BO UI)

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan as buildQproPlan } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const resolved = JSON.parse(fs.readFileSync('captures/requests/P072-r73.json', 'utf8'));
const commit = process.argv.includes('--commit');

const qproTargets = [
  { site: 'qpro7',  brand: 'QPRO7',  id: 339 },
  { site: 'qpro10', brand: 'QPRO10', id: 257 },
];
const qp2Targets = [
  { site: 'ibc22', brand: 'QP2B', id: 1179, merchantIds: [2] },
];

const CURRENCY_TO_ID = { MYR: '1', SGD: '3', IDR: '4' };
const LOCALE_TO_ID = { MY_EN: 1, MY_ZH: 3, SG_EN: 6, SG_ZH: 7, ID_EN: 8, ID_ID: 9 };
const REGION_TO_CCY = { MY: 'MYR', SG: 'SGD', ID: 'IDR' };

async function postCleanNames(siteId, promoId) {
  const site = getSite(siteId);
  // Check existing name rows so we don't double-post identical (locale, currency)
  const existing = (await authedFetch(site, `/api/bo/promotionname?promotion_id=${promoId}&perPage=50`)).data?.rows || [];
  const have = new Set(existing.map((n) => `${n.settings_locale_id||n.locale_id}:${n.settings_currency_id||n.currency_id}:${n.promotion_name}`));
  let added = 0;
  for (const locale of resolved.locales || []) {
    const region = (locale.match(/^([A-Z]{2})_/)||[])[1];
    const ccyLabel = REGION_TO_CCY[region] || 'MYR';
    const ccyId = CURRENCY_TO_ID[ccyLabel];
    const localeId = LOCALE_TO_ID[locale];
    if (!ccyId || !localeId) continue;
    const isEn = locale.endsWith('_EN');
    const isZh = locale.endsWith('_ZH') || locale.endsWith('_ID');
    const name = isEn ? (resolved.promotion_name_en || resolved.promo_code)
                : isZh ? (resolved.promotion_name_zh_id || resolved.promotion_name_en || resolved.promo_code)
                       : (resolved.promotion_name_en || resolved.promo_code);
    const key = `${localeId}:${ccyId}:${name}`;
    if (have.has(key)) continue;
    const body = { promotion_id: promoId, currency_id: ccyId, settings_locale_id: String(localeId), promotion_name: name, rewards_name: name };
    if (commit) {
      try {
        await authedFetch(site, '/api/bo/promotionname', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
        added += 1;
      } catch (e) { /* may collide with stale row — ignore */ }
    } else {
      added += 1;
    }
  }
  return added;
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`FIX P072 SAVES — ${commit ? 'LIVE' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for (const t of qproTargets) {
  const site = getSite(t.site);
  const before = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
  console.log(`\n${t.brand} id=${t.id} gp_count_before=${(before.game_provider_ids||[]).length}`);
  if (commit) {
    const plan = await buildQproPlan(resolved, { brand: t.brand, site });
    const putBody = plan.buildUpdate(t.id, before.message_template_id || 0, null);
    await updatePromotion(site, t.id, putBody);
    const after = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
    console.log(`  after: gp_count=${(after.game_provider_ids||[]).length}`);
  }
  const added = await postCleanNames(t.site, t.id);
  console.log(`  ${added} clean name row(s) ${commit ? 'posted' : 'would post'}`);
}

for (const t of qp2Targets) {
  const site = getSite(t.site);
  const lst = await authedFetch(site, `/api/bo/promotion?code=FT_REL_LC_25PCT&perPage=5`);
  const before = (lst.data?.rows||[]).find(x=>x.id===t.id);
  console.log(`\n${t.brand} id=${t.id} deposit_status_before="${before?.deposit_status}"`);
  if (commit) {
    const plan = await buildQp2Plan(resolved, { brand: t.brand, site, merchantIds: t.merchantIds });
    const detail = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
    const putBody = plan.buildUpdate(t.id, detail.message_template_id || 0, null);
    // Preserve merchant_ids + popup
    const mIdsObj = {};
    t.merchantIds.forEach((id, i) => { mIdsObj[String(i)] = id; });
    putBody.merchant_ids = mIdsObj;
    const popupListResp = await authedFetch(site, '/api/bo/popups?perPage=200&page=1&date_type=start_date&sort_by=id&sort_order=desc');
    const allPopups = popupListResp.data?.rows || [];
    const popupRows = (before?.dialog_popup_list||[]).map((d)=>allPopups.find(p=>p.id===d.popup_id)).filter(Boolean);
    if (popupRows.length) {
      const dl = {};
      popupRows.forEach((p, i) => { dl[String(i)] = { ...p, promotion_id: t.id }; });
      putBody.dialog_popup_list = dl;
    }
    await updatePromotion(site, t.id, putBody);
    const lst2 = await authedFetch(site, `/api/bo/promotion?code=FT_REL_LC_25PCT&perPage=5`);
    const after = (lst2.data?.rows||[]).find(x=>x.id===t.id);
    console.log(`  after: deposit_status="${after?.deposit_status}"`);
  }
  const added = await postCleanNames(t.site, t.id);
  console.log(`  ${added} clean name row(s) ${commit ? 'posted' : 'would post'}`);
}

console.log('\nDone.');
