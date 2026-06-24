#!/usr/bin/env node
/**
 * Backfill missing message templates + dialog popups for P123-P127 on
 * QPRO2/3/4. These 15 promos were saved without MT or popup (the canary
 * only created them on QPRO1 + QP2). The promotion records already exist;
 * this script creates the MT and popup then PUTs to link them.
 *
 * Usage:
 *   node bin/backfill-mt-popup-p123-p127-qpro234.mjs          # dry-run
 *   node bin/backfill-mt-popup-p123-p127-qpro234.mjs --commit  # live
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAllRequests, resolveDuplicates, resolveHandle } from '../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../src/bo-cache.js';
import { getSite } from '../src/sites.js';
import {
  findPromotionByCode,
  createMessageTemplate,
  createDialogPopup,
  updatePromotion,
  getPopupDetail,
} from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { qcMtTncHyperlink } from '../src/qc-mt-tnc.js';

const commit = process.argv.includes('--commit');

const TARGETS = [
  { handle: 'P123-r124', code: 'WELC_BOOSTER_100FS_GOOSS_25X' },
  { handle: 'P124-r125', code: 'REL_BASE_60FS_GOOSS_12X_V2' },
  { handle: 'P125-r126', code: 'REL_BOOSTER_80FS_GOOSS_15X' },
  { handle: 'P126-r127', code: 'RET_GOOSS_BASE_50FS_10X' },
  { handle: 'P127-r128', code: 'RET_GOOSS_BOOST_60FS_12X' },
];

const BRANDS = [
  { brand: 'QPRO2', siteId: 'qpro2' },
  { brand: 'QPRO3', siteId: 'qpro3' },
  { brand: 'QPRO4', siteId: 'qpro4' },
];

console.log('═'.repeat(68));
console.log(`BACKFILL MT+POPUP P123-P127 × QPRO2/3/4 — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (add --commit to save)'}`);
console.log('═'.repeat(68));

const { byHandle, byId, byCode } = await loadAllRequests();
const bo = await loadBoCodeIndex();

const bundleDir = path.resolve('captures/qc-bundles');
await mkdir(bundleDir, { recursive: true });

let totalOk = 0, totalFail = 0;

for (const t of TARGETS) {
  const handle = resolveHandle(t.handle, { byHandle, byId }) || t.handle;
  const request = byHandle.get(handle);
  if (!request) { console.error(`\n✗ Handle ${t.handle} not found — run ingest-requests.js first`); totalFail++; continue; }

  for (const { brand, siteId } of BRANDS) {
    const site = getSite(siteId);
    console.log(`\n── ${handle} ${brand} (${t.code}) ──`);

    // Find existing promotion
    const existing = await findPromotionByCode(site, t.code);
    if (!existing) {
      console.log(`  ✗ Promo not found on ${siteId} — skipping`);
      totalFail++;
      continue;
    }
    console.log(`  ✓ Found promo id=${existing.id} status=${existing.status}`);

    if (existing.message_template_id && existing.message_template_id !== 0) {
      console.log(`  ⚠ Already has template_id=${existing.message_template_id} — skipping (idempotent)`);
      totalOk++;
      continue;
    }

    // Build plan from fixture.
    // IMPORTANT: override promo_code to the target brand's code (t.code), not the
    // fixture's promo_code (which stores QPRO1's code and would silently overwrite
    // QPRO2/3/4's codes on PUT).
    const resolved = await resolveDuplicates(request, byCode, { boIndex: bo.byCode, boFetcher: fetchBoCodeAsRecord });
    resolved.promo_code = t.code;
    const plan = await buildApiPlan(resolved, { brand, site });

    if (!plan.messageTemplate) {
      console.log(`  ⚠ buildApiPlan produced no messageTemplate — skipping`);
      totalFail++;
      continue;
    }

    console.log(`  MT locales: [${Object.keys(plan.messageTemplate.details).join(', ')}]`);
    if (plan.dialogPopup) {
      console.log(`  Popup locales: [${Object.keys(plan.dialogPopup.contents || {}).join(', ')}]`);
    }

    if (!commit) {
      console.log('  → dry-run — would create MT + popup then PUT to link');
      totalOk++;
      continue;
    }

    let templateId = null;
    let dialogPopup = null;

    // Create message template
    try {
      const r2 = await createMessageTemplate(site, plan.messageTemplate);
      templateId = r2?.data?.rows?.id;
      if (!templateId) throw new Error(`no id returned: ${JSON.stringify(r2).slice(0, 200)}`);
      console.log(`  ✓ MT created — template_id=${templateId}`);
    } catch (e) {
      console.log(`  ✗ MT create failed: ${e.message.split('\n')[0]}`);
      totalFail++;
      continue;
    }

    // Create dialog popup (if plan includes one)
    if (plan.dialogPopup) {
      try {
        const r3 = await createDialogPopup(site, plan.dialogPopup);
        const popupRows = r3?.data?.rows || r3?.data;
        if (popupRows?.id && popupRows?.code) {
          dialogPopup = {
            id: popupRows.id,
            code: popupRows.code,
            start_date: popupRows.start_date || plan.dialogPopup.start_date,
            label: resolved.promotion_name_en,
          };
          console.log(`  ✓ Popup created — popup_id=${dialogPopup.id} code=${dialogPopup.code}`);
        } else {
          console.log(`  ⚠ Popup POST returned no id/code — PUT will skip dialog_popup_list`);
        }
      } catch (e) {
        console.log(`  ✗ Popup create failed (non-fatal): ${e.message.split('\n')[0]}`);
      }
    }

    // PUT to link MT + popup to existing promotion
    try {
      const putBody = plan.buildUpdate(existing.id, templateId, dialogPopup);
      await updatePromotion(site, existing.id, putBody);
      console.log(`  ✓ PUT linked — promo_id=${existing.id} template_id=${templateId}${dialogPopup ? ` popup_id=${dialogPopup.id}` : ''}`);
    } catch (e) {
      console.log(`  ✗ PUT failed: ${e.message.split('\n')[0]}`);
      totalFail++;
      continue;
    }

    // Quick TNC check
    const tnc = await qcMtTncHyperlink(site, templateId, 'qpro').catch(() => null);
    console.log(`  TNC check: ${JSON.stringify(tnc?.checks)}`);

    // Update QC bundle on disk
    try {
      const bundlePath = path.join(bundleDir, `${handle}__${brand}.json`);
      const { readFile } = await import('node:fs/promises');
      const bundle = JSON.parse(await readFile(bundlePath, 'utf8').catch(() => 'null') || 'null');
      if (bundle) {
        bundle.template_id = templateId;
        bundle.dialog_popup_id = dialogPopup?.id || null;
        bundle.live_state.tnc = tnc;
        if (dialogPopup?.id) {
          const popup = await getPopupDetail(site, dialogPopup.id).catch(() => null);
          bundle.live_state.popup = popup;
        }
        bundle.live_state.refreshed_at = new Date().toISOString();
        await writeFile(bundlePath, JSON.stringify(bundle, null, 2));
        console.log(`  ✓ Bundle updated`);
      }
    } catch (e) {
      console.log(`  ⚠ Bundle update failed (non-fatal): ${e.message.split('\n')[0]}`);
    }

    totalOk++;
  }
}

console.log('\n' + '─'.repeat(50));
console.log(`Summary: ${totalOk} OK, ${totalFail} failed`);
if (!commit) console.log('(dry-run — re-run with --commit to save)');
