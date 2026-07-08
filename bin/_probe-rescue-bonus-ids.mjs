#!/usr/bin/env node
// Sweep ALL brands for Rescue Bonus promos (e.g. optimove_*_rescue_bonus_*)
// and report the exact promotion/reward ID + promo code per brand.
// Covers QPRO1-17, QP2A-D (IBC22/KING333/ACE66/SPADE66), WS1 MY/SG, WS2.

import { writeFileSync } from 'node:fs';
import { getSite } from '../src/sites.js';
import { getAllPromotions } from '../src/api-client.js';
import { igmpPost } from '../src/igmp-client.js';

const NEEDLE = /rescue/i;

async function probeQpro(siteId, label, { merchantId } = {}) {
  const site = getSite(siteId);
  // QPRO returns 0 rows for status:'' (QP2 tolerates it) — query 1 and 0 separately
  const [active, inactive] = await Promise.all([
    getAllPromotions(site, { merchantId, status: 1, perPage: 100 }),
    getAllPromotions(site, { merchantId, status: 0, perPage: 100 }),
  ]);
  const rows = [...active.rows, ...inactive.rows];
  const hits = rows.filter((p) => NEEDLE.test(p.code || '') || NEEDLE.test(p.name || ''));
  return {
    label,
    hits: hits.map((p) => ({
      rewardId: p.id,
      code: p.code,
      name: p.name,
      status: p.status === 1 ? 'Active' : 'Inactive',
    })),
  };
}

async function probeIgmp(siteId, label) {
  const all = [];
  for (let pg = 1; pg <= 40; pg++) {
    const r = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, {
      PromotionCode: '', PromotionName: '', PromotionType: '', IsActive: '', IsPublished: '',
    });
    const rows = r?.data || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 200) break;
  }
  const hits = all.filter(
    (p) => NEEDLE.test(p.PromotionCode || '') || NEEDLE.test(p.PromotionName || ''),
  );
  const isActive = (p) => {
    const v = p.IsActive ?? p.Active ?? p.Status;
    return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
  };
  return {
    label,
    hits: hits.map((p) => ({
      rewardId: p.PromotionId,
      code: (p.PromotionCode || '').trim(),
      name: (p.PromotionName || '').trim(),
      status: isActive(p) ? 'Active' : 'Inactive',
    })),
  };
}

const jobs = [];
for (let i = 1; i <= 17; i++) jobs.push(probeQpro(`qpro${i}`, `QPRO${i}`).catch((e) => ({ label: `QPRO${i}`, error: e.message.split('\n')[0] })));
jobs.push(probeQpro('ibc22', 'QP2A (IBC22)', { merchantId: 1 }).catch((e) => ({ label: 'QP2A (IBC22)', error: e.message.split('\n')[0] })));
jobs.push(probeQpro('ibc22', 'QP2B (KING333)', { merchantId: 2 }).catch((e) => ({ label: 'QP2B (KING333)', error: e.message.split('\n')[0] })));
jobs.push(probeQpro('ibc22', 'QP2C (ACE66)', { merchantId: 3 }).catch((e) => ({ label: 'QP2C (ACE66)', error: e.message.split('\n')[0] })));
jobs.push(probeQpro('ibc22', 'QP2D (SPADE66)', { merchantId: 4 }).catch((e) => ({ label: 'QP2D (SPADE66)', error: e.message.split('\n')[0] })));
jobs.push(probeIgmp('ws1-v3-my', 'WS1 MY (MB8)').catch((e) => ({ label: 'WS1 MY (MB8)', error: e.message.split('\n')[0] })));
jobs.push(probeIgmp('ws1-v3-sg', 'WS1 SG (MB8)').catch((e) => ({ label: 'WS1 SG (MB8)', error: e.message.split('\n')[0] })));
jobs.push(probeIgmp('ws2', 'WS2 (RWS77)').catch((e) => ({ label: 'WS2 (RWS77)', error: e.message.split('\n')[0] })));

const reports = await Promise.all(jobs);

console.log('\n━━━━ Rescue Bonus — Reward IDs across all brands ━━━━\n');
for (const rpt of reports) {
  if (rpt.error) {
    console.log(`${rpt.label}: ✗ site error — ${rpt.error}`);
    continue;
  }
  if (!rpt.hits.length) {
    console.log(`${rpt.label}: (no rescue bonus promos)`);
    continue;
  }
  console.log(`${rpt.label}:`);
  for (const h of rpt.hits) {
    console.log(`  id=${String(h.rewardId).padEnd(8)} ${h.status.padEnd(8)} ${h.code.padEnd(45)} ${h.name}`);
  }
}

writeFileSync('tmp/rescue-bonus-ids.json', JSON.stringify(reports, null, 2));
console.log('\nSaved: tmp/rescue-bonus-ids.json');
