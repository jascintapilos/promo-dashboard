#!/usr/bin/env node
// Probe raw HTML of a few specific message templates to understand structure for patching

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

// Fetch all TLEO promos and find specific codes
async function fetchTleo(site) {
  let all = [], page = 1;
  while (true) {
    const res = await authedFetch(site, `/api/bo/promotion?code=FT_REL_TLEO&perPage=100&page=${page}`);
    const rows = res.data?.rows || [];
    all.push(...rows);
    if (rows.length < 100) break;
    page++;
  }
  return all;
}

async function getFullMt(site, mtId) {
  const mt = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
  return mt.data;
}

// Probe qpro2 — wrong all-games code: FT_REL_TLEO_45PCT_228MX
// Probe qpro2 — OK LC code: FT_REL_TLEO_LC_45PCT_228MX
// Probe qpro3 — missing LC code: FT_REL_TLEO_LC_45PCT_228MX

const PROBES = [
  { siteId: 'qpro2', code: 'FT_REL_TLEO_45PCT_228MX',    label: 'QPRO2 wrong all-games' },
  { siteId: 'qpro2', code: 'FT_REL_TLEO_LC_45PCT_228MX', label: 'QPRO2 OK LC (reference)' },
  { siteId: 'qpro3', code: 'FT_REL_TLEO_LC_45PCT_228MX', label: 'QPRO3 missing LC' },
  { siteId: 'ibc22', code: 'FT_REL_TLEO_45PCT_228MX',    label: 'QP2 wrong all-games' },
  { siteId: 'ibc22', code: 'FT_REL_TLEO_50PCT_25MX_LC',  label: 'QP2 wrong LC (says Slot)' },
];

for (const probe of PROBES) {
  const site = getSite(probe.siteId);
  const promos = await fetchTleo(site);
  const promo = promos.find(p => p.code === probe.code);
  if (!promo) { console.log(`\n=== ${probe.label} — NOT FOUND ===`); continue; }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`=== ${probe.label} ===`);
  console.log(`    code=${promo.code}  pid=${promo.id}  mtId=${promo.message_template_id}`);
  console.log('='.repeat(80));

  if (!promo.message_template_id) { console.log('  NO MESSAGE TEMPLATE'); continue; }

  const mt = await getFullMt(site, promo.message_template_id);
  const locales = { '1': 'MY_EN', '3': 'MY_ZH', '6': 'SG_EN', '7': 'SG_ZH' };

  for (const [locId, locLabel] of Object.entries(locales)) {
    const detail = mt.message_details?.[locId];
    if (!detail?.message) { console.log(`\n--- ${locLabel} (locale ${locId}): NO MESSAGE ---`); continue; }
    console.log(`\n--- ${locLabel} (locale ${locId}) subject: ${detail.subject} ---`);
    // Show 500 chars around the "eligible game categor" region, or first 1500 chars if not found
    const msg = detail.message;
    const idx = msg.toLowerCase().indexOf('eligible game categor');
    if (idx >= 0) {
      const start = Math.max(0, idx - 300);
      const end = Math.min(msg.length, idx + 400);
      console.log('... [context around clause] ...');
      console.log(msg.slice(start, end));
    } else {
      // Show the part of the message that has "turnover" or "must be claimed" to find insertion point
      const idx2 = msg.toLowerCase().indexOf('must be claimed');
      if (idx2 >= 0) {
        const start = Math.max(0, idx2 - 400);
        const end = Math.min(msg.length, idx2 + 200);
        console.log('... [context around "must be claimed" — insertion point for missing clause] ...');
        console.log(msg.slice(start, end));
      } else {
        console.log(msg.slice(0, 1000));
      }
    }
  }
}
