// Verify the QPRO PUT field name for blacklist template.
//
// QPRO GET returns `blacklist_id` (not `blacklist_template_id` like QP2 does).
// Mapper was sending `blacklist_template_id` — likely silently ignored.
//
// Strategy: PUT TEST_22FS_GOO_20X (id=936 on QPRO1, FS, status=0 inactive)
// with the rebuilt PUT body + `blacklist_id: 6` (Slots Only on QPRO1).
// GET back, confirm `blacklist_id` is now 6 (and template_id stayed null
// or matched). If the field doesn't stick, try `blacklist_template_id` next.
//
// Strategy uses GET → modify minimum → PUT (clone existing detail, don't
// re-run the mapper) so we don't accidentally mutate other fields.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SITE_ID = 'qpro1';
const PROMO_ID = 936;          // TEST_22FS_GOO_20X
const TARGET_BL_ID = 6;        // "Slots Only" on QPRO1
const commit = process.argv.includes('--commit');

const site = getSite(SITE_ID);

// ─── GET current state ────────────────────────────────────────────────────
const detResp = await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`);
const det = detResp?.data?.rows?.main || detResp?.data?.rows;
if (!det) throw new Error('No detail.main on response');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`BEFORE — ${det.code} (id=${det.id})`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  status:                  ${det.status}`);
console.log(`  promo_type:              ${det.promo_type} (4=FS)`);
console.log(`  blacklist_id:            ${det.blacklist_id}`);
console.log(`  blacklist_template_id:   ${det.blacklist_template_id ?? '(absent)'}`);

if (!commit) {
  console.log('\n[dry-run] would PUT blacklist_id=6 onto promotion/936. Re-run with --commit.');
  process.exit(0);
}

// ─── Build PUT body ───────────────────────────────────────────────────────
// Minimal: clone the entire detail.main, set blacklist_id, normalize the
// fields the PUT validator is picky about, omit fields it doesn't want.
// IMPORTANT: do NOT re-send promotion_currency (memory: QPRO PUT wipes per-
// currency rows when re-emitted).
function isoToYmdHms(s) {
  if (!s) return s;
  // 2026-03-25T16:00:00.000000Z → 2026-03-25 16:00:00
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : s;
}

const putBody = {
  ...det,
  blacklist_id: TARGET_BL_ID,
};
// Normalize date fields PUT validator requires in Y-m-d H:i:s
if (putBody.valid_from) putBody.valid_from = isoToYmdHms(putBody.valid_from);
if (putBody.valid_to)   putBody.valid_to   = isoToYmdHms(putBody.valid_to);
// Cast nullable integer FKs the validator demands as int
if (putBody.promo_p1_id == null) putBody.promo_p1_id = 0;
// Strip fields the GET surfaces that PUT doesn't accept / shouldn't echo.
delete putBody.created_at;
delete putBody.updated_at;
delete putBody.deleted_at;
delete putBody.created_by;
delete putBody.updated_by;
delete putBody.promotion_currency;  // critical — QPRO PUT must not re-send
delete putBody.message_templates;
delete putBody.dialog_popups;
delete putBody.dialog_popup_list;   // re-fetch + set below if needed
// reset_frequency=0 fails PUT validation ("invalid enum") — strip it.
if (putBody.reset_frequency === 0) delete putBody.reset_frequency;
// free_spin_game_code=null fails PUT validation on non-FS promos — strip
// FS-specific fields entirely when the promo isn't a Free Spin.
if (putBody.promo_type !== 4) {
  delete putBody.free_spin_game_code;
  delete putBody.free_spin_game_provider_id;
}

// QPRO PUT body shape expects these as flat fields, not nested
// game_provider_ids is already a flat array on GET — keep it
// member_group_ids likewise

// ─── PUT ──────────────────────────────────────────────────────────────────
console.log('');
console.log('━━━ PUT /api/bo/promotion/' + PROMO_ID + ' { blacklist_id: ' + TARGET_BL_ID + ' } ━━━');
try {
  const putResp = await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`, {
    method: 'PUT',
    body: putBody,
  });
  console.log('PUT OK — server message:', JSON.stringify(putResp?.message));
} catch (e) {
  console.log('PUT FAILED —', (e.message || '').split('\n').slice(0, 3).join(' | '));
  process.exit(1);
}

// ─── GET back to verify ──────────────────────────────────────────────────
const verifyResp = await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`);
const v = verifyResp?.data?.rows?.main || verifyResp?.data?.rows;
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`AFTER`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  blacklist_id:            ${v.blacklist_id}  ${v.blacklist_id === TARGET_BL_ID ? '✓ STUCK' : '✗ did not persist'}`);
console.log(`  blacklist_template_id:   ${v.blacklist_template_id ?? '(absent)'}`);
console.log(`  status:                  ${v.status}`);
console.log(`  promo_type:              ${v.promo_type}`);
console.log(`  code:                    ${v.code}`);
