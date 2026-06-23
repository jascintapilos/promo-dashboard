#!/usr/bin/env node
// Probe ZH clause content in TLEO message templates

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

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

function extractOlItems(html) {
  // Find <ol>...</ol> and extract each <li>
  const olMatch = html.match(/<ol>([\s\S]*?)<\/ol>/i);
  if (!olMatch) return '(no <ol> found)';
  // Extract all <li> content items
  const items = [];
  const liRe = /<li>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(olMatch[1])) !== null) {
    items.push(m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim());
  }
  return items.map((t, i) => `  ${i+1}. ${t}`).join('\n');
}

const PROBES = [
  { siteId: 'qpro2', code: 'FT_REL_TLEO_45PCT_228MX',    label: 'QPRO2 wrong all-games' },
  { siteId: 'qpro2', code: 'FT_REL_TLEO_LC_45PCT_228MX', label: 'QPRO2 OK LC (reference)' },
  { siteId: 'qpro3', code: 'FT_REL_TLEO_LC_45PCT_228MX', label: 'QPRO3 missing LC' },
  { siteId: 'qpro2', code: 'FT_REL_TLEO_LC_45PCT_228MX_BR', label: 'QPRO2 OK LC _BR' },
];

for (const probe of PROBES) {
  const site = getSite(probe.siteId);
  const promos = await fetchTleo(site);
  const promo = promos.find(p => p.code === probe.code);
  if (!promo) { console.log(`\n=== ${probe.label} — NOT FOUND ===`); continue; }

  const mt = await getFullMt(site, promo.message_template_id);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`=== ${probe.label} (mtId=${promo.message_template_id}) ===`);
  console.log('='.repeat(70));

  const locales = { '1': 'MY_EN', '3': 'MY_ZH', '6': 'SG_EN', '7': 'SG_ZH' };
  for (const [locId, locLabel] of Object.entries(locales)) {
    const detail = mt.message_details?.[locId];
    if (!detail?.message) continue;
    const items = extractOlItems(detail.message);
    console.log(`\n[${locLabel}]`);
    console.log(items);
  }
}
