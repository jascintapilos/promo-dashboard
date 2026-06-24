#!/usr/bin/env node
/**
 * Patch dialog popup content bodies for P123-P127 × QPRO2/3/4.
 *
 * Issue: the backfill-created popups use "GOOSS 0" (raw BO game code) in
 * their content bodies instead of the display name "Gates of Olympus Super
 * Scatter". The MT inbox bodies are correct; only the popup content is wrong.
 *
 * Affected: 15 popups (3 brands × 5 handles). Both EN and ZH locales.
 *   "[GOOSS 0]"              → "[Gates of Olympus Super Scatter]"
 *   "[60 Free Spins - GOOSS 0]" → "[60 Free Spins - Gates of Olympus Super Scatter]"
 *   etc. (all occurrences replaced)
 *
 * Usage:
 *   node bin/fix-popup-game-name-p123-p127-qpro234.mjs           # dry-run
 *   node bin/fix-popup-game-name-p123-p127-qpro234.mjs --commit  # live
 */

import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { getSite } from '../src/sites.js';
import { getPopupDetail, authedFetch } from '../src/api-client.js';

const commit = process.argv.includes('--commit');

// All 15 affected popups: brand → popup IDs per handle
const TARGETS = [
  { brand: 'QPRO2', siteId: 'qpro2', handle: 'P123-r124', popupId: 289 },
  { brand: 'QPRO2', siteId: 'qpro2', handle: 'P124-r125', popupId: 290 },
  { brand: 'QPRO2', siteId: 'qpro2', handle: 'P125-r126', popupId: 291 },
  { brand: 'QPRO2', siteId: 'qpro2', handle: 'P126-r127', popupId: 292 },
  { brand: 'QPRO2', siteId: 'qpro2', handle: 'P127-r128', popupId: 293 },
  { brand: 'QPRO3', siteId: 'qpro3', handle: 'P123-r124', popupId: 310 },
  { brand: 'QPRO3', siteId: 'qpro3', handle: 'P124-r125', popupId: 311 },
  { brand: 'QPRO3', siteId: 'qpro3', handle: 'P125-r126', popupId: 312 },
  { brand: 'QPRO3', siteId: 'qpro3', handle: 'P126-r127', popupId: 313 },
  { brand: 'QPRO3', siteId: 'qpro3', handle: 'P127-r128', popupId: 314 },
  { brand: 'QPRO4', siteId: 'qpro4', handle: 'P123-r124', popupId: 344 },
  { brand: 'QPRO4', siteId: 'qpro4', handle: 'P124-r125', popupId: 345 },
  { brand: 'QPRO4', siteId: 'qpro4', handle: 'P125-r126', popupId: 346 },
  { brand: 'QPRO4', siteId: 'qpro4', handle: 'P126-r127', popupId: 347 },
  { brand: 'QPRO4', siteId: 'qpro4', handle: 'P127-r128', popupId: 348 },
];

const WRONG_GAME = 'GOOSS 0';
const RIGHT_GAME = 'Gates of Olympus Super Scatter';

const bundleDir = path.resolve('captures/qc-bundles');

// Convert ISO 8601 datetime ("2026-06-24T03:40:24.000000Z") to MySQL format
// ("2026-06-24 03:40:24") which the popup PUT endpoint requires.
function toMysqlDatetime(isoStr) {
  if (!isoStr) return null;
  return isoStr.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}

// Build the PUT body from the existing popup row.
// Exclude read-only/derived fields; keep everything the BO accepts on write.
function buildPopupPutBody(row) {
  return {
    label:                 row.label,
    position:              row.position,
    session:               row.session,
    start_date:            toMysqlDatetime(row.start_date),
    end_date:              toMysqlDatetime(row.end_date),
    status:                row.status,
    platform:              row.platform,
    location:              row.location || [],
    affiliates_visibility: row.affiliates_visibility ?? 0,
    always_pop:            row.always_pop ?? 0,
    do_not_show_again:     row.do_not_show_again ?? 0,
    // Contents: keep structural fields, exclude read-only audit fields.
    contents: (row.contents || []).map((c) => ({
      id:                c.id,
      popup_id:          c.popup_id,
      locale_id:         c.locale_id,
      media_type:        c.media_type,
      desktop_link:      c.desktop_link,
      mobile_link:       c.mobile_link,
      title:             c.title,
      content:           c.content,  // patched below
      cta_button_text_1: c.cta_button_text_1,
      cta_button_link_1: c.cta_button_link_1,
      cta_button_text_2: c.cta_button_text_2,
      cta_button_link_2: c.cta_button_link_2,
    })),
  };
}

