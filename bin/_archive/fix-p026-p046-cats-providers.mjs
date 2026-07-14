#!/usr/bin/env node
// Fix all 21 WHALE_CRM_PROBE QP2 promos (P026-P046):
//   1. Categories: remove LOTTERY (ID 6) and TABLE (ID 10) — affects 8 promos
//   2. Providers: reset to all 49 (remove PNG, PP, SBO, YL) — affects all 21
//
// Existing dialog_popup_list and merchant_ids are preserved.
//
// Usage:
//   node bin/_archive/fix-p026-p046-cats-providers.mjs           # dry-run
//   node bin/_archive/fix-p026-p046-cats-providers.mjs --commit  # live

import { authedFetch, updatePromotion } from '../../src/api-client.js';
import { buildApiPlan } from '../../src/api-mapper-qp2.js';
import { getSite } from '../../src/sites.js';
import { loadAllRequests, resolveDuplicates } from '../../src/planner.js';

const commit = process.argv.includes('--commit');

const HANDLES = [
  'P026-r27', 'P027-r28', 'P028-r29', 'P029-r30',
  'P030-r31', 'P031-r32', 'P032-r33', 'P033-r34',
  'P034-r35', 'P035-r36', 'P036-r37', 'P037-r38',
  'P038-r39', 'P039-r40', 'P040-r41', 'P041-r42',
  'P042-r43', 'P043-r44', 'P044-r45', 'P045-r46',
  'P046-r47',
];

// Category IDs to remove: LOTTERY=6, TABLE=10
const REMOVE_CAT_IDS = new Set([6, 10]);

// Provider indices to exclude from the 53-entry catalog:
// PNG=31, PP=34, SBO=40, YL=52
// (918KAYA, ALLBET, DREAM GAMING, HABANERO, KINGMIDAS, SSG not in QP2 catalog)
const EXCLUDE_PROV_INDICES = new Set([31, 34, 40, 52]);

// QP2A full provider catalog (53 entries from api-mapper-qp2.js)
const TARGET_CODES_ALL = {
  '0': '365G', '1': '9W', '2': 'AP', '3': 'AVI', '4': 'BG', '5': 'BOOM',
  '6': 'BNG', '7': 'BTG', '8': 'CMD', '9': 'CQ9', '10': 'EVOK', '11': 'EZ',
  '12': 'FS', '13': 'FP', '14': 'FC', '15': 'GXW', '16': 'HSG', '17': 'IM',
  '18': '2BC', '19': 'JDB', '20': 'JILI', '21': 'JK', '22': 'KA', '23': 'LIVE',
  '24': 'LUCKY', '25': 'MAHA', '26': 'MGP', '27': 'MONKEY', '28': 'NET2',
  '29': 'NEXT', '30': 'NLC', '31': 'PNG', '32': 'AG', '33': 'PTI', '34': 'PP',
  '35': 'PP2', '36': 'RT2', '37': 'RG', '38': 'SA', '39': 'MAX', '40': 'SBO',
  '41': 'SBO2', '42': 'SEXY', '43': 'SIMPLE', '44': 'SG', '45': 'SPRIBE',
  '46': 'TF', '47': 'VIVO', '48': 'WBET', '49': 'WM', '50': 'XE', '51': 'YB',
  '52': 'YL',
};
const PUT_IDS_ALL = {
  '0': 178, '1': 139, '2': 341, '3': 196, '4': 15, '5': 268, '6': 328, '7': 292,
  '8': 18, '9': 14, '10': 320, '11': 25, '12': 122, '13': 304, '14': 184, '15': 324,
  '16': 197, '17': 23, '18': 312, '19': 110, '20': 111, '21': 7, '22': 190, '23': 21,
  '24': 284, '25': 313, '26': 203, '27': 274, '28': 256, '29': 22, '30': 257, '31': 17,
  '32': 1, '33': 308, '34': 35, '35': 345, '36': 258, '37': 349, '38': 13, '39': 8,
  '40': 34, '41': 353, '42': 31, '43': 10, '44': 9, '45': 187, '46': 117, '47': 332,
  '48': 72, '49': 37, '50': 33, '51': 297, '52': 36,
};

// Build filtered provider sets (49 entries, re-indexed 0-48)
const filteredTargetCodes = {};
const filteredPutIds = {};
let provIdx = 0;
for (let i = 0; i <= 52; i++) {
  if (!EXCLUDE_PROV_INDICES.has(i)) {
    filteredTargetCodes[String(provIdx)] = TARGET_CODES_ALL[String(i)];
    filteredPutIds[String(provIdx)] = PUT_IDS_ALL[String(i)];
    provIdx++;
  }
}
console.log(`Filtered providers: ${provIdx} entries (removed PNG/PP/SBO/YL)\n`);

const site = getSite('ibc22');
const { byHandle, byCode } = await loadAllRequests();

let changed = 0, skipped = 0, errors = 0;

