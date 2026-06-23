#!/usr/bin/env node
// FC blacklist fix earlier PUT qpro5 FC10/48/88/138 without preserving popups.
// Check current popup state on all 12 qpro5 FC codes.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const site = getSite('qpro5');
const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
const fcs = Object.values(r.data?.rows || {}).filter(p => /FT_TLEO_FC\d/.test(p.code || ''));
for (const p of fcs) {
  const dpl = p.dialog_popup_list;
  const linked = Array.isArray(dpl) && dpl.length > 0;
  console.log(`${p.code}: popup=${linked?'Y(id='+dpl[0].popup_id+')':'N'}`);
}
