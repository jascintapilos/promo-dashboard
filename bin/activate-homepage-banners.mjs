#!/usr/bin/env node
// activate-homepage-banners.mjs  (Phase 1 of the thin-homepage fix)
//
// Brings thin brands UP TO the healthy floor (--min, default 5) of live
// homepage banners by ACTIVATING already-built, currently-in-window banners
// that are sitting Inactive. It only activates as many as needed to reach the
// floor — it never pads beyond it, and never activates banners whose live
// window isn't open now.
//
// LIVE WRITE: with --commit it flips banner status 0->1 on PUBLIC carousels.
// Default is a dry-run plan. Mechanism verified on the qpro13 canary 2026-06-11.
//
//   node bin/activate-homepage-banners.mjs                       # dry-run, default brands
//   node bin/activate-homepage-banners.mjs --site=qpro2          # one brand
//   node bin/activate-homepage-banners.mjs --min=5               # floor (default 5)
//   node bin/activate-homepage-banners.mjs --ids="qpro2:3,10;qpro3:4,5;qpro7:4"
//                                                                # pick EXACT banners to activate
//   node bin/activate-homepage-banners.mjs --ids="..." --commit  # actually activate
//
// Selection: if --ids names banners for a brand, those are used (validated as
// inactive in-window candidates). Otherwise the default is the lowest-position
// candidates, capped at (min - currentLive).

import { parseArgs } from './_args.js';
import { getSite } from '../src/sites.js';
import { getAllBanners, updateBanner, bannerUpdateBody } from '../src/api-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const MIN = Number(flags.min) > 0 ? Number(flags.min) : 5;
const COMMIT = !!flags.commit;
const NOW = Date.now();

// Brands the diagnosis found reachable-by-activation (live + parked-in-window >= 5).
const DEFAULT_SITES = ['qpro2', 'qpro3', 'qpro7'];
const targetIds = flags.site ? [String(flags.site)] : DEFAULT_SITES;

// Parse --ids="qpro2:3,10;qpro3:4,5" into { qpro2:[3,10], qpro3:[4,5] }.
const explicit = {};
if (flags.ids && flags.ids !== true) {
  for (const part of String(flags.ids).split(';').filter(Boolean)) {
    const [site, idList] = part.split(':');
    explicit[site.trim()] = (idList || '').split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
  }
}

const liveNow = (r) => {
  const s = new Date(r.start_datetime).getTime();
  const e = new Date(r.end_datetime).getTime();
  return s <= NOW && e >= NOW;
};

console.log(`\n== Activate homepage banners (top-up to ${MIN}) ${COMMIT ? '[COMMIT]' : '[dry-run]'} ==\n`);

let totalToActivate = 0;
const plan = [];

for (const id of targetIds) {
  const site = getSite(id);
  const [active, inactive] = await Promise.all([
    getAllBanners(site, { status: 1 }),
    getAllBanners(site, { status: 0 }),
  ]);
  const live = (active.rows || []).filter((r) => r.platform_type_id === 1 && liveNow(r));
  const candidates = (inactive.rows || [])
    .filter((r) => r.platform_type_id === 1 && liveNow(r))
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0) || (a.id - b.id));

  const need = Math.max(0, MIN - live.length);
  if (need === 0) {
    console.log(`${id.padEnd(7)} already at ${live.length} live (>=${MIN}) — nothing to do`);
    continue;
  }

  let pick;
  if (explicit[id]) {
    pick = explicit[id]
      .map((wantId) => candidates.find((c) => c.id === wantId))
      .filter(Boolean);
    const missing = explicit[id].filter((wid) => !candidates.find((c) => c.id === wid));
    if (missing.length) console.log(`${id.padEnd(7)} ⚠ requested id(s) not inactive-in-window, skipped: ${missing.join(', ')}`);
    if (pick.length > need) {
      console.log(`${id.padEnd(7)} ⚠ you named ${pick.length} but only ${need} needed to reach ${MIN}; activating all ${pick.length} you named`);
    }
  } else {
    pick = candidates.slice(0, need); // default: lowest-position, capped at need
  }

  console.log(`${id.padEnd(7)} live=${live.length} need=+${need} → activating ${pick.length}:`);
  for (const c of pick) console.log(`         #${String(c.id).padEnd(5)} pos ${String(c.position).padEnd(3)} ${c.label}`);
  if (!pick.length) console.log('         (no candidates selected)');
  plan.push({ site, id, pick });
  totalToActivate += pick.length;
}

console.log(`\nTotal to activate: ${totalToActivate}`);

if (!COMMIT) {
  console.log('\nDry-run only. Re-run with --commit to activate (live write to public carousels).');
  process.exit(0);
}

if (!totalToActivate) {
  console.log('Nothing to activate.');
  process.exit(0);
}

// ── Commit ─────────────────────────────────────────────────────────────────
console.log('\nCommitting…');
const results = [];
for (const { site, id, pick } of plan) {
  for (const row of pick) {
    try {
      await updateBanner(site, row.id, bannerUpdateBody(row, { status: 1 }));
      console.log(`  OK  ${id}/#${row.id} activated — ${row.label}`);
      results.push({ id, bannerId: row.id, ok: true });
    } catch (e) {
      console.log(`  x   ${id}/#${row.id} FAILED: ${e.message.split('\n')[0]}`);
      results.push({ id, bannerId: row.id, ok: false });
    }
    await new Promise((r) => setTimeout(r, 1200)); // BO throttle guard
  }
}

// ── QC: re-fetch and confirm each brand now meets the floor ──────────────────
console.log('\nQC — re-checking live homepage counts:');
for (const { site, id } of plan) {
  const active = await getAllBanners(site, { status: 1 });
  const live = (active.rows || []).filter((r) => r.platform_type_id === 1 && liveNow(r));
  const ok = live.length >= MIN;
  console.log(`  ${ok ? 'OK ' : '!! '} ${id.padEnd(7)} now ${live.length} live homepage banner(s)${ok ? '' : ` — still below ${MIN}`}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nActivated ${results.filter((r) => r.ok).length}/${results.length}${failed ? ` (${failed} failed)` : ''}.`);
if (failed) process.exitCode = 2;
