#!/usr/bin/env node
// Diff MT subjects per locale: qpro5 (canonical) vs qpro3/4/10 for the 11 codes.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const TARGETS = ['qpro3', 'qpro4', 'qpro10'];
const CANONICAL = 'qpro5';
const CODES = [
  'FT_REL_TLEO_20PCT_200MX','FT_REL_TLEO_20PCT_20MX_BR','FT_REL_TLEO_45PCT_138MX','FT_REL_TLEO_45PCT_48MX',
  'FT_REL_TLEO_45PCT_888MX','FT_REL_TLEO_50PCT_25MX_LC','FT_REL_TLEO_50PCT_25MX_SLOT',
  'FT_REL_TLEO_LC_20PCT_20MX_BR','FT_REL_TLEO_LC_45PCT_138MX','FT_REL_TLEO_LC_45PCT_48MX','REL_TLEO_SL_20PCT_10MX',
];

// MY_EN=1, MY_ZH=3, SG_EN=6, SG_ZH=7
const LOCALES = { 1: 'MY_EN', 3: 'MY_ZH', 6: 'SG_EN', 7: 'SG_ZH' };

async function getMtForCode(site, code) {
  const lr = await authedFetch(site, `/api/bo/promotion?code=${code}&perPage=5`);
  const lp = Object.values(lr.data?.rows || {}).find(p => p.code === code);
  if (!lp || !lp.message_template_id) return null;
  const im = await authedFetch(site, `/api/bo/messagetemplate/${lp.message_template_id}`);
  const details = im.data?.message_details || {};
  const subjByLocale = {};
  for (const d of Object.values(details)) {
    const lid = Number(d.settings_locale_id);
    subjByLocale[lid] = { subject: d.subject || '', message: d.message || '' };
  }
  return { mtId: lp.message_template_id, byLocale: subjByLocale };
}

const canon = {};
const csite = getSite(CANONICAL);
for (const code of CODES) {
  canon[code] = await getMtForCode(csite, code);
}

for (const brand of TARGETS) {
  const site = getSite(brand);
  console.log(`\n━━━ ${brand.toUpperCase()} vs ${CANONICAL.toUpperCase()} ━━━`);
  for (const code of CODES) {
    const tgt = await getMtForCode(site, code);
    if (!tgt) { console.log(`  ⊘ ${code}: not found`); continue; }
    const c = canon[code];
    if (!c) { console.log(`  ⊘ ${code}: not in canonical`); continue; }
    let issues = [];
    for (const lid of Object.keys(LOCALES)) {
      const ts = tgt.byLocale[lid]?.subject || '';
      const cs = c.byLocale[lid]?.subject || '';
      if (!cs) continue;
      if (ts !== cs) {
        const note = ts === 'Exclusive Offer' ? 'BARE' : (ts === '' ? 'EMPTY' : 'DIFF');
        issues.push(`${LOCALES[lid]}=${note}`);
      }
    }
    if (issues.length) console.log(`  ⚠ ${code} (mt=${tgt.mtId}): ${issues.join(', ')}`);
    else console.log(`  ✓ ${code}: subjects match canonical`);
  }
}
