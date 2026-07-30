// Shared estate enumeration for the QC watchman family — used by
// bin/find-qc-sweep-candidates.mjs (post-creation trigger) and
// bin/brand-watch.mjs (daily 5pm trigger) so both walk the exact same
// brand/site universe and candidate shape. Extracted from
// find-qc-sweep-candidates.mjs per advisor review 2026-07-07
// ("refactor, don't fork — one check library, one log, two triggers").
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { getAllPromotions } from './api-client.js';
import { QP2_BRAND_TO_IDS } from './api-mapper-qp2.js';
import { igmpPost } from './igmp-client.js';
import { getSheetsClient } from './sheets-client.js';
import { getOpsSheetId } from './ops-sheet.js';

export const QPRO_BRANDS = Array.from({ length: 17 }, (_, i) => ({ brand: `QPRO${i + 1}`, siteId: `qpro${i + 1}` }));
// R20-fix: QP2 shared BO lives in bo-sites.json under id 'ibc22' (all four
// QP2 merchants — QP2A/B/C/D — share ibc22.qtp777.com). src/ingest.js:75-78
// is already 'ibc22'; this file was drifted to a fictional 'qp2' siteId that
// no bo-sites.json ever had. Fix aligns QC Hub with the daily canary flow.
export const QP2_MERCHANTS = Object.entries(QP2_BRAND_TO_IDS).map(([brand, ids]) => ({ brand, merchantId: ids.merchantId, siteId: 'ibc22' }));
// Brand label must match bundleBrand() in bin/canary-api-igmp.js exactly —
// that's what qc-bundle filenames are keyed by (WS1_MY, WS1_SG, ... but WS2
// stays single since it has only one region).
export const IGMP_SITES = [
  { siteId: 'ws1-v3-my', brand: 'WS1_MY', region: 'MY' },
  { siteId: 'ws1-v3-sg', brand: 'WS1_SG', region: 'SG' },
  { siteId: 'ws1-v3-id', brand: 'WS1_ID', region: 'ID' },
  { siteId: 'ws1-v3-th', brand: 'WS1_TH', region: 'TH' },
  { siteId: 'ws1-v3-kh', brand: 'WS1_KH', region: 'KH' },
  { siteId: 'ws2', brand: 'WS2', region: 'MY' },
];

// brand -> { platform, siteId, merchantId? } — for callers that need to
// re-fetch a single code's live detail given only the brand label from a
// findings/state file (which doesn't carry siteId).
export function brandToSite(brand) {
  const qpro = QPRO_BRANDS.find((b) => b.brand === brand);
  if (qpro) return { platform: 'qpro', siteId: qpro.siteId };
  const qp2 = QP2_MERCHANTS.find((b) => b.brand === brand);
  if (qp2) return { platform: 'qp2', siteId: qp2.siteId, merchantId: qp2.merchantId };
  const igmp = IGMP_SITES.find((b) => b.brand === brand);
  if (igmp) return { platform: 'igmp', siteId: igmp.siteId, region: igmp.region };
  return null;
}

// ── Index local qc-bundles once: brand::promo_code -> {handle, savedAt} ──
export function buildBundleIndex() {
  const index = new Map();
  const files = [];
  const dir = 'captures/qc-bundles';
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.json')) files.push(f);
    }
  }
  for (const f of files) {
    let bundle;
    try { bundle = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); } catch { continue; }
    if (!bundle?.promo_code || !bundle?.brand) continue;
    const mtimeMs = statSync(`${dir}/${f}`).mtimeMs;
    const savedAtMs = bundle.saved_at ? Date.parse(bundle.saved_at) : mtimeMs;
    const key = `${bundle.brand}::${bundle.promo_code}`;
    const handle = f.slice(0, -(`__${bundle.brand}.json`.length));
    // Multiple bundles can exist for edits — keep the most recently saved one.
    const prior = index.get(key);
    if (!prior || savedAtMs > prior.savedAtMs) {
      index.set(key, { handle, savedAtMs, file: f });
    }
  }
  return index;
}

