import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { loadAllRequests } from '../src/planner.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN]\n');

const s = getSite('qpro6');
const PROMO_ID = 469;
const POPUP_ID = 240;

// Find popup 240 in the list
const pl = await authedFetch(s, `/api/bo/popups?perPage=50&page=1`);
const popup240 = pl?.data?.rows?.find(r => r.id === POPUP_ID);
if (!popup240) { console.log('Popup 240 not found on page 1'); process.exit(1); }
console.log('Found popup 240:', JSON.stringify({ id: popup240.id, code: popup240.code, label: popup240.label, start_date: popup240.start_date }));

// Verify dialog is still unlinked
const listR = await authedFetch(s, `/api/bo/promotion?code=FT_88FS_10X_040_GOO`);
const row = listR?.data?.rows?.[0];
console.log('Current dialog_popup_list:', JSON.stringify(row?.dialog_popup_list));
const templateId = row?.message_template_id;

const { byHandle } = await loadAllRequests();
const rec = byHandle.get('P001-r2');
const plan = await buildApiPlan(rec, { brand: 'QPRO6', site: s });

const dialogPopup = {
  id: popup240.id,
  code: popup240.code,
  start_date: popup240.start_date,
  label: rec.promotion_name_en,
};

const putBody = plan.buildUpdate(PROMO_ID, templateId || 0, dialogPopup);
console.log('\ndialog_popup_list in PUT body:', JSON.stringify(putBody.dialog_popup_list));

if (DRY_RUN) {
  console.log('[DRY RUN] Would restore dialog popup linkage');
} else {
  const res = await authedFetch(s, `/api/bo/promotion/${PROMO_ID}`, { method: 'PUT', body: putBody });
  console.log('PUT result:', res?.success, res?.message);

  // Verify
  const r2 = await authedFetch(s, `/api/bo/promotion?code=FT_88FS_10X_040_GOO`);
  console.log('After restore dialog_popup_list:', JSON.stringify(r2?.data?.rows?.[0]?.dialog_popup_list));
}
