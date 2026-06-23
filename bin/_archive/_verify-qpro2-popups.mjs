#!/usr/bin/env node
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const site = getSite('qpro2');
const hasPopup = p => { const d = p.dialog_popup_list; return Array.isArray(d) ? d.length > 0 : (d && Object.keys(d || {}).length > 0); };
const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
const tleo = Object.values(r.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
const linked = tleo.filter(hasPopup).length;
const unlinked = tleo.filter(p => !hasPopup(p));
console.log(`qpro2: ${linked}/${tleo.length} linked`);
if (unlinked.length) unlinked.forEach(p => console.log(`  ⚠ ${p.code}`));
