// PUT-update the 10 QP2C saves to fix promo_type 1 → 2 (Deposit Bonus).
// QP2 mapper bug: previously defaulted Deposit promo_type to 1 which the
// BO renders as "Manual - Normal". Operator-saved Deposit promos all use 2.
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';
import { loadAllRequests } from '../src/planner.js';

const { byHandle } = await loadAllRequests();

const targets = [
  { rn: 'P075', handle: 'P075-r76', id: 1182, tmpl: 1047, popupId: 1133 },
  { rn: 'P076', handle: 'P076-r77', id: 1183, tmpl: 1048, popupId: 1134 },
  { rn: 'P077', handle: 'P077-r78', id: 1184, tmpl: 1049, popupId: 1135 },
  { rn: 'P078', handle: 'P078-r79', id: 1185, tmpl: 1050, popupId: 1136 },
  { rn: 'P079', handle: 'P079-r80', id: 1186, tmpl: 1051, popupId: 1137 },
  { rn: 'P080', handle: 'P080-r81', id: 1187, tmpl: 1052, popupId: 1138 },
  { rn: 'P081', handle: 'P081-r82', id: 1189, tmpl: 1054, popupId: 1139 },
  { rn: 'P082', handle: 'P082-r83', id: 1190, tmpl: 1055, popupId: 1140 },
  { rn: 'P083', handle: 'P083-r84', id: 1191, tmpl: 1056, popupId: 1141 },
  { rn: 'P084', handle: 'P084-r85', id: 1192, tmpl: 1057, popupId: 1142 },
];

const site = getSite('ibc22');

for (const t of targets) {
  const rec = byHandle.get(t.handle);
  if (!rec) { console.error(`${t.rn}: fixture not found`); continue; }
  try {
    // Fetch the existing popup row so we can re-link it through the PUT
    // without losing the popup link.
    const pres = await authedFetch(site, `/api/bo/popups?id=${t.popupId}&perPage=50`);
    const popupRow = (pres?.data?.rows || []).find(r => r.id === t.popupId);
    if (!popupRow) throw new Error(`popup ${t.popupId} not found (id filter ignored?)`);
    popupRow.label = rec.promotion_name_en;
    popupRow.fullRow = { ...popupRow };
    delete popupRow.fullRow.fullRow;

    const plan = await buildQp2Plan(rec, { brand: 'QP2C', site });
    const body = plan.buildUpdate(t.id, t.tmpl, popupRow);
    await updatePromotion(site, t.id, body);
    console.log(`${t.rn} id=${t.id} ✓ PUT (promo_type now ${body.promo_type})`);
  } catch (e) {
    console.log(`${t.rn} id=${t.id} ✗ ${e.message.split('\n')[0]}`);
  }
}
