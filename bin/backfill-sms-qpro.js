#!/usr/bin/env node

import { parseArgs } from './_args.js';
import { loadAllRequests, resolveDuplicates, resolveHandle } from '../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../src/bo-cache.js';
import { BRAND_TO_SITE } from '../src/ingest.js';
import { getSite } from '../src/sites.js';
import { createMessageTemplate, findPromotionByCode, getPopupDetail, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';

const SAFE_BRANDS = new Set([
  'QPRO1','QPRO2','QPRO3','QPRO4','QPRO5','QPRO6','QPRO7','QPRO8','QPRO9',
  'QPRO10','QPRO11','QPRO12','QPRO13','QPRO14','QPRO15','QPRO16','QPRO17',
]);

const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
if (!userInput) {
  console.error('usage: backfill-sms-qpro.js <handle|P###> [--brand=QPROx] [--commit] [--force]');
  process.exit(2);
}

const commit = flags.commit === true;
const force = flags.force === true;
const brandOverride = flags.brand;

const { byHandle, byId, byCode } = await loadAllRequests();
const handle = resolveHandle(userInput, { byHandle, byId });
if (!handle) {
  console.error(`request "${userInput}" not found in captures/requests/`);
  process.exit(2);
}
const request = byHandle.get(handle);
const bo = await loadBoCodeIndex();
let resolved = await resolveDuplicates(request, byCode, { boIndex: bo.byCode, boFetcher: fetchBoCodeAsRecord });
if (resolved.promo_code && resolved.promo_code.includes('\n')) {
  resolved = { ...resolved, promo_code: resolved.promo_code.split('\n')[0].trim() };
}

const targetBrand = (brandOverride && SAFE_BRANDS.has(brandOverride) && resolved.brands.includes(brandOverride))
  ? brandOverride
  : resolved.brands.find((b) => SAFE_BRANDS.has(b));
if (!targetBrand) {
  console.error(`No eligible QPRO brand found for ${handle}`);
  process.exit(3);
}

const siteId = BRAND_TO_SITE[targetBrand]?.siteId;
if (!siteId) {
  console.error(`No site mapping found for ${targetBrand}`);
  process.exit(3);
}
const site = getSite(siteId);
const plan = await buildApiPlan(resolved, { brand: targetBrand, site });
if (!plan.smsTemplate) {
  console.error(`No SMS template resolved for ${handle}/${targetBrand}. Check sms_required parsing or bonus-type support.`);
  process.exit(4);
}

const existing = await findPromotionByCode(site, resolved.promo_code);
if (!existing) {
  console.error(`Promo ${resolved.promo_code} not found on ${siteId}`);
  process.exit(5);
}

if (existing.message_template_sms_id && !force) {
  console.log(`Skip: ${resolved.promo_code} already linked to sms template ${existing.message_template_sms_id}`);
  process.exit(0);
}

let dialogPopup = null;
const popupId = existing.dialog_popup_list?.[0]?.popup_id || existing.dialog_popup_list?.[0]?.id || null;
if (popupId) {
  const popup = await getPopupDetail(site, popupId);
  dialogPopup = {
    id: popup?.id || popupId,
    code: popup?.code || '',
    start_date: popup?.start_date || popup?.created_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
    label: popup?.label || resolved.promotion_name_en,
  };
}

console.log(`${commit ? 'LIVE' : 'DRY RUN'} SMS backfill for ${handle}`);
console.log(`  Brand: ${targetBrand} (${siteId})`);
console.log(`  Code: ${resolved.promo_code}`);
console.log(`  Promotion ID: ${existing.id}`);
console.log(`  Existing inbox MT: ${existing.message_template_id || 0}`);
console.log(`  Existing SMS MT: ${existing.message_template_sms_id || 0}`);
console.log(`  Popup: ${dialogPopup ? `${dialogPopup.id} (${dialogPopup.code})` : 'none'}`);
console.log(`  SMS locales: ${Object.keys(plan.smsTemplate.details).join(', ')}`);

if (!commit) {
  console.log('');
  console.log(JSON.stringify({
    smsTemplate: plan.smsTemplate,
    update: plan.buildUpdate(existing.id, existing.message_template_id || 0, dialogPopup, '<sms_template_id>'),
  }, null, 2));
  process.exit(0);
}

const smsRes = await createMessageTemplate(site, plan.smsTemplate);
const smsTemplateId = smsRes?.data?.rows?.id ?? smsRes?.rows?.id ?? smsRes?.id;
if (!smsTemplateId) {
  throw new Error(`SMS template creation returned no id: ${JSON.stringify(smsRes).slice(0, 300)}`);
}
console.log(`  Created SMS template: ${smsTemplateId}`);

const putBody = plan.buildUpdate(existing.id, existing.message_template_id || 0, dialogPopup, smsTemplateId);
await updatePromotion(site, existing.id, putBody);
const verify = await findPromotionByCode(site, resolved.promo_code);

if (verify?.message_template_sms_id !== smsTemplateId) {
  throw new Error(`Verification failed: BO has message_template_sms_id=${verify?.message_template_sms_id ?? 'null'} not ${smsTemplateId}`);
}

console.log(`  Linked SMS template successfully: ${smsTemplateId}`);
