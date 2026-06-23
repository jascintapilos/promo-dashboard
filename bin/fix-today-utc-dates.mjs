#!/usr/bin/env node
// Re-PUT every promo + popup saved today so valid_from / start_date use
// current UTC time (not the +08-local-formatted-as-UTC values that the
// earlier nowYmdHms() bug produced). Affects P067/P068/P069/P070 promos
// and every popup created during those runs.

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan as buildPlanQpro } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildPlanQp2 } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

function nowUTC() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const codes = [
  { code: 'TEST_22FS_GOO_20X',         handle: 'P067-r68' },
  { code: 'TEST_88FS_GOO_20X_V5',      handle: 'P068-r69' },
  { code: 'TEST_SIL_REL_50PCT_3X',     handle: 'P069-r70' },
  { code: 'TEST_GLD_10FC_5X',          handle: 'P070-r71' },
];
const qproSites = ['qpro1','qpro2','qpro3','qpro4','qpro5','qpro6','qpro7','qpro8','qpro9','qpro10','qpro11','qpro12','qpro13','qpro14','qpro15','qpro16','qpro17'];
const qpro_brand = (s) => s.toUpperCase();

const commit = process.argv.includes('--commit');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`UTC DATE FIX — ${commit ? 'LIVE' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

async function findByCode(siteId, code) {
  try {
    const r = await authedFetch(siteId, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
    return (r.data?.rows || []).find((x) => x.code === code) || null;
  } catch { return null; }
}

async function fixQproPromo(siteId, code, handle) {
  const site = getSite(siteId);
  const found = await findByCode(siteId, code);
  if (!found) return null;
  const detail = (await authedFetch(site, `/api/bo/promotion/${found.id}`)).data.rows;
  const resolved = JSON.parse(fs.readFileSync(`captures/requests/${handle}.json`, 'utf8'));
  const plan = await buildPlanQpro(resolved, { brand: qpro_brand(siteId), site });
  // Use existing template_id + popup link
  const popupRow = Array.isArray(found.dialog_popup_list) && found.dialog_popup_list[0] ? found.dialog_popup_list[0] : null;
  const popupHint = popupRow ? { id: popupRow.popup_id, code: '', start_date: nowUTC(), label: '' } : null;
  const putBody = plan.buildUpdate(found.id, detail.message_template_id || 0, popupHint);
  if (commit) await updatePromotion(site, found.id, putBody);
  return { id: found.id, valid_from_before: detail.valid_from, valid_from_after: putBody.valid_from };
}

async function fixQp2Promo(code, handle) {
  const site = getSite('ibc22');
  const found = await findByCode('ibc22', code);
  if (!found) return null;
  const detail = (await authedFetch(site, `/api/bo/promotion/${found.id}`)).data.rows;
  const resolved = JSON.parse(fs.readFileSync(`captures/requests/${handle}.json`, 'utf8'));
  const merchantIds = (detail.merchant_ids || []).map((m) => m.id || m);
  const plan = await buildPlanQp2(resolved, { brand: 'QP2A', site, merchantIds });
  // Preserve all dialog popup links via full popup rows
  const popupListResp = await authedFetch(site, '/api/bo/popups?perPage=100&page=1&date_type=start_date&sort_by=id&sort_order=desc');
  const allPopups = popupListResp.data?.rows || [];
  const popupRows = (found.dialog_popup_list || []).map((d) => allPopups.find((p) => p.id === d.popup_id)).filter(Boolean);
  const putBody = plan.buildUpdate(found.id, detail.message_template_id || 0, null);
  // Preserve merchant_ids
  const midObj = {};
  merchantIds.forEach((id, i) => { midObj[String(i)] = id; });
  putBody.merchant_ids = midObj;
  // Preserve popups
  if (popupRows.length) {
    const dl = {};
    popupRows.forEach((p, i) => { dl[String(i)] = { ...p, promotion_id: found.id }; });
    putBody.dialog_popup_list = dl;
  }
  if (commit) await updatePromotion(site, found.id, putBody);
  return { id: found.id, valid_from_before: detail.valid_from, valid_from_after: putBody.valid_from };
}

async function fixPopup(siteId, popupId) {
  const site = getSite(siteId);
  // Fetch full row via list endpoint
  const listResp = await authedFetch(site, '/api/bo/popups?perPage=200&page=1&date_type=start_date&sort_by=id&sort_order=desc');
  const row = (listResp.data?.rows || []).find((p) => p.id === popupId);
  if (!row) return null;
  // Build PUT body: full popup payload + corrected start_date
  const newStart = nowUTC();
  // PUT body shape: needs same fields as POST plus the existing fields
  const contents = {};
  for (const c of row.contents || []) {
    contents[String(c.locale_id)] = {
      locale_id: c.locale_id,
      content: c.raw_content || c.content,
      title: c.raw_title || c.title,
      mobile_link: c.mobile_link,
      desktop_link: c.desktop_link,
      video_mobile_link: null,
      video_desktop_link: null,
      media_type: c.media_type,
      cta_button_type: c.cta_button_type,
      cta_button_text_1: c.cta_button_text_1,
      cta_button_link_1: c.cta_button_link_1,
      cta_button_text_2: c.cta_button_text_2,
      cta_button_link_2: c.cta_button_link_2,
    };
  }
  const body = {
    site_id: row.site_id,
    platform: row.platform,
    location: row.location,
    start_date: newStart,
    end_date: row.end_date,
    session: String(row.session),
    position: row.position,
    status: row.status,
    affiliates_visibility: row.affiliates_visibility,
    always_pop: row.always_pop,
    do_not_show_again: row.do_not_show_again,
    label: row.code,
    contents,
  };
  if (commit) {
    await authedFetch(site, `/api/bo/popups/${popupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  return { id: popupId, start_before: row.start_date, start_after: newStart };
}

// 1. Fix QPRO promos
console.log('--- QPRO promos ---');
for (const { code, handle } of codes) {
  for (const siteId of qproSites) {
    const result = await fixQproPromo(siteId, code, handle);
    if (result) console.log(`  ${siteId.padEnd(8)} ${code.padEnd(25)} id=${result.id}  ${result.valid_from_before} → ${result.valid_from_after}`);
  }
}

// 2. Fix QP2 promos (one shared row per code)
console.log('');
console.log('--- QP2 promos ---');
for (const { code, handle } of codes) {
  const result = await fixQp2Promo(code, handle);
  if (result) console.log(`  ibc22    ${code.padEnd(25)} id=${result.id}  ${result.valid_from_before} → ${result.valid_from_after}`);
}

// 3. Fix popups — gather every popup linked to today's promos
console.log('');
console.log('--- Popups ---');
const popupTargets = [];
for (const { code } of codes) {
  for (const siteId of [...qproSites, 'ibc22']) {
    const found = await findByCode(siteId, code);
    if (!found) continue;
    for (const d of (found.dialog_popup_list || [])) popupTargets.push({ siteId, popupId: d.popup_id });
  }
}
for (const t of popupTargets) {
  const r = await fixPopup(t.siteId, t.popupId);
  if (r) console.log(`  ${t.siteId.padEnd(8)} popup id=${r.id}  ${r.start_before} → ${r.start_after}`);
}

console.log('');
console.log('Done.');