// ── Read QC Results Log once: brand::promo_code -> last Sentinel check info ──
export async function readQcResultsLog() {
  const { sheets } = await getSheetsClient();
  const OPS_ID = getOpsSheetId();
  const TAB = 'QC Results Log';
  const meta = await sheets.spreadsheets.get({ spreadsheetId: OPS_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === TAB)) return new Map();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: OPS_ID, range: `'${TAB}'!A2:N100000` });
  const rows = res.data.values || [];
  const index = new Map();
  for (const r of rows) {
    const [timestamp, promoCode, brand, , , , , , sentinelVerdict, checkTrigger] = r;
    if (!promoCode || !brand) continue;
    index.set(`${brand}::${promoCode}`, {
      lastCheckedAt: timestamp ? Date.parse(timestamp) : null,
      sentinelVerdict: sentinelVerdict || null,
      checkTrigger: checkTrigger || null,
    });
  }
  return index;
}

// ── Fetch all currently-live codes per brand, across all 3 platform families ──
// Returns { codes, siteErrors } — siteErrors is [{brand, siteId, message}] so
// callers can surface a partial-run status instead of silently under-reporting.
export async function fetchAllLiveCodes() {
  const codes = [];
  const siteErrors = [];

  // category/game_provider/message_templates/dialog_popup_list/valid_to/status
  // are all present on this list response already — carried through so
  // listing-level checks never need a second (per-code detail) fetch.
  const qproQp2Fields = (r) => ({
    name: r.name, category: r.category, gameProvider: r.game_provider,
    messageTemplateCount: (r.message_templates || []).length,
    // Full per-locale MT bodies come inline on the list response (confirmed
    // live 2026-07-07) — carried so MT content checks need no extra fetches.
    messageTemplates: (r.message_templates || []).map((t) => ({ settings_locale_id: t.settings_locale_id, subject: t.subject, message: t.message })),
    dialogPopupCount: (r.dialog_popup_list || []).length,
    dialogPopupLinks: (r.dialog_popup_list || []).map((d) => ({ site_id: d.site_id, popup_id: d.popup_id })),
    merchantIds: (r.merchant_ids || []).map((m) => (typeof m === 'object' ? m.id : m)),
    currencies: r.currencies,
    validTo: r.valid_to, status: r.status,
  });

  await Promise.all(QPRO_BRANDS.map(async ({ brand, siteId }) => {
    try {
      const { rows } = await getAllPromotions(siteId, { perPage: 500, status: 1 });
      for (const r of rows) codes.push({ platform: 'qpro', brand, code: r.code, region: null, siteId, promotionId: r.id, ...qproQp2Fields(r) });
    } catch (e) { siteErrors.push({ brand, siteId, message: e.message.split('\n')[0] }); }
  }));

  await Promise.all(QP2_MERCHANTS.map(async ({ brand, merchantId, siteId }) => {
    try {
      const { rows } = await getAllPromotions(siteId, { perPage: 500, status: 1, merchantId });
      for (const r of rows) codes.push({ platform: 'qp2', brand, code: r.code, region: null, siteId, merchantId, promotionId: r.id, ...qproQp2Fields(r) });
    } catch (e) { siteErrors.push({ brand, siteId, message: e.message.split('\n')[0] }); }
  }));

  for (const { siteId, brand, region } of IGMP_SITES) {
    try {
      let pg = 1;
      while (true) {
        const d = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, { Status: 1 });
        const raw = d?.data;
        const list = Array.isArray(raw) ? raw : (raw?.data || raw?.List || raw?.list || []);
        if (!Array.isArray(list) || !list.length) break;
        for (const p of list) {
          if (p.IsActive) codes.push({
            platform: 'igmp', brand, code: p.PromotionCode, region, siteId,
            promotionId: p.PromotionId, promotionType: p.PromotionType,
            name: p.PromotionName, endDate: p.PromotionEndDate, isExpired: Boolean(p.IsExpired),
          });
        }
        if (list.length < 200) break;
        pg++;
      }
    } catch (e) { siteErrors.push({ brand: `${brand}/${region}`, siteId, message: e.message.split('\n')[0] }); }
  }

  return { codes, siteErrors };
}