for (const handle of HANDLES) {
  console.log(`── ${handle} ──`);
  const request = byHandle.get(handle);
  if (!request) {
    console.error(`  Request not found — skipping`);
    errors++;
    continue;
  }

  const resolved = await resolveDuplicates(request, byCode, {});
  const qp2Code = resolved.promo_code;
  console.log(`  code: ${qp2Code}`);

  // Probe BO for current state via listing (contains dialog_popup_list + cats)
  const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(qp2Code)}&perPage=10`);
  const listRow = (listResp?.data?.rows || []).find(r => !r.deleted_at);
  if (!listRow) {
    console.error(`  Not found on BO — skipping`);
    errors++;
    continue;
  }

  const promoId = listRow.id;
  const dialogList = listRow.dialog_popup_list || [];

  // Listing endpoint omits promotion_category_ids and game_provider_codes —
  // fetch detail to get current values.
  const detail = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
  const templateId = detail.message_template_id || 0;
  const merchantIds = (detail.merchant_ids || []).map(m => typeof m === 'object' ? m.id : m);
  const currentCats = (detail.promotion_category_ids || []).map(Number);
  const currentGPCount = (detail.game_provider_codes || []).length;

  // Determine new categories (remove LOTTERY=6 and TABLE=10)
  const newCats = currentCats.filter(c => !REMOVE_CAT_IDS.has(c));
  const removedCats = currentCats.filter(c => REMOVE_CAT_IDS.has(c));
  const catsChanged = removedCats.length > 0;

  console.log(`  promo_id=${promoId}  cats=[${currentCats.join(',')}]  gp=${currentGPCount}  dialogs=${dialogList.length}`);
  if (catsChanged) {
    console.log(`  cats: remove [${removedCats.join(',')}] → new [${newCats.join(',')}]`);
  } else {
    console.log(`  cats: OK (no LOTTERY/TABLE present)`);
  }
  console.log(`  providers: ${currentGPCount} → 49 (remove PNG/PP/SBO/YL)`);

  if (!commit) {
    console.log(`  [DRY] Would PUT /api/bo/promotion/${promoId}\n`);
    continue;
  }

  // Build PUT body via mapper (handles bonus_rate, TO, currency blocks, member groups, etc.)
  const plan = await buildApiPlan(resolved, { brand: 'QP2A', site, merchantIds });
  const putBody = plan.buildUpdate(promoId, templateId, null);

  // Override 1: categories (current BO cats minus LOTTERY/TABLE)
  if (newCats.length > 0) {
    const catsObj = {};
    newCats.forEach((c, i) => { catsObj[String(i)] = c; });
    putBody.promotion_category_ids = catsObj;
  }

  // Override 2: game providers (49 filtered entries)
  putBody.game_provider_codes = filteredPutIds;
  if (putBody.target) {
    putBody.target.game_provider_codes = filteredTargetCodes;
  }

  // Preserve merchant_ids (all 4 merchants currently attached)
  const mObj = {};
  merchantIds.forEach((id, i) => { mObj[String(i)] = id; });
  putBody.merchant_ids = mObj;

  // Preserve dialog_popup_list — fetch full popup rows to match PUT shape
  if (dialogList.length > 0) {
    const popupsResp = await authedFetch(site, '/api/bo/popups?perPage=500&sort_by=id&sort_order=desc&page=1');
    const allPopups = popupsResp?.data?.rows || [];
    const dl = {};
    for (const link of dialogList) {
      const popupId = link.popup_id;
      const fullRow = allPopups.find(p => p.id === popupId);
      dl[String(Object.keys(dl).length)] = fullRow
        ? { ...fullRow, promotion_id: promoId }
        : { ...link, promotion_id: promoId }; // fallback if not found in listing
    }
    putBody.dialog_popup_list = dl;
  }

  console.log(`  PUT /api/bo/promotion/${promoId}  cats=[${newCats.join(',')}]  providers=49  dialogs=${Object.keys(putBody.dialog_popup_list || {}).length}`);
  await updatePromotion(site, promoId, putBody);

  // Verify
  const verResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(qp2Code)}&perPage=10`);
  const vr = (verResp?.data?.rows || []).find(r => !r.deleted_at);
  const verCats = (vr?.promotion_category_ids || []).map(Number).sort((a, b) => a - b);
  const verGP = (vr?.game_provider_codes || []).length;
  const verDialogs = (vr?.dialog_popup_list || []).length;
  const catsOK = !verCats.some(c => REMOVE_CAT_IDS.has(c)) && verCats.length === newCats.length;
  const gpOK = verGP === 49;
  console.log(`  ${catsOK && gpOK ? '✓' : '✗'} cats=[${verCats.join(',')}]  gp=${verGP}  dialogs=${verDialogs}`);
  if (!catsOK) console.warn(`    WARN: expected ${newCats.length} cats, got ${verCats.length}; or LOTTERY/TABLE still present`);
  if (!gpOK)   console.warn(`    WARN: expected 49 providers, got ${verGP}`);

  changed++;
  console.log();
}

console.log(`\n${'─'.repeat(40)}`);
console.log(`Changed: ${changed}  Skipped: ${skipped}  Errors: ${errors}`);
console.log(commit ? 'Done.' : 'Dry-run complete. Run with --commit to execute.');