console.log('═'.repeat(70));
console.log(`FIX POPUP GAME NAME P123-P127 × QPRO2/3/4 — ${commit ? 'LIVE COMMIT' : 'DRY-RUN (add --commit to save)'}`);
console.log(`Replacing "${WRONG_GAME}" → "${RIGHT_GAME}"`);
console.log('═'.repeat(70));

let totalOk = 0, totalFail = 0, totalSkip = 0;

// Group by brand to share popup list cache (one fetch per site).
const bySite = {};
for (const t of TARGETS) {
  if (!bySite[t.siteId]) bySite[t.siteId] = [];
  bySite[t.siteId].push(t);
}

for (const [siteId, targets] of Object.entries(bySite)) {
  const site = getSite(siteId);

  // Fetch all popups for this site once.
  let allPopups = null;
  try {
    const pr = await authedFetch(site, '/api/bo/popups?perPage=500&page=1&sort_by=id&sort_order=desc');
    allPopups = pr?.data?.rows || [];
  } catch (e) {
    console.log(`  ✗ ${siteId}: could not fetch popup list — ${e.message.split('\n')[0]}`);
    for (const t of targets) { totalFail++; }
    continue;
  }

  for (const t of targets) {
    console.log(`\n── ${t.handle} ${t.brand} popup_id=${t.popupId} ──`);

    // Find popup in list.
    const popup = allPopups.find((p) => p.id === t.popupId);
    if (!popup) {
      console.log(`  ✗ Popup id=${t.popupId} not found in list`);
      totalFail++;
      continue;
    }

    // Check each locale content for GOOSS 0.
    const contents = popup.contents || [];
    let anyChanged = false;
    const patchedContents = contents.map((c) => {
      const orig = c.content || '';
      if (!orig.includes(WRONG_GAME)) return { ...c, _changed: false };
      const fixed = orig.split(WRONG_GAME).join(RIGHT_GAME);
      return { ...c, content: fixed, _changed: true };
    });

    for (const c of patchedContents) {
      const changed = c._changed;
      console.log(`  locale_id=${c.locale_id} (${c.locale_name || '?'}) — ${changed ? `PATCHING ("${WRONG_GAME}" → "${RIGHT_GAME}")` : 'no GOOSS 0 found'}`);
      if (changed) anyChanged = true;
    }

    if (!anyChanged) {
      console.log(`  → skipped (content already correct)`);
      totalSkip++;
      continue;
    }

    if (!commit) {
      console.log(`  → dry-run — would PUT popup_id=${t.popupId} with fixed content`);
      totalOk++;
      continue;
    }

    // Build PUT body with patched contents (strip _changed helper flag).
    const putBody = buildPopupPutBody({
      ...popup,
      contents: patchedContents.map(({ _changed, ...rest }) => rest),
    });

    try {
      await authedFetch(site, `/api/bo/popups/${t.popupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(putBody),
      });
      console.log(`  ✓ PUT OK — popup_id=${t.popupId}`);
    } catch (e) {
      console.log(`  ✗ PUT failed: ${e.message.split('\n')[0]}`);
      totalFail++;
      continue;
    }

    // Patch bundle on disk.
    try {
      const bundlePath = path.join(bundleDir, `${t.handle}__${t.brand}.json`);
      const raw = await readFile(bundlePath, 'utf8').catch(() => null);
      if (raw) {
        const bundle = JSON.parse(raw);
        if (bundle.live_state?.popup?.contents) {
          bundle.live_state.popup.contents = bundle.live_state.popup.contents.map((c) => ({
            ...c,
            content: (c.content || '').split(WRONG_GAME).join(RIGHT_GAME),
          }));
          bundle.live_state.popup._game_name_patched_at = new Date().toISOString();
        }
        await writeFile(bundlePath, JSON.stringify(bundle, null, 2));
        console.log(`  ✓ Bundle popup content patched`);
      }
    } catch (e) {
      console.log(`  ⚠ Bundle patch failed (non-fatal): ${e.message.split('\n')[0]}`);
    }

    totalOk++;
  }
}

console.log('\n' + '─'.repeat(50));
console.log(`Summary: ${totalOk} OK, ${totalSkip} skipped (already correct), ${totalFail} failed`);
if (!commit) console.log('(dry-run — re-run with --commit to save)');
