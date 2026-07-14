#!/usr/bin/env node
// Link SMS message templates for 17 WHALE_CRM_PROBE QP2 promos.
// Preserves current BO state: cats, providers, inbox MT, dialog_popup_list.
//
//   88% promos → sms_mt=1320 (SMS WHALE_CRM_PROBE_88PCT_RELOAD)
//   20% promos → sms_mt=1321 (SMS WHALE_CRM_PROBE_20PCT_RELOAD)
//
// Usage:
//   node bin/_archive/fix-p026-p046-sms-link.mjs           # dry-run
//   node bin/_archive/fix-p026-p046-sms-link.mjs --commit  # live

import { authedFetch, updatePromotion } from '../../src/api-client.js';
import { buildApiPlan } from '../../src/api-mapper-qp2.js';
import { getSite } from '../../src/sites.js';
import { loadAllRequests, resolveDuplicates } from '../../src/planner.js';

const commit = process.argv.includes('--commit');

const PROMOS = [
  // 88% Slots → SMS WHALE_CRM_PROBE_88PCT_RELOAD (id=1320)
  { handle: 'P026-r27', promoId: 1345, smsMtId: 1320 },
  { handle: 'P027-r28', promoId: 1346, smsMtId: 1320 },
  { handle: 'P028-r29', promoId: 1347, smsMtId: 1320 },
  { handle: 'P029-r30', promoId: 1348, smsMtId: 1320 },
  { handle: 'P041-r42', promoId: 1354, smsMtId: 1320 },
  { handle: 'P042-r43', promoId: 1355, smsMtId: 1320 },
  { handle: 'P043-r44', promoId: 1356, smsMtId: 1320 },
  // 20% LC → SMS WHALE_CRM_PROBE_20PCT_RELOAD (id=1321)
  { handle: 'P034-r35', promoId: 1363, smsMtId: 1321 },
  { handle: 'P035-r36', promoId: 1364, smsMtId: 1321 },
  { handle: 'P036-r37', promoId: 1349, smsMtId: 1321 },
  { handle: 'P037-r38', promoId: 1350, smsMtId: 1321 },
  { handle: 'P038-r39', promoId: 1351, smsMtId: 1321 },
  { handle: 'P039-r40', promoId: 1352, smsMtId: 1321 },
  { handle: 'P040-r41', promoId: 1353, smsMtId: 1321 },
  { handle: 'P044-r45', promoId: 1357, smsMtId: 1321 },
  { handle: 'P045-r46', promoId: 1358, smsMtId: 1321 },
  { handle: 'P046-r47', promoId: 1359, smsMtId: 1321 },
];

// Provider constants (same filtered set applied by fix-p026-p046-cats-providers.mjs)
// 49 entries: all 53 QP2A providers minus PNG(31), PP(34), SBO(40), YL(52)
const EXCLUDE_PROV = new Set([31, 34, 40, 52]);
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
const filteredTargetCodes = {};
const filteredPutIds = {};
let pi = 0;
for (let i = 0; i <= 52; i++) {
  if (!EXCLUDE_PROV.has(i)) { filteredTargetCodes[String(pi)] = TARGET_CODES_ALL[String(i)]; filteredPutIds[String(pi)] = PUT_IDS_ALL[String(i)]; pi++; }
}

const site = getSite('ibc22');
const { byHandle, byCode } = await loadAllRequests();

