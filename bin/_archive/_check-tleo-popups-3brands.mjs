#!/usr/bin/env node
// Check popup link status on 11 affected codes across qpro3/4/10.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRANDS = ['qpro3', 'qpro4', 'qpro10'];
const CODES = [
  'FT_REL_TLEO_20PCT_200MX',
  'FT_REL_TLEO_20PCT_20MX_BR',
  'FT_REL_TLEO_45PCT_138MX',
  'FT_REL_TLEO_45PCT_48MX',
  'FT_REL_TLEO_45PCT_888MX',
  'FT_REL_TLEO_50PCT_25MX_LC',
  'FT_REL_TLEO_50PCT_25MX_SLOT',
  'FT_REL_TLEO_LC_20PCT_20MX_BR',
  'FT_REL_TLEO_LC_45PCT_138MX',
  'FT_REL_TLEO_LC_45PCT_48MX',
  'REL_TLEO_SL_20PCT_10MX',
];

const hasPopup = p => { const d = p.dialog_popup_list; return Array.isArray(d) ? d.length > 0 : (d && Object.keys(d || {}).length > 0); };

for (const brand of BRANDS) {
  const site = getSite(brand);
  console.log(`\n━━━ ${brand.toUpperCase()} ━━━`);
  // load brand popups by label for cross-check
  const labelToPopup = new Map();
  for (let pg = 1; pg <= 6; pg++) {
    const pr = await authedFetch(site, `/api/bo/popups?perPage=300&page=${pg}`);
    const arr = Object.values(pr.data?.rows || {});
    if (!arr.length) break;
    arr.forEach(p => { if (p.label) labelToPopup.set(p.label, p); });
    if (arr.length < 300) break;
  }
  let linked = 0, unlinked = 0, missing = 0, noPopupRecord = 0;
  for (const code of CODES) {
    const lr = await authedFetch(site, `/api/bo/promotion?code=${code}&perPage=5`);
    const lp = Object.values(lr.data?.rows || {}).find(p => p.code === code);
    if (!lp) { console.log(`  ⊘ ${code}: NOT FOUND on ${brand}`); missing++; continue; }
    const has = hasPopup(lp);
    const pop = labelToPopup.get(code);
    if (has) { console.log(`  ✓ ${code}: linked`); linked++; }
    else if (pop) { console.log(`  ⚠ ${code}: popup ${pop.id} exists, NOT linked`); unlinked++; }
    else { console.log(`  ✗ ${code}: no popup record found by label`); noPopupRecord++; }
  }
  console.log(`  Summary: linked=${linked} unlinked=${unlinked} missing-code=${missing} no-popup-record=${noPopupRecord}`);
}
