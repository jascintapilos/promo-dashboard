// Deactivate P065 QPRO+QP2 promos (Lines=20 bug) so they can be recreated
// with Lines=10. Builds the PUT body via the same mapper the canary uses,
// then overrides status=0 before sending.
//
//   node bin/deactivate-p065-lines-fix.mjs           # dry-run
//   node bin/deactivate-p065-lines-fix.mjs --commit  # live

import { authedFetch, updatePromotion } from '../src/api-client.js';
import { BRAND_TO_SITE } from '../src/ingest.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan as buildQproPlan } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
const HANDLE  = 'P065-r66';
const CODE    = 'WHALE_CRM_PROBE_GOO50FS_10X';

const resolved = JSON.parse(readFileSync(`./captures/requests/${HANDLE}.json`, 'utf8'));
// Normalize multiline code before passing to mapper
if (resolved.promo_code?.includes('\n')) {
  resolved.promo_code = resolved.promo_code.split('\n')[0].trim();
}

// IDs confirmed via idempotency probes 2026-07-13
const QPRO_TARGETS = [
  { brand: 'QPRO1',  siteId: 'qpro1',  id: 1108 },
  { brand: 'QPRO2',  siteId: 'qpro2',  id: 573  },
  { brand: 'QPRO3',  siteId: 'qpro3',  id: 610  },
  { brand: 'QPRO4',  siteId: 'qpro4',  id: 540  },
  { brand: 'QPRO5',  siteId: 'qpro5',  id: 478  },
  { brand: 'QPRO6',  siteId: 'qpro6',  id: 520  },
  { brand: 'QPRO7',  siteId: 'qpro7',  id: 470  },
  { brand: 'QPRO8',  siteId: 'qpro8',  id: 603  },
  { brand: 'QPRO9',  siteId: 'qpro9',  id: 388  },
  { brand: 'QPRO10', siteId: 'qpro10', id: 387  },
  { brand: 'QPRO15', siteId: 'qpro15', id: 377  },
  { brand: 'QPRO16', siteId: 'qpro16', id: 345  },
];

// ── QPRO deactivations ───────────────────────────────────────────────────────
for (const { brand, siteId, id } of QPRO_TARGETS) {
  const site = getSite(siteId);
  if (!site) { console.error(`✗ ${brand}: getSite('${siteId}') returned null`); continue; }

  let plan;
  try {
    plan = await buildQproPlan(resolved, { brand, site });
  } catch (e) {
    console.error(`✗ ${brand}: buildApiPlan failed: ${e.message}`);
    continue;
  }

  // Get existing template_id from live record so the PUT doesn't orphan it
  let templateId = 0;
  let dialogPopup = null;
  try {
    const detail = await authedFetch(site, `/api/bo/promotion/${id}`);
    templateId = detail.data.rows?.message_template_id ?? 0;
  } catch (e) {
    console.warn(`  ⚠ ${brand}: could not fetch live templateId, using 0`);
  }

  const putBody = plan.buildUpdate(id, templateId, dialogPopup);
  putBody.status = 0; // deactivate

  if (DRY_RUN) {
    console.log(`[DRY RUN] ${brand}: would PUT /api/bo/promotion/${id} status=0 (template=${templateId})`);
    continue;
  }

  try {
    await updatePromotion(site, id, putBody);
    console.log(`✓ ${brand}: deactivated id=${id}`);
  } catch (e) {
    console.error(`✗ ${brand}: ${e.message}`);
  }
}

// ── QP2 deactivation ─────────────────────────────────────────────────────────
const qp2BrandEntry = BRAND_TO_SITE['QP2A'];
const qp2Site = qp2BrandEntry ? getSite(qp2BrandEntry.siteId) : null;
if (!qp2Site) {
  console.error('✗ QP2A: could not resolve site');
} else {
  try {
    const resp = await authedFetch(qp2Site, `/api/bo/promotion?code=${encodeURIComponent(CODE)}&perPage=5`);
    const rows = resp.data?.rows || [];
    const row = Array.isArray(rows) ? rows.find((r) => r.code === CODE) : null;
    if (!row) {
      console.log(`QP2: no existing promo for code "${CODE}" — nothing to deactivate`);
    } else if (row.status === 0 || row.status === '0') {
      console.log(`QP2: already inactive (id=${row.id}) — skipping`);
    } else {
      console.log(`QP2: found id=${row.id} status=${row.status}`);
      if (DRY_RUN) {
        console.log(`[DRY RUN] QP2: would deactivate id=${row.id}`);
      } else {
        const plan = await buildQp2Plan(resolved, { brand: 'QP2A', site: qp2Site });
        const detail = await authedFetch(qp2Site, `/api/bo/promotion/${row.id}`);
        const templateId = detail.data.rows?.message_template_id ?? 0;
        const putBody = plan.buildUpdate(row.id, templateId, null);
        putBody.status = 0;
        await updatePromotion(qp2Site, row.id, putBody);
        console.log(`✓ QP2: deactivated id=${row.id}`);
      }
    }
  } catch (e) {
    console.error(`✗ QP2: ${e.message}`);
  }
}

console.log(DRY_RUN ? '\n[DRY RUN] Re-run with --commit to apply.' : '\nDone.');
