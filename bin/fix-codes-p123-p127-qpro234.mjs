#!/usr/bin/env node
/**
 * Restore overwritten promo codes on QPRO2/3/4 for P123-P127.
 *
 * Root cause: backfill-mt-popup-p123-p127-qpro234.mjs used plan.buildUpdate()
 * which re-emits resolved.promo_code from the fixture (QPRO1 _V2 codes).
 * The PUT overwrote QPRO2/3/4 codes from the original non-_V2 variants.
 *
 * This script:
 *   1. Finds each promo by its current (wrong) code
 *   2. Reads the existing message_template_id + dialog linkage to preserve them
 *   3. Rebuilds the plan with the CORRECT code overridden
 *   4. PUTs back — only the code changes, everything else stays identical
 *
 * Usage:
 *   node bin/fix-codes-p123-p127-qpro234.mjs           # dry-run
 *   node bin/fix-codes-p123-p127-qpro234.mjs --commit  # live
 */

import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { loadAllRequests, resolveDuplicates, resolveHandle } from '../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../src/bo-cache.js';
import { getSite } from '../src/sites.js';
import {
  findPromotionByCode,
  updatePromotion,
  readDialogForPreservation,
  authedFetch,
} from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';

const commit = process.argv.includes('--commit');

const TARGETS = [
  { handle: 'P123-r124', wrongCode: 'WELC_BOOSTER_100FS_GOOSS_25X_V2', rightCode: 'WELC_BOOSTER_100FS_GOOSS_25X' },
  { handle: 'P124-r125', wrongCode: 'REL_BASE_60FS_GOOSS_12X_V2B',      rightCode: 'REL_BASE_60FS_GOOSS_12X_V2' },
  { handle: 'P125-r126', wrongCode: 'REL_BOOSTER_80FS_GOOSS_15X_V2',    rightCode: 'REL_BOOSTER_80FS_GOOSS_15X' },
  { handle: 'P126-r127', wrongCode: 'RET_GOOSS_BASE_50FS_10X_V2',       rightCode: 'RET_GOOSS_BASE_50FS_10X' },
  { handle: 'P127-r128', wrongCode: 'RET_GOOSS_BOOST_60FS_12X_V2',      rightCode: 'RET_GOOSS_BOOST_60FS_12X' },
];

const BRANDS = [
  { brand: 'QPRO2', siteId: 'qpro2' },
  { brand: 'QPRO3', siteId: 'qpro3' },
  { brand: 'QPRO4', siteId: 'qpro4' },
];

console.log('═'.repeat(68));
console.log(`RESTORE CODES P123-P127 × QPRO2/3/4 — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (add --commit to save)'}`);
console.log('═'.repeat(68));

const { byHandle, byId, byCode } = await loadAllRequests();
const bo = await loadBoCodeIndex();

const bundleDir = path.resolve('captures/qc-bundles');
let totalOk = 0, totalFail = 0;

