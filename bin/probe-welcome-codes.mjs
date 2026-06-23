#!/usr/bin/env node
// Probe whether WEL_WC26_100PCT_50_25x and WELC_188PCT_25X already exist
// in QPRO1, QP2C (ACE66), QP2D (SPADE66), and WS1 (MY+SG).
// WS1 probed WITHOUT FT_ prefix per operator instruction.

import { getSite } from '../src/sites.js';
import { findPromotionByCode } from '../src/api-client.js';
import { igmpPost } from '../src/igmp-client.js';

const CODES = ['WEL_WC26_100PCT_50_25x', 'WELC_188PCT_25X'];

// ── QPRO/QP2 probe ──────────────────────────────────────────────────────────
async function probeQpro(siteId, label, codes, opts = {}) {
  const site = getSite(siteId);
  const results = {};
  for (const code of codes) {
    try {
      const match = await findPromotionByCode(site, code, { merchantId: opts.merchantId });
      results[code] = match
        ? { found: true, id: match.id, status: match.status === 1 ? 'Active' : 'Inactive', type: match.promo_type_name || match.promo_type }
        : { found: false };
    } catch (e) {
      results[code] = { found: null, error: e.message.split('\n')[0] };
    }
  }
  return { label, siteId, results };
}

// ── WS1 (IGMP) probe ─────────────────────────────────────────────────────────
async function probeIgmp(siteId, label, codes) {
  const results = {};
  for (const code of codes) {
    try {
      const res = await igmpPost(siteId, '/PM/GetPromotionsList', {
        PromotionCode: code,
        PageNumber: 1,
        PageSize: 10,
      });
      const rows = res.Result?.PromotionList || res.PromotionList || res.result?.PromotionList || [];
      const match = rows.find((r) => r.PromotionCode === code || r.Code === code);
      results[code] = match
        ? { found: true, id: match.PromotionId || match.Id, status: match.Status === 1 ? 'Active' : 'Inactive' }
        : rows.length > 0
          ? { found: false, note: `${rows.length} rows returned but none matched exactly` }
          : { found: false };
    } catch (e) {
      results[code] = { found: null, error: e.message.split('\n')[0] };
    }
  }
  return { label, siteId, results };
}

// ── Run all probes ───────────────────────────────────────────────────────────
console.log('\n━━━━ Promo Code Duplicate Probe ━━━━');
console.log(`Codes: ${CODES.join(', ')}\n`);

const [r_qpro1, r_qp2c, r_qp2d, r_ws1_my, r_ws1_sg] = await Promise.allSettled([
  probeQpro('qpro1', 'QPRO1 (BP9)',         CODES),
  probeQpro('ibc22', 'QP2C (ACE66)',        CODES, { merchantId: 3 }),
  probeQpro('ibc22', 'QP2D (SPADE66)',      CODES, { merchantId: 4 }),
  probeIgmp('ws1-v3-my', 'WS1 MY (MB8)',    CODES),
  probeIgmp('ws1-v3-sg', 'WS1 SG (MB8)',    CODES),
]);

const reports = [r_qpro1, r_qp2c, r_qp2d, r_ws1_my, r_ws1_sg].map((r) =>
  r.status === 'fulfilled' ? r.value : { label: '?', siteId: '?', error: r.reason?.message, results: {} }
);

// ── Summary table ─────────────────────────────────────────────────────────────
console.log(`${'Platform'.padEnd(20)} | ${'Code'.padEnd(28)} | Status`);
console.log('─'.repeat(70));

for (const rpt of reports) {
  if (rpt.error) {
    console.log(`${rpt.label.padEnd(20)} | (site error: ${rpt.error.slice(0,40)})`);
    continue;
  }
  for (const code of CODES) {
    const r = rpt.results[code];
    let status;
    if (!r) status = '–';
    else if (r.error) status = `ERROR: ${r.error.slice(0, 40)}`;
    else if (r.found === null) status = 'ERROR';
    else if (r.found) status = `EXISTS — ${r.status}${r.id ? ` (id=${r.id})` : ''}`;
    else status = r.note ? `Not found (${r.note})` : 'Not found ✓';
    console.log(`${rpt.label.padEnd(20)} | ${code.padEnd(28)} | ${status}`);
  }
}
console.log('');
