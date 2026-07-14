#!/usr/bin/env node
// Relink QP2 dialog popups to the CORRECT per-merchant popups.
//
// WHY: On the shared IBC22 BO, dialog_popup_list links popups by site_id.
// When the multi-merchant canary attaches merchants incrementally (QP2A
// creates, QP2B/C/D extend), the BO matches the non-last merchants' links to
// STALE popups that share the same site_id (e.g. a prior campaign's popups),
// instead of the freshly-created ones. Only the last merchant (whose site_id
// has no stale popup) links correctly. The fix — validated 2026-06-15 — is to
// PUT all N correct popup full-rows together in a single dialog_popup_list.
//
// This helper finds, per merchant site_id, the popup created THIS run for the
// promo (matched by title == promotion_name_en AND created within a window of
// the promotion's own created_at, newest wins) and re-PUTs the complete list.
//
// Usage:
//   node bin/relink-qp2-dialogs.mjs <P###|handle> [--commit]
//
// Idempotent: re-running with correct links already in place is a no-op PUT.

import { parseArgs } from './_args.js';
import { authedFetch, findPromotionByCode, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { loadAllRequests, resolveDuplicates, resolveHandle } from '../src/planner.js';
import { getPopups } from '../src/qp2-popup-registry.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
const commit = flags.commit === true;
if (!userInput) {
  console.error('usage: relink-qp2-dialogs.mjs <P###|handle> [--commit]');
  process.exit(2);
}

const WINDOW_MS = 180_000; // popups for one promo are created within ~45s; 180s is safe headroom

const { byHandle, byId, byCode } = await loadAllRequests();
const handle = resolveHandle(userInput, { byHandle, byId });
if (!handle) { console.error(`request "${userInput}" not found`); process.exit(2); }
const request = byHandle.get(handle);
const resolved = await resolveDuplicates(request, byCode, {});

// When promo_code is a dual-format "QPRO, WS1, WS2: X\nQP2: Y", extract the QP2 code.
// The dual-format is written to col W when QPRO/WS and QP2 have different codes.
function extractQp2Code(raw) {
  const m = String(raw || '').match(/^QP2:\s*(.+)$/m);
  if (m) return m[1].trim();
  // Multi-line without QP2: prefix (e.g. "CODE\nCODE_V2 (QPRO1)") — QP2 always uses line 1.
  return String(raw || '').split('\n')[0].trim();
}
const code = extractQp2Code(resolved.promo_code);
// Stamp the extracted code so buildApiPlan / buildUpdate send the right code to BO.
if (code !== resolved.promo_code) {
  resolved.promo_code = code;
  console.log(`(dual-format promo_code → using QP2 code: ${code})`);
}
// Strip WS1/WS2 dual-name suffix from promotion_name_en for heuristic matching.
// The popup title is the single-line generic name; strip "\nWS1/WS2: ..." suffix.
const titleEn = String(resolved.promotion_name_en || '').split('\n')[0].trim();

const site = getSite('ibc22');

const promo = await findPromotionByCode(site, code);
if (!promo) { console.error(`promo "${code}" not found on ibc22`); process.exit(3); }

// merchant_ids currently attached (these are the sites needing a dialog link).
const detail = (await authedFetch(site, `/api/bo/promotion/${promo.id}`)).data.rows;
const merchantIds = (detail.merchant_ids || []).map((m) => (typeof m === 'object' ? m.id : m));
const templateId = detail.message_template_id || 0;

// Primary source: the deterministic registry written by canary-api-qp2.js at
// popup-create time ({ site -> popup_id }). Fallback (older promos created
// before the registry existed): heuristic match by title + creation window.
const registry = getPopups(code); // { siteId: popupId }
const usingRegistry = Object.keys(registry).length > 0;

const promoCreated = new Date(promo.created_at).getTime();
// Fetch enough pages to cover all popup IDs in the registry + recency window.
// perPage=500 descending covers the ~500 most recent IDs; if registry IDs
// fall outside that range, a second page is fetched.
const pr1 = await authedFetch(site, `/api/bo/popups?perPage=500&sort_by=id&sort_order=desc&page=1`);
const allRows = [...(pr1?.data?.rows || [])];
// If registry IDs are older than the last 500, fetch page 2 as well.
const regIds = Object.values(registry).map(Number);
const minFetched = allRows.length ? Math.min(...allRows.map((p) => p.id)) : Infinity;
if (regIds.length && Math.min(...regIds) < minFetched) {
  const pr2 = await authedFetch(site, `/api/bo/popups?perPage=500&sort_by=id&sort_order=desc&page=2`);
  allRows.push(...(pr2?.data?.rows || []));
}
const popupById = Object.fromEntries(allRows.map((p) => [p.id, p]));
const titleOf = (p) => ((p.contents || []).find((c) => c.locale_id === 1) || (p.contents || [])[0])?.title;

const bySite = {};
if (usingRegistry) {
  for (const [sid, pid] of Object.entries(registry)) {
    if (popupById[pid]) bySite[Number(sid)] = popupById[pid];
  }
}
// Heuristic fill for any site the registry didn't cover.
const heuristic = allRows.filter((p) => {
  if (titleOf(p) !== titleEn) return false;
  const t = new Date(p.created_at).getTime();
  return t >= promoCreated - 5000 && t <= promoCreated + WINDOW_MS;
});
for (const p of heuristic.sort((a, b) => a.id - b.id)) {
  if (!bySite[p.site_id]) bySite[p.site_id] = p; // registry wins; else newest-in-window
}
console.log(`  popup source: ${usingRegistry ? 'registry' : 'heuristic (no registry entries)'}`);
const popupForSite = (sid) => bySite[sid];

console.log(`Relink ${code} (promo ${promo.id}) — merchants [${merchantIds.join(',')}], title="${titleEn}"`);
const dl = {};
let i = 0, missing = [];
for (const sid of merchantIds.sort((a, b) => a - b)) {
  const p = popupForSite(sid);
  if (!p) { missing.push(sid); continue; }
  dl[String(i++)] = { ...p, promotion_id: promo.id };
  console.log(`  site ${sid} -> popup ${p.id} (created ${p.created_at?.slice(11, 19)})`);
}
if (missing.length) {
  console.error(`  ⚠ no matching popup found for site_id(s): ${missing.join(',')} — relink skipped for those`);
}
if (Object.keys(dl).length === 0) { console.error('  no popups to link — aborting'); process.exit(4); }

if (!commit) { console.log('DRY-RUN — add --commit to PUT'); process.exit(0); }

const plan = await buildApiPlan(resolved, { brand: 'QP2A', site, merchantIds });
const putBody = plan.buildUpdate(promo.id, templateId, null);
const mObj = {}; merchantIds.forEach((id, idx) => { mObj[String(idx)] = id; });
putBody.merchant_ids = mObj;
putBody.dialog_popup_list = dl;

await updatePromotion(site, promo.id, putBody);

// Verify
const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
const lr = (listResp.data?.rows || []).find((r) => r.id === promo.id);
const links = (lr?.dialog_popup_list || []).sort((a, b) => a.site_id - b.site_id)
  .map((d) => `s${d.site_id}->${d.popup_id}`).join(' ');
console.log(`✓ Relinked. Now: ${links}`);
