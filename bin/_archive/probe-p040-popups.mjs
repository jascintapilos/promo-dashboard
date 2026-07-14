import { authedFetch } from '../../src/api-client.js';
import { getSite } from '../../src/sites.js';

const site = getSite('ibc22');
const PROMO_ID = 1353;
const CODE = 'WHALE_CRM_PROBE_20PCT_300_FTD_WIN_2';
const TITLE = '20% Live Casino Reload Bonus';

// Check what's currently linked on the promo
const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(CODE)}&perPage=10`);
const listRow = (listResp?.data?.rows || []).find(r => r.id === PROMO_ID);
const linked = listRow?.dialog_popup_list || [];
console.log(`Linked dialogs on promo ${PROMO_ID}: ${linked.length}`);
for (const d of linked) console.log(`  site_id=${d.site_id}  popup_id=${d.popup_id}`);

// Search popups listing for title match within the creation window
const cutoffStart = new Date('2026-07-09T00:00:00Z');
const cutoffEnd   = new Date('2026-07-15T23:59:59Z');

const popResp = await authedFetch(site, '/api/bo/popups?perPage=500&sort_by=id&sort_order=desc&page=1');
const allPopups = popResp?.data?.rows || [];
const matches = allPopups.filter(p => {
  if (!p.contents) return false;
  const titles = Object.values(p.contents).map(c => c?.title || '');
  const hasTitle = titles.some(t => t === TITLE);
  const created = new Date(p.created_at);
  return hasTitle && created >= cutoffStart && created <= cutoffEnd;
});

console.log(`\nPopups matching title "${TITLE}" (Jul 9-15):`);
if (!matches.length) {
  console.log('  None found');
} else {
  for (const p of matches.sort((a,b) => a.id - b.id)) {
    console.log(`  id=${p.id}  site_id=${p.site_id}  created=${p.created_at}`);
  }
}
