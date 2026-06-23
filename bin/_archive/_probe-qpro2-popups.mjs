#!/usr/bin/env node
// Look up qpro2 popup records for the 11 codes — confirm they exist as templates.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODES = [
  'FT_REL_TLEO_20PCT_200MX','FT_REL_TLEO_20PCT_20MX_BR','FT_REL_TLEO_45PCT_138MX','FT_REL_TLEO_45PCT_48MX',
  'FT_REL_TLEO_45PCT_888MX','FT_REL_TLEO_50PCT_25MX_LC','FT_REL_TLEO_50PCT_25MX_SLOT',
  'FT_REL_TLEO_LC_20PCT_20MX_BR','FT_REL_TLEO_LC_45PCT_138MX','FT_REL_TLEO_LC_45PCT_48MX','REL_TLEO_SL_20PCT_10MX',
];

const site = getSite('qpro2');
const labelToPopup = new Map();
const codeToPopup = new Map();
for (let pg = 1; pg <= 6; pg++) {
  const pr = await authedFetch(site, `/api/bo/popups?perPage=300&page=${pg}`);
  const arr = Object.values(pr.data?.rows || {});
  if (!arr.length) break;
  arr.forEach(p => { if (p.label) labelToPopup.set(p.label, p); if (p.code) codeToPopup.set(p.code, p); });
  if (arr.length < 300) break;
}
console.log(`qpro2 popups loaded: ${labelToPopup.size} (by label) ${codeToPopup.size} (by code)`);
for (const code of CODES) {
  const byLabel = labelToPopup.get(code);
  const byCode  = codeToPopup.get(code);
  const hit = byLabel || byCode;
  if (!hit) { console.log(`  ✗ ${code}: not on qpro2 either`); continue; }
  console.log(`  ✓ ${code}: id=${hit.id} code=${hit.code} label=${hit.label} session=${hit.session} status=${hit.status}`);
}

// Also dump one full popup to see the fields we need to clone
const sample = labelToPopup.get(CODES[0]) || codeToPopup.get(CODES[0]);
if (sample) {
  const det = await authedFetch(site, `/api/bo/popups/${sample.id}`);
  const d = det.data?.rows || det.data;
  console.log('\nSample full popup:\n' + JSON.stringify(d, null, 2).slice(0, 2400));
}
