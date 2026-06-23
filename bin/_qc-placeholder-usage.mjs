// QC :merchantname vs :brandname placeholder usage across all promos
// touched by the QP2D sheet work.
//
// Rule (memory feedback_promo_template_placeholders):
//   - QP2 platforms (QP2A/B/C/D = ibc22)  → :merchantname
//   - QPRO platforms (QPRO1-17)           → :brandname
//
// Scans each promo's:
//   - inbox message template (message_template_id) → all locale details
//   - SMS message template (message_template_sms_id) → all locale details
//   - linked dialog popup (dialog_popup_list[].popup_id) → contents per locale
//   - promotion names (promotionname rows)
//
// Counts :merchantname vs :brandname occurrences. Flags rows where the
// WRONG platform placeholder appears.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const probe = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sheet-probe-v2.json', 'utf8'));

// Build promo inventory: (brand, code, promotion_id, platform_expected_placeholder).
// Only check promos that EXIST on each brand.
const QP2_KEYS = ['QP2D'];
const QPRO_KEYS = ['QPRO2', 'QPRO3', 'QPRO4', 'QPRO6', 'QPRO8', 'QPRO10'];
const SITE = {
  QP2D: { site: 'ibc22', merchantId: 4, platform: 'qp2' },
  QPRO2: { site: 'qpro2', platform: 'qpro' },
  QPRO3: { site: 'qpro3', platform: 'qpro' },
  QPRO4: { site: 'qpro4', platform: 'qpro' },
  QPRO6: { site: 'qpro6', platform: 'qpro' },
  QPRO8: { site: 'qpro8', platform: 'qpro' },
  QPRO10: { site: 'qpro10', platform: 'qpro' },
};

const items = [];
for (const r of probe.results) {
  for (const k of [...QP2_KEYS, ...QPRO_KEYS]) {
    const data = r[k];
    if (!data?.present) continue;
    items.push({
      brand: k,
      site: SITE[k].site,
      merchantId: SITE[k].merchantId,
      platform: SITE[k].platform,
      code: r.code,
      promotion_id: data.id,
      message_template_id: data.message_template_id,
    });
  }
}
console.log(`QC scope: ${items.length} promos across ${[...QP2_KEYS, ...QPRO_KEYS].length} BOs`);

// Cache fetched templates/popups so we don't re-fetch the same one.
const tplCache = new Map();
const popupCache = new Map();

async function fetchTemplate(site, id) {
  const key = `${site.id || site.baseUrl}:${id}`;
  if (tplCache.has(key)) return tplCache.get(key);
  try {
    const r = await authedFetch(site, `/api/bo/messagetemplate/${id}`);
    tplCache.set(key, r?.data || null);
    return r?.data || null;
  } catch (e) {
    tplCache.set(key, null);
    return null;
  }
}

async function fetchPopup(site, id) {
  const key = `${site.id || site.baseUrl}:${id}`;
  if (popupCache.has(key)) return popupCache.get(key);
  try {
    const r = await authedFetch(site, `/api/bo/popups/${id}`);
    popupCache.set(key, r?.data || null);
    return r?.data || null;
  } catch (e) {
    popupCache.set(key, null);
    return null;
  }
}

function countPlaceholders(text) {
  if (!text) return { merchantname: 0, brandname: 0 };
  const m = (text.match(/:merchantname/gi) || []).length;
  const b = (text.match(/:brandname/gi) || []).length;
  return { merchantname: m, brandname: b };
}

