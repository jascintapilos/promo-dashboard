#!/usr/bin/env node
// Bulk-archive the orphan rows accumulated during P068 debugging this
// session. QPRO: PUT status=0 then DELETE. QP2: PUT status=0 only (the
// platform 422s on DELETE per session_2026-05-13 captures).

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan as buildPlanQpro } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildPlanQp2 } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const targets = [
  // QPRO orphans from V2/V3/V4 attempts (before FS game-code resolver landed)
  { siteId: 'qpro1',  brand: 'QPRO1',  id: 932, label: 'V2' },
  { siteId: 'qpro1',  brand: 'QPRO1',  id: 933, label: 'V3' },
  { siteId: 'qpro1',  brand: 'QPRO1',  id: 934, label: 'V4' },
  { siteId: 'qpro2',  brand: 'QPRO2',  id: 481, label: 'V2' },
  { siteId: 'qpro3',  brand: 'QPRO3',  id: 446, label: 'V2' },
  { siteId: 'qpro4',  brand: 'QPRO4',  id: 348, label: 'V2' },
  { siteId: 'qpro5',  brand: 'QPRO5',  id: 329, label: 'V2' },
  { siteId: 'qpro6',  brand: 'QPRO6',  id: 397, label: 'V2' },
  { siteId: 'qpro7',  brand: 'QPRO7',  id: 334, label: 'V2' },
  { siteId: 'qpro8',  brand: 'QPRO8',  id: 453, label: 'V2' },
  { siteId: 'qpro9',  brand: 'QPRO9',  id: 323, label: 'V2' },
  { siteId: 'qpro10', brand: 'QPRO10', id: 252, label: 'V2' },
  // QP2 orphan from QP2A HTTP-500 partial create
  { siteId: 'ibc22',  brand: 'QP2A',   id: 1172, label: 'V1 (no suffix)' },
  // V6 test artifact from Option B validation
  { siteId: 'ibc22',  brand: 'QP2A',   id: 1174, label: 'V6 (test artifact)' },
];

const resolved = JSON.parse(fs.readFileSync('captures/requests/P068-r69.json', 'utf8'));
const commit = process.argv.includes('--commit');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`BULK ARCHIVE P068 ORPHANS — ${commit ? 'LIVE' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${targets.length} rows queued`);
console.log('');

for (const t of targets) {
  const site = getSite(t.siteId);
  const isQp2 = t.siteId === 'ibc22';
  const tag = `[${t.brand} ${t.label} id=${t.id}]`;
  try {
    const existing = await authedFetch(site, `/api/bo/promotion/${t.id}`);
    const code = existing.data.rows.code;
    process.stdout.write(`${tag.padEnd(40)} code=${code.padEnd(35)}`);
    if (!commit) {
      console.log(' (would deactivate' + (isQp2 ? '' : ' + delete') + ')');
      continue;
    }
    // Rebuild PUT body via mapper, override status=0.
    const fixtureCopy = { ...resolved, promo_code: code };
    const plan = isQp2
      ? await buildPlanQp2(fixtureCopy, { brand: t.brand, site })
      : await buildPlanQpro(fixtureCopy, { brand: t.brand, site });
    const putBody = plan.buildUpdate(t.id, existing.data.rows.message_template_id || 0, null);
    putBody.status = 0;
    // Preserve current merchant_ids on QP2 (don't reset to single).
    if (isQp2 && existing.data.rows.merchant_ids) {
      const ids = existing.data.rows.merchant_ids.map((m) => m.id || m);
      const o = {};
      ids.forEach((id, i) => { o[String(i)] = id; });
      putBody.merchant_ids = o;
    }
    await updatePromotion(site, t.id, putBody);
    process.stdout.write(' deactivated');
    if (!isQp2) {
      try {
        await authedFetch(site, `/api/bo/promotion/${t.id}`, { method: 'DELETE' });
        process.stdout.write(' + archived');
      } catch (e) {
        process.stdout.write(` (delete failed: ${(e.message||'').split('\n')[1]?.trim() || ''})`);
      }
    }
    console.log(' ✓');
  } catch (e) {
    console.log(` ✖ ${(e.message||'').split('\n')[0]}`);
  }
}
console.log('');
console.log('Done.');
