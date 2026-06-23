// Finish-orphans recovery script for P124-P163 batch.
//
// On 2026-05-26 the live commit of P124-P163 created 195 orphan promo
// records on QPRO3/4/6/8/10. The popup POST blew up at step 3 with
// HTTP 422 "label field required" because the parser-patch override
// branch left promotion_name_en blank. The namer was then patched to
// derive names from parsed/bonus_type even in override mode.
//
// This script picks up where the commit sweep died. For each orphan:
//   3. POST /api/bo/popups            (re-attempt with populated label)
//   4. POST /api/bo/promotionname × 4
//   5. PUT  /api/bo/promotion/{id}    (link template + popup)
//
// Skips steps 1 (promotion) + 2 (message_template) — both already created.
//
// Run:  node bin/_finish-orphans-p124-163.mjs [--commit]

import fs from 'node:fs';
import path from 'node:path';
import { loadAllRequests, resolveDuplicates } from '../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../src/bo-cache.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import {
  createDialogPopup, addPromotionName, updatePromotion,
} from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const args = process.argv.slice(2);
const commit = args.includes('--commit');

const INVENTORY_FILE = 'captures/api-runs/orphan-inventory-p124-163.json';
const orphans = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
console.log(`Orphans loaded: ${orphans.length}`);

const { byHandle, byCode } = await loadAllRequests();
const bo = await loadBoCodeIndex();

const BRAND_TO_SITE = {
  QPRO3: 'qpro3', QPRO4: 'qpro4', QPRO6: 'qpro6', QPRO8: 'qpro8', QPRO10: 'qpro10',
};

const results = [];
let i = 0;
for (const orph of orphans) {
  i++;
  const tag = `[${i}/${orphans.length}] ${orph.rn} ${orph.brand} code=${orph.code} promotion_id=${orph.promotion_id} template_id=${orph.message_template_id}`;
  process.stdout.write(`${tag}... `);

  // Find the request fixture
  const handle = `${orph.rn}-r${Number(String(orph.rn).slice(1)) + 1}`;
  const request = byHandle.get(handle);
  if (!request) {
    console.log('SKIP (no fixture)');
    results.push({ ...orph, status: 'NO_FIXTURE' });
    continue;
  }

  // Resolve + build plan
  const resolved = await resolveDuplicates(request, byCode, { boIndex: bo.byCode, boFetcher: fetchBoCodeAsRecord });
  const siteId = BRAND_TO_SITE[orph.brand];
  if (!siteId) {
    console.log('SKIP (unknown brand)');
    results.push({ ...orph, status: 'UNKNOWN_BRAND' });
    continue;
  }
  const site = getSite(siteId);
  let plan;
  try {
    plan = await buildApiPlan(resolved, { brand: orph.brand, site });
  } catch (e) {
    console.log(`FAIL (plan build): ${e.message.slice(0, 100)}`);
    results.push({ ...orph, status: 'PLAN_FAILED', error: e.message });
    continue;
  }

  if (!commit) {
    // Dry-run: just verify the popup body now has a non-empty label
    const popupLabel = plan.dialogPopup?.label;
    const namesCount = plan.buildNames(orph.promotion_id).length;
    const ok = popupLabel && popupLabel.length > 0 && namesCount > 0;
    console.log(ok ? `dry-ok (label="${popupLabel}", names=${namesCount})` : `dry-FAIL label=${JSON.stringify(popupLabel)} names=${namesCount}`);
    results.push({ ...orph, status: ok ? 'DRY_OK' : 'DRY_FAIL', popup_label: popupLabel, names_count: namesCount });
    continue;
  }

  // LIVE: run steps 3, 4, 5
  let dialogPopup = null;
  try {
    // 3. POST /popups
    if (plan.dialogPopup) {
      const r3 = await createDialogPopup(site, plan.dialogPopup);
      const popupRows = r3?.data?.rows || r3?.data;
      if (popupRows?.id && popupRows?.code) {
        dialogPopup = {
          id: popupRows.id,
          code: popupRows.code,
          start_date: popupRows.start_date || plan.dialogPopup.start_date,
          label: resolved.promotion_name_en,
        };
      }
    }
    // 4. POST /promotionname × 4
    for (const name of plan.buildNames(orph.promotion_id)) {
      await addPromotionName(site, name);
    }
    // 5. PUT /promotion/{id}
    const putBody = plan.buildUpdate(orph.promotion_id, orph.message_template_id || 0, dialogPopup);
    await updatePromotion(site, orph.promotion_id, putBody);

    console.log(`OK (popup_id=${dialogPopup?.id ?? 'n/a'})`);
    results.push({ ...orph, status: 'FINISHED', popup_id: dialogPopup?.id });
  } catch (e) {
    console.log(`FAIL: ${e.message.slice(0, 200)}`);
    results.push({ ...orph, status: 'FAILED', error: e.message, popup_id: dialogPopup?.id });
  }
  // Incremental save
  fs.writeFileSync('captures/api-runs/finish-orphans-progress.json', JSON.stringify({ so_far: i, total: orphans.length, results }, null, 2));
}

// Summary
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('FINISH-ORPHANS SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const byStatus = {};
for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log(`Mode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s}: ${n}`);

const fails = results.filter((r) => r.status === 'FAILED' || r.status === 'PLAN_FAILED');
if (fails.length) {
  console.log('\nFailures:');
  fails.forEach((r) => console.log(`  ${r.rn} ${r.brand} — ${r.error?.slice(0, 200)}`));
}

const outFile = `captures/api-runs/finish-orphans-${commit ? 'commit' : 'dryrun'}-summary.json`;
fs.writeFileSync(outFile, JSON.stringify({ generated: new Date().toISOString(), mode: commit ? 'live' : 'dryrun', results }, null, 2));
console.log(`\nSummary → ${outFile}`);