for (const { brand, siteId } of BRANDS) {
  const site = getSite(siteId);

  // Fetch popup list once per brand (re-used by readDialogForPreservation).
  let allPopups = null;
  try {
    const pr = await authedFetch(site, '/api/bo/popups?perPage=500&page=1&sort_by=id&sort_order=desc');
    allPopups = pr?.data?.rows || [];
  } catch (e) {
    console.log(`  ⚠ ${brand}: could not pre-fetch popups list (${e.message.split('\n')[0]}) — dialog preservation may skip`);
  }

  for (const t of TARGETS) {
    const handle = resolveHandle(t.handle, { byHandle, byId }) || t.handle;
    const request = byHandle.get(handle);
    if (!request) {
      console.error(`\n✗ Handle ${t.handle} not found — run ingest-requests.js first`);
      totalFail++;
      continue;
    }

    console.log(`\n── ${handle} ${brand} (${t.wrongCode} → ${t.rightCode}) ──`);

    // 1. Find promo by current (wrong) code.
    const existing = await findPromotionByCode(site, t.wrongCode);
    if (!existing) {
      console.log(`  ✗ Promo "${t.wrongCode}" not found on ${siteId} — may already be fixed or never existed`);
      // Check if correct code already exists
      const already = await findPromotionByCode(site, t.rightCode);
      if (already) console.log(`  ℹ Correct code "${t.rightCode}" already exists (id=${already.id}) — skipping`);
      totalFail++;
      continue;
    }
    console.log(`  ✓ Found promo id=${existing.id} code="${existing.code}" mt=${existing.message_template_id}`);

    // 2. Preserve existing message_template_id and dialog linkage.
    const mtId = existing.message_template_id || 0;
    let dialogPreserved = null;
    try {
      dialogPreserved = await readDialogForPreservation(site, t.wrongCode, allPopups);
      if (dialogPreserved) {
        console.log(`  ✓ Dialog preserved — popup_id=${dialogPreserved.id} code="${dialogPreserved.fullRow?.code || '?'}"`);
      } else {
        console.log(`  ℹ No dialog linked`);
      }
    } catch (e) {
      console.log(`  ⚠ Dialog preservation failed (${e.message.split('\n')[0]}) — will send dialog_popup_list:[]`);
    }

    const dialog = dialogPreserved ? {
      id: dialogPreserved.id,
      code: dialogPreserved.fullRow?.code || '',
      start_date: dialogPreserved.fullRow?.start_date
        || dialogPreserved.fullRow?.created_at
        || new Date().toISOString().slice(0, 19).replace('T', ' '),
      label: request.promotion_name_en || request.name_details_raw || '',
    } : null;

    // 3. Build plan with CORRECT code overridden.
    const resolved = await resolveDuplicates(request, byCode, {
      boIndex: bo.byCode,
      boFetcher: fetchBoCodeAsRecord,
    });
    resolved.promo_code = t.rightCode; // ← override: correct code only

    const plan = await buildApiPlan(resolved, { brand, site });
    const putBody = plan.buildUpdate(existing.id, mtId, dialog);

    console.log(`  → code in PUT body: "${putBody.code}"`);
    if (putBody.code !== t.rightCode) {
      console.log(`  ✗ PUT body code mismatch! Expected "${t.rightCode}" but got "${putBody.code}" — skipping`);
      totalFail++;
      continue;
    }

    if (!commit) {
      console.log(`  → dry-run — would PUT promo_id=${existing.id} with code="${t.rightCode}" mt=${mtId} dialog=${dialog?.id ?? 'none'}`);
      totalOk++;
      continue;
    }

    // 4. Live PUT.
    try {
      await updatePromotion(site, existing.id, putBody);
    } catch (e) {
      console.log(`  ✗ PUT failed: ${e.message.split('\n')[0]}`);
      totalFail++;
      continue;
    }

    // 5. Verify code is now correct.
    const verify = await findPromotionByCode(site, t.rightCode);
    if (!verify) {
      console.log(`  ✗ POST-verify: "${t.rightCode}" not found — PUT may have failed silently`);
      totalFail++;
      continue;
    }
    console.log(`  ✓ Verified — id=${verify.id} code="${verify.code}" mt=${verify.message_template_id}`);

    // 6. Update QC bundle on disk (patch list_row.code only — full refresh via qc-fanout --refresh later).
    try {
      const bundlePath = path.join(bundleDir, `${handle}__${brand}.json`);
      const raw = await readFile(bundlePath, 'utf8').catch(() => null);
      if (raw) {
        const bundle = JSON.parse(raw);
        // bundle.promo_code was set to the CORRECT code at build-time — should already match.
        if (bundle.live_state?.list_row?.code) {
          bundle.live_state.list_row.code = t.rightCode;
          bundle.live_state.list_row._code_restored_at = new Date().toISOString();
        }
        await writeFile(bundlePath, JSON.stringify(bundle, null, 2));
        console.log(`  ✓ Bundle list_row.code patched`);
      }
    } catch (e) {
      console.log(`  ⚠ Bundle patch failed (non-fatal): ${e.message.split('\n')[0]}`);
    }

    totalOk++;
  }
}

console.log('\n' + '─'.repeat(50));
console.log(`Summary: ${totalOk} OK, ${totalFail} failed`);
if (!commit) console.log('(dry-run — re-run with --commit to save)');
else if (totalOk > 0) console.log('\nNext: node bin/qc-fanout.mjs P123 --refresh (repeat for P124-P127) to re-fetch live state before Sentinel.');
