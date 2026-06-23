#!/usr/bin/env node
// Check popup state on the 3 canary codes on qpro16 + 3 untouched codes for control.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro16');
const CHECK = [
  ['canary', 'FT_TLEO_FC228_10X'],
  ['canary', 'FT_REL_TLEO_LC_45PCT_228MX'],
  ['canary', 'REL_TLEO_SL_20PCT_10MX'],
  ['untouched', 'FT_TLEO_FC10_10X'],
  ['untouched', 'FT_REL_TLEO_LC_45PCT_48MX'],
  ['untouched', 'FT_REL_TLEO_SLT_25PCT_300MX'],
];
for (const [tag, code] of CHECK) {
  const lr = await authedFetch(site, `/api/bo/promotion?code=${code}&perPage=5`);
  const lp = Object.values(lr.data?.rows || {}).find(p => p.code === code);
  if (!lp) { console.log(`${tag} ${code}: not found`); continue; }
  const det = (await authedFetch(site, `/api/bo/promotion/${lp.id}`)).data?.rows;
  const dList = lp.dialog_popup_list;
  const dDet = det.dialog_popup_list;
  console.log(`${tag} ${code}: list=${JSON.stringify(dList)} detail=${JSON.stringify(dDet)}`);
}
