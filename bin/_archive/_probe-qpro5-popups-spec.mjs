#!/usr/bin/env node
// Look up qpro5 popup spec for the 11 codes to clone to qpro3/4/10.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODES = [
  'FT_REL_TLEO_20PCT_200MX','FT_REL_TLEO_20PCT_20MX_BR','FT_REL_TLEO_45PCT_138MX','FT_REL_TLEO_45PCT_48MX',
  'FT_REL_TLEO_45PCT_888MX','FT_REL_TLEO_50PCT_25MX_LC','FT_REL_TLEO_50PCT_25MX_SLOT',
  'FT_REL_TLEO_LC_20PCT_20MX_BR','FT_REL_TLEO_LC_45PCT_138MX','FT_REL_TLEO_LC_45PCT_48MX','REL_TLEO_SL_20PCT_10MX',
];

const site = getSite('qpro5');
const labelToPopup = new Map();
for (let pg = 1; pg <= 6; pg++) {
  const pr = await authedFetch(site, `/api/bo/popups?perPage=300&page=${pg}`);
  const arr = Object.values(pr.data?.rows || {});
  if (!arr.length) break;
  arr.forEach(p => { if (p.label) labelToPopup.set(p.label, p); });
  if (arr.length < 300) break;
}
console.log(`qpro5 popups: ${labelToPopup.size}`);
for (const code of CODES) {
  const p = labelToPopup.get(code);
  if (!p) { console.log(`  ✗ ${code}: not on qpro5`); continue; }
  console.log(`  ✓ ${code}: id=${p.id}`);
}

// Dump full popup detail for first one
const sample = labelToPopup.get(CODES[0]);
if (sample) {
  const det = await authedFetch(site, `/api/bo/popups/${sample.id}`);
  const d = det.data?.rows || det.data;
  console.log('\n--- FULL POPUP DETAIL ---');
  console.log(JSON.stringify(d, null, 2).slice(0, 4000));
}