for (const promo of PROMOS) {
  console.log(`\n── ${promo.handle} (promo_id=${promo.promoId}, sms_mt→${promo.smsMtId}) ──`);
  const request = byHandle.get(promo.handle);
  if (!request) { console.error(`  Request not found`); continue; }
  const resolved = await resolveDuplicates(request, byCode, {});

  // Get listing for dialog_popup_list
  const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(resolved.promo_code)}&perPage=10`);
  const listRow = (listResp?.data?.rows || []).find(r => r.id === promo.promoId);
  const dialogList = listRow?.dialog_popup_list || [];

  // Get detail for current cats, providers, template IDs, merchant_ids
  const detail = (await authedFetch(site, `/api/bo/promotion/${promo.promoId}`)).data.rows;
  const templateId  = detail.message_template_id || 0;
  const currentSmsId = detail.message_template_sms_id || 0;
  const merchantIds = (detail.merchant_ids || []).map(m => typeof m === 'object' ? m.id : m);
  const currentCats = (detail.promotion_category_ids || []).map(Number);

  console.log(`  mt=${templateId}  sms_mt_current=${currentSmsId || '(none)'}  cats=[${currentCats.join(',')}]  dialogs=${dialogList.length}`);

  if (currentSmsId === promo.smsMtId) {
    console.log(`  Already linked — skipping`);
    continue;
  }

  if (!commit) {
    console.log(`  [DRY] Would PUT: sms_mt=${promo.smsMtId}, preserve mt=${templateId}, cats=[${currentCats.join(',')}], dialogs=${dialogList.length}`);
    continue;
  }

  // Build PUT body — mapper handles bonus_rate, TO, validity, member_group_ids, etc.
  const plan = await buildApiPlan(resolved, { brand: 'QP2A', site, merchantIds });
  const putBody = plan.buildUpdate(promo.promoId, templateId, null);

  // Preserve current BO categories (do not let mapper override with categories_only)
  if (currentCats.length > 0) {
    const catsObj = {};
    currentCats.forEach((c, i) => { catsObj[String(i)] = c; });
    putBody.promotion_category_ids = catsObj;
  }

  // Preserve current provider set (re-apply same filtered 49-entry set from previous fix)
  putBody.game_provider_codes = filteredPutIds;
  if (putBody.target) putBody.target.game_provider_codes = filteredTargetCodes;

  // Preserve merchant_ids
  const mObj = {};
  merchantIds.forEach((id, i) => { mObj[String(i)] = id; });
  putBody.merchant_ids = mObj;

  // Preserve dialog_popup_list (fetch full popup rows)
  if (dialogList.length > 0) {
    const popResp = await authedFetch(site, '/api/bo/popups?perPage=500&sort_by=id&sort_order=desc&page=1');
    const allPopups = popResp?.data?.rows || [];
    const dl = {};
    for (const link of dialogList) {
      const fullRow = allPopups.find(p => p.id === link.popup_id);
      dl[String(Object.keys(dl).length)] = fullRow
        ? { ...fullRow, promotion_id: promo.promoId }
        : { ...link,    promotion_id: promo.promoId };
    }
    putBody.dialog_popup_list = dl;
  }

  // Set SMS MT
  putBody.message_template_sms_id = promo.smsMtId;

  console.log(`  PUT /api/bo/promotion/${promo.promoId}  sms_mt=${promo.smsMtId}  dialogs=${Object.keys(putBody.dialog_popup_list || {}).length}`);
  await updatePromotion(site, promo.promoId, putBody);

  // Verify via detail endpoint (listing omits sms_mt)
  const ver = (await authedFetch(site, `/api/bo/promotion/${promo.promoId}`)).data.rows;
  const verMt    = ver.message_template_id || 0;
  const verSmsMt = ver.message_template_sms_id || 0;
  const verListResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(resolved.promo_code)}&perPage=10`);
  const verListRow = (verListResp?.data?.rows || []).find(r => r.id === promo.promoId);
  const verDialogs = (verListRow?.dialog_popup_list || []).length;
  const ok = verMt === templateId && verSmsMt === promo.smsMtId && verDialogs === dialogList.length;
  console.log(`  ${ok ? '✓' : '✗'} mt=${verMt}  sms_mt=${verSmsMt}  dialogs=${verDialogs}`);
  if (!ok) {
    if (verMt !== templateId) console.warn(`    WARN: inbox MT changed ${templateId}→${verMt}`);
    if (verSmsMt !== promo.smsMtId) console.warn(`    WARN: sms_mt not set (got ${verSmsMt})`);
    if (verDialogs !== dialogList.length) console.warn(`    WARN: dialogs ${dialogList.length}→${verDialogs}`);
  }
}

console.log('\nDone.' + (commit ? '' : ' Run with --commit to execute.'));