async function qcOne(item) {
  const siteObj = getSite(item.site);
  const result = { ...item, checks: [] };

  // ── Fetch promotion to get the popup_id from dialog_popup_list ──
  let popupId = null;
  try {
    const params = new URLSearchParams({ code: item.code, perPage: '5' });
    if (item.merchantId != null) params.set('merchant_id', String(item.merchantId));
    const r = await authedFetch(siteObj, `/api/bo/promotion?${params}`);
    const row = (r?.data?.rows || []).find(x => x.code === item.code);
    if (row) {
      const dpl = row.dialog_popup_list;
      // QPRO shape: [{ id, promotion_id, popup_id, ... }]; QP2 shape similar.
      if (Array.isArray(dpl) && dpl.length) popupId = dpl[0].popup_id;
      else if (dpl && typeof dpl === 'object') popupId = Object.values(dpl)[0]?.popup_id;
    }
  } catch {}

  // ── Inbox template ──
  if (item.message_template_id) {
    const tpl = await fetchTemplate(siteObj, item.message_template_id);
    if (tpl?.message_details) {
      for (const [localeId, d] of Object.entries(tpl.message_details)) {
        const txt = `${d.subject || ''}\n${d.message || ''}`;
        const cnt = countPlaceholders(txt);
        result.checks.push({ kind: 'inbox', tpl_id: item.message_template_id, locale: d.settings_locales_code || localeId, ...cnt });
      }
    } else {
      result.checks.push({ kind: 'inbox', tpl_id: item.message_template_id, error: 'fetch_failed' });
    }
  }

  // ── SMS template ──
  // Need to re-fetch promotion to get message_template_sms_id (not pre-cached for QP2D)
  let smsId = null;
  try {
    const det = await authedFetch(siteObj, `/api/bo/promotion/${item.promotion_id}`);
    smsId = det?.data?.rows?.message_template_sms_id;
  } catch {}
  if (smsId) {
    const tpl = await fetchTemplate(siteObj, smsId);
    if (tpl?.message_details) {
      for (const [localeId, d] of Object.entries(tpl.message_details)) {
        const txt = `${d.subject || ''}\n${d.message || ''}`;
        const cnt = countPlaceholders(txt);
        result.checks.push({ kind: 'sms', tpl_id: smsId, locale: d.settings_locales_code || localeId, ...cnt });
      }
    } else {
      result.checks.push({ kind: 'sms', tpl_id: smsId, error: 'fetch_failed' });
    }
  } else {
    result.checks.push({ kind: 'sms', tpl_id: null, note: 'no_sms_template' });
  }

  // ── Dialog popup ──
  if (popupId) {
    const popup = await fetchPopup(siteObj, popupId);
    const contents = popup?.popup?.contents || popup?.contents || {};
    const label = popup?.popup?.label || popup?.label || '';
    if (label) {
      const cnt = countPlaceholders(label);
      result.checks.push({ kind: 'popup_label', popup_id: popupId, ...cnt });
    }
    for (const [localeId, c] of Object.entries(contents)) {
      const txt = `${c.title || ''}\n${c.content || ''}\n${c.cta_button_text_1 || ''}\n${c.cta_button_text_2 || ''}`;
      const cnt = countPlaceholders(txt);
      result.checks.push({ kind: 'popup_content', popup_id: popupId, locale_id: localeId, ...cnt });
    }
  } else {
    result.checks.push({ kind: 'popup', popup_id: null, note: 'no_popup' });
  }

  // ── Promotion names ──
  try {
    const n = await authedFetch(siteObj, `/api/bo/promotionname?promotion_id=${item.promotion_id}`);
    for (const row of n?.data?.rows || []) {
      const txt = `${row.promotion_name || ''}\n${row.rewards_name || ''}`;
      const cnt = countPlaceholders(txt);
      result.checks.push({ kind: 'name', locale: row.locale, ...cnt });
    }
  } catch {}

  // Verdict per row
  const wrong = result.checks.filter(c => {
    if (c.error || c.note) return false;
    if (item.platform === 'qp2') return c.brandname > 0;        // QP2 should not have :brandname
    if (item.platform === 'qpro') return c.merchantname > 0;    // QPRO should not have :merchantname
    return false;
  });
  result.verdict = wrong.length === 0 ? 'PASS' : 'FAIL';
  result.wrong = wrong;
  return result;
}

async function runBatched(items, fn, concurrency = 15) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (true) {
      const i = next++; if (i >= items.length) break;
      results[i] = await fn(items[i]);
      done++;
      if (done % 25 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const t0 = Date.now();
const results = await runBatched(items, qcOne, 15);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Tally
const pass = results.filter(r => r.verdict === 'PASS').length;
const fail = results.filter(r => r.verdict === 'FAIL').length;
console.log(`\n━━━ QC SUMMARY ━━━`);
console.log(`PASS: ${pass}/${results.length}`);
console.log(`FAIL: ${fail}`);

// Aggregate failures by (brand, kind, template_id) for cleaner reporting
const failBuckets = new Map();
for (const r of results) {
  if (r.verdict !== 'FAIL') continue;
  for (const w of r.wrong) {
    const key = `${r.brand}/${w.kind}/${w.tpl_id || w.popup_id || '-'}`;
    if (!failBuckets.has(key)) failBuckets.set(key, { brand: r.brand, kind: w.kind, ref: w.tpl_id || w.popup_id, codes: new Set() });
    failBuckets.get(key).codes.add(r.code);
  }
}
if (failBuckets.size) {
  console.log('\nFailure buckets (shared resources by brand):');
  for (const b of failBuckets.values()) {
    console.log(`  ${b.brand}  ${b.kind}  id=${b.ref}  affects ${b.codes.size} code(s)`);
  }
}

fs.writeFileSync('captures/api-runs/qc-placeholder-usage.json', JSON.stringify({ generated: new Date().toISOString(), results }, null, 2));
console.log(`\nFull report → captures/api-runs/qc-placeholder-usage.json`);
