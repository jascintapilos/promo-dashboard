#!/usr/bin/env node
// Probe live IGMP BO for current promo names of P105-P109 (IDs 3716-3720)

import { igmpPost } from '../src/igmp-client.js';

const SITE = 'ws1-v3-my';
const entries = [
  { rn: 'P105', id: 3716, type: 'fc' },
  { rn: 'P106', id: 3717, type: 'fc' },
  { rn: 'P107', id: 3718, type: 'fc' },
  { rn: 'P108', id: 3719, type: 'dep' },
  { rn: 'P109', id: 3720, type: 'dep' },
];

for (const e of entries) {
  const endpoint = e.type === 'fc' ? '/PM/GetFreeCreditInfo' : '/PM/GetBonusInfo';
  try {
    const res = await igmpPost(SITE, endpoint, { PromotionId: e.id });
    const promo = res?.data?.Promotion || res?.data || res;
    console.log(`${e.rn} (${e.id}) | ${promo.PromotionName ?? JSON.stringify(Object.keys(promo || {}))}`);
  } catch (err) {
    console.log(`${e.rn} (${e.id}) | ERROR: ${err.message}`);
  }
}
