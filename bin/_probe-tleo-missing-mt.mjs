#!/usr/bin/env node
// Probe data needed to create missing MTs:
// 1. qpro2 FT_REL_TLEO_LC_20PCT_300MX_BR (pid=468) — shares template with all-games, needs own LC template
// 2. ibc22 FT_REL_TLEO_20PCT_228MX — no message template at all
// Also probe qpro3 template for same LC code as content reference

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

// ── qpro2 LC code: get promo detail and reference template from qpro3 ─────────

const site2  = getSite('qpro2');
const site3  = getSite('qpro3');

// Get promo details for qpro2 LC code (pid=468 confirmed)
const p2 = await authedFetch(site2, '/api/bo/promotion/468');
const promo2 = p2.data?.rows;
console.log('\n=== qpro2 FT_REL_TLEO_LC_20PCT_300MX_BR promo detail ===');
console.log('pid:', promo2?.id, 'code:', promo2?.code, 'mtId:', promo2?.message_template_id);
console.log('Promo fields (sample):', JSON.stringify({
  start_date: promo2?.start_date,
  end_date: promo2?.end_date,
  status: promo2?.status,
  name: promo2?.name,
}, null, 2));

// Get qpro3 template for same code as content reference (mtId=457)
const mt3 = await authedFetch(site3, '/api/bo/messagetemplate/457');
const data3 = mt3.data;
console.log('\n=== qpro3 FT_REL_TLEO_LC_20PCT_300MX_BR template (mtId=457) ===');
console.log('section:', data3?.message_template?.section);
console.log('type:', data3?.message_template?.type);
console.log('status:', data3?.message_template?.status);
console.log('code:', data3?.message_template?.code);
console.log('name:', data3?.message_template?.name);
console.log('Locales in message_details:', Object.keys(data3?.message_details || {}));

// Print all locale subjects
for (const [k, d] of Object.entries(data3?.message_details || {})) {
  console.log(`  locale ${k}: subject="${d.subject}"`);
}

// ── ibc22 all-games code: get promo detail + reference template ───────────────

const siteQ = getSite('ibc22');
const resQ = await authedFetch(siteQ, '/api/bo/promotion?code=FT_REL_TLEO_20PCT_228MX&perPage=10&page=1');
const promoQ = resQ.data?.rows?.[0];
console.log('\n=== ibc22 FT_REL_TLEO_20PCT_228MX promo detail ===');
console.log('pid:', promoQ?.id, 'code:', promoQ?.code, 'mtId:', promoQ?.message_template_id);

// Find a similar all-games QP2 template for reference (20PCT_200MX has a template)
const res228 = await authedFetch(siteQ, '/api/bo/promotion?code=FT_REL_TLEO_20PCT_200MX&perPage=10&page=1');
const promo200 = res228.data?.rows?.[0];
console.log('\n=== ibc22 FT_REL_TLEO_20PCT_200MX (reference) ===');
console.log('pid:', promo200?.id, 'mtId:', promo200?.message_template_id);
if (promo200?.message_template_id) {
  const mtRef = await authedFetch(siteQ, `/api/bo/messagetemplate/${promo200.message_template_id}`);
  const dataRef = mtRef.data;
  console.log('section:', dataRef?.message_template?.section);
  console.log('type:', dataRef?.message_template?.type);
  console.log('status:', dataRef?.message_template?.status);
  console.log('code:', dataRef?.message_template?.code);
  console.log('name:', dataRef?.message_template?.name);
  for (const [k, d] of Object.entries(dataRef?.message_details || {})) {
    console.log(`  locale ${k}: subject="${d.subject}"`);
  }
}

// Also check bonus/reward params for FT_REL_TLEO_20PCT_228MX
if (promoQ?.id) {
  // For QPRO/QP2, we can GET the promotion and look at reward fields
  const det = await authedFetch(siteQ, `/api/bo/promotion/${promoQ.id}`);
  const r = det.data?.rows;
  console.log('\nibc22 FT_REL_TLEO_20PCT_228MX promotion_reward[0]:',
    JSON.stringify(r?.promotion_reward?.[0] || r?.reward || 'no reward field', null, 2));
}
