#!/usr/bin/env node
// Probe the qpro3 "eligible game categories for this promotion are Slots" format

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

const site = getSite('qpro3');
const promos = await fetchTleo(site);

// Check codes that use "eligible game categories for this promotion are Slots" phrasing
const codes = ['FT_REL_TLEO_45PCT_228MX_BR', 'FT_REL_TLEO_20PCT_60MX_BR'];
for (const code of codes) {
  const promo = promos.find(p => p.code === code);
  if (!promo) { console.log(`NOT FOUND: ${code}`); continue; }

  const mt = await authedFetch(site, `/api/bo/messagetemplate/${promo.message_template_id}`);
  const data = mt.data;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`qpro3  ${code}  mtId=${promo.message_template_id}`);
  console.log('='.repeat(70));

  const locales = { '1': 'MY_EN', '3': 'MY_ZH', '6': 'SG_EN', '7': 'SG_ZH' };
  for (const [locId, label] of Object.entries(locales)) {
    const d = data.message_details?.[locId];
    if (!d?.message) continue;
    const msg = d.message;
    const idx = msg.toLowerCase().indexOf('eligible game categor');
    if (idx >= 0) {
      const start = Math.max(0, idx - 20);
      const end = Math.min(msg.length, idx + 200);
      console.log(`\n[${label}] clause area:`);
      console.log(msg.slice(start, end));
    } else {
      // Try ZH pattern
      const idx2 = msg.indexOf('游戏类别');
      if (idx2 >= 0) {
        const start = Math.max(0, idx2 - 20);
        const end = Math.min(msg.length, idx2 + 200);
        console.log(`\n[${label}] ZH clause area:`);
        console.log(msg.slice(start, end));
      } else {
        console.log(`\n[${label}] no clause found`);
      }
    }
  }
}
