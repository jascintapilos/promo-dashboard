#!/usr/bin/env node
// Probe whether FT_VM_REL100PCT_X1 and FT_VMFC_VARIABLE_3X exist across
// all QPRO BOs (1-17), QP2 merchants (A-D), WS1 MY + SG, and WS2.

import { getSite } from '../src/sites.js';
import { findPromotionByCode } from '../src/api-client.js';
import { igmpPost } from '../src/igmp-client.js';

const CODES = ['FT_VM_REL100PCT_X1', 'FT_VMFC_VARIABLE_3X'];

async function probeQpro(siteId, label, opts = {}) {
  const site = getSite(siteId);
  const results = {};
  for (const code of CODES) {
    try {
      const match = await findPromotionByCode(site, code, { merchantId: opts.merchantId });
      results[code] = match
        ? { found: true, id: match.id, status: match.status === 1 ? 'Active' : 'Inactive' }
        : { found: false };
    } catch (e) {
      results[code] = { found: null, error: e.message.split('\n')[0] };
    }
  }
  return { label, results };
}

// NOTE (2026-07-05): GetPromotionsList can MISS FreeCredit promos entirely
// (FT_VMFC_VARIABLE_3X was live on all 3 IGMP sites but absent from the list).
// Exact-code existence checks MUST use GetPromotionInfoByCode.
async function probeIgmp(siteId, label) {
  const results = {};
  for (const code of CODES) {
    try {
      const r = await igmpPost(siteId, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
      const d = r?.data;
      results[code] = d?.PromotionId
        ? { found: true, id: d.PromotionId, status: d.IsActive ? 'Active' : 'Inactive', name: d.PromotionName }
        : { found: false };
    } catch (e) {
      results[code] = { found: null, error: e.message.split('\n')[0] };
    }
  }
  return { label, results };
}

const jobs = [];
for (let i = 1; i <= 17; i++) jobs.push(probeQpro(`qpro${i}`, `QPRO${i}`));
jobs.push(probeQpro('ibc22', 'QP2A (IBC22)', { merchantId: 1 }));
jobs.push(probeQpro('ibc22', 'QP2B (KING333)', { merchantId: 2 }));
jobs.push(probeQpro('ibc22', 'QP2C (ACE66)', { merchantId: 3 }));
jobs.push(probeQpro('ibc22', 'QP2D (SPADE66)', { merchantId: 4 }));
jobs.push(probeIgmp('ws1-v3-my', 'WS1 MY (MB8)'));
jobs.push(probeIgmp('ws1-v3-sg', 'WS1 SG (MB8)'));
jobs.push(probeIgmp('ws2', 'WS2 (RWS77)'));

console.log(`\n━━━━ Promo Code Existence Probe ━━━━\nCodes: ${CODES.join(', ')}\n`);

const settled = await Promise.allSettled(jobs);
const reports = settled.map((r) =>
  r.status === 'fulfilled' ? r.value : { label: '?', error: r.reason?.message, results: {} }
);

console.log(`${'Brand/BO'.padEnd(18)} | ${'Code'.padEnd(22)} | Status`);
console.log('─'.repeat(75));
for (const rpt of reports) {
  if (rpt.error) {
    console.log(`${rpt.label.padEnd(18)} | (site error: ${String(rpt.error).slice(0, 45)})`);
    continue;
  }
  for (const code of CODES) {
    const r = rpt.results[code];
    let status;
    if (!r) status = '–';
    else if (r.error) status = `ERROR: ${r.error.slice(0, 45)}`;
    else if (r.found) status = `EXISTS — ${r.status}${r.id ? ` (id=${r.id})` : ''}${r.name ? ` "${r.name}"` : ''}`;
    else status = r.note ? `NOT FOUND (${r.note})` : 'NOT FOUND';
    console.log(`${rpt.label.padEnd(18)} | ${code.padEnd(22)} | ${status}`);
  }
}
console.log('');
