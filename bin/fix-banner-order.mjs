#!/usr/bin/env node
// fix-banner-order.mjs
//
// Re-orders a brand's LIVE homepage campaign banners into the house order
// in-house -> Pragmatic Play -> other providers, by reassigning their position
// numbers. It only touches genuine campaign banners — it leaves alone:
//   • parked/footer banners (position >= --parked, default 50), e.g. Referral
//     Program / Cash Rebate sitting at position 99, and
//   • non-offer notices (Fraud Announcement, Telegram, maintenance, etc.)
// so it never floats a notice to the top of the carousel.
//
// It reuses the SAME set of position slots the campaign banners already occupy
// (it just swaps which banner sits in which), so the carousel footprint doesn't
// change — only the order within it.
//
// LIVE WRITE: --commit changes positions on public carousels. Dry-run by default.
//
//   node bin/fix-banner-order.mjs                  # dry-run, all live QPRO+QP2
//   node bin/fix-banner-order.mjs --site=qpro1     # one brand
//   node bin/fix-banner-order.mjs --commit         # apply the re-ordering
//   node bin/fix-banner-order.mjs --parked=40      # parked-position threshold

import { parseArgs } from './_args.js';
import { getSite, listSites } from '../src/sites.js';
import { getAllBanners, updateBanner, bannerUpdateBody } from '../src/api-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = !!flags.commit;
const PARKED_POS = Number(flags.parked) > 0 ? Number(flags.parked) : 50;
const NOW = Date.now();
const CANARY = new Set(['qpro11', 'qpro13']);

const liveNow = (r) => {
  const s = new Date(r.start_datetime).getTime();
  const e = new Date(r.end_datetime).getTime();
  return s <= NOW && e >= NOW;
};

// Provider classification (matches banner-health-check).
const PP_RE = /\bpragmatic\s*play\b|pragmaticplay|\bpp\b/i;
const PROVIDER_OTHER = [
  'microgaming', 'fastspin', 'fast spin', 'playtech', 'pg soft', 'pgsoft', 'habanero',
  'evolution', 'ezugi', 'spadegaming', 'jili', 'cq9', 'joker', 'jdb', 'live22', 'playstar',
  'advantplay', 'nextspin', 'red tiger', 'redtiger', 'netent', 'mega888', '918kiss',
];
// Non-offer notices that should NOT be reordered (left wherever they sit).
const UTILITY_RE = /announcement|fraud|telegram|maintenance|\bnotice\b|security|terms/i;

const RANK = { inhouse: 0, pp: 1, other: 2 };
const CAT = { inhouse: 'in-house', pp: 'PP', other: 'other' };
function classify(label) {
  const s = String(label || '');
  if (PP_RE.test(s)) return 'pp';
  const lc = s.toLowerCase();
  if (PROVIDER_OTHER.some((k) => lc.includes(k))) return 'other';
  return 'inhouse';
}

console.log(`\n== Fix banner order (in-house -> PP -> other) ${COMMIT ? '[COMMIT]' : '[dry-run]'} ==`);
console.log(`Parked threshold: positions >= ${PARKED_POS} left untouched; notices left untouched\n`);

const targets = (flags.site ? [getSite(flags.site)] : listSites())
  .filter((s) => (s.platform === 'qpro' || s.platform === 'qp2') && !CANARY.has(s.id));

let brandsFixed = 0;
let writes = 0;
const pending = [];

for (const site of targets) {
  let rows;
  try { rows = (await getAllBanners(site, { status: 1 })).rows || []; }
  catch (e) { console.log(`x  ${site.id} fetch failed: ${e.message.split('\n')[0]}`); continue; }

  // Group by merchant (QP2 multi-merchant via site_id; QPRO single brand).
  const groups = new Map();
  for (const r of rows) {
    if (r.platform_type_id !== 1 || !liveNow(r)) continue;
    const m = site.platform === 'qp2' ? `site${r.site_id}` : site.id;
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(r);
  }

  for (const [merchant, list] of groups) {
    // Reorderable = real campaign banners: in carousel range, not a notice.
    const reorderable = list
      .filter((r) => (Number(r.position) || 0) < PARKED_POS && !UTILITY_RE.test(r.label || ''))
      .map((r) => ({ r, cat: classify(r.label), pos: Number(r.position) || 0 }))
      .sort((a, b) => a.pos - b.pos || a.r.id - b.r.id);

    // Already in non-decreasing rank order? Then nothing to do.
    const ranks = reorderable.map((x) => RANK[x.cat]);
    const ordered = ranks.every((v, i) => i === 0 || v >= ranks[i - 1]);
    if (ordered) continue;

    // Target order: stable sort by (rank, current position). Reuse the SAME
    // position slots so the carousel footprint is unchanged.
    const slots = reorderable.map((x) => x.pos).sort((a, b) => a - b);
    const target = [...reorderable].sort((a, b) => RANK[a.cat] - RANK[b.cat] || a.pos - b.pos || a.r.id - b.r.id);

    const moves = [];
    target.forEach((x, i) => {
      const newPos = slots[i];
      if (newPos !== x.pos) moves.push({ row: x.r, cat: x.cat, from: x.pos, to: newPos });
    });
    if (!moves.length) continue;

    brandsFixed++;
    console.log(`${site.id}/${merchant}: reordering ${moves.length} banner(s)`);
    console.log(`   before: ${reorderable.map((x) => `${CAT[x.cat]}@${x.pos}`).join(' -> ')}`);
    console.log(`   after:  ${target.map((x, i) => `${CAT[x.cat]}@${slots[i]}`).join(' -> ')}`);
    for (const mv of moves) {
      console.log(`     #${String(mv.row.id).padEnd(5)} ${CAT[mv.cat].padEnd(8)} pos ${mv.from} -> ${mv.to}  ${mv.row.label}`);
      pending.push({ site, ...mv });
    }
  }
}

if (!brandsFixed) {
  console.log('All live campaign carousels are already in the correct order. Nothing to fix. ✓');
  process.exit(0);
}

console.log(`\n${brandsFixed} brand(s) need re-ordering, ${pending.length} position change(s).`);

if (!COMMIT) {
  console.log('\nDry-run only. Re-run with --commit to apply (live write to public carousels).');
  process.exit(0);
}

console.log('\nCommitting…');
for (const { site, row, to } of pending) {
  try {
    await updateBanner(site, row.id, bannerUpdateBody(row, { position: to }));
    console.log(`  OK  ${site.id}/#${row.id} -> pos ${to}`);
    writes++;
  } catch (e) {
    console.log(`  x   ${site.id}/#${row.id} FAILED: ${e.message.split('\n')[0]}`);
  }
  await new Promise((r) => setTimeout(r, 1200));
}
console.log(`\nRe-ordered ${writes}/${pending.length} banner position(s).`);
