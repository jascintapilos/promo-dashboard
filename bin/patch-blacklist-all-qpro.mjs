#!/usr/bin/env node
// Batch-apply blacklist templates to every active QPRO promo that lacks one.
//
// Strategy:
//   1. FS promos  → always "Slots Only"
//   2. Non-FS     → exact category-set match first, then "All games" fallback
//   3. No match   → skip + record in unmatched report (team must create template)
//
// Usage:
//   node bin/patch-blacklist-all-qpro.mjs              # dry-run (safe)
//   node bin/patch-blacklist-all-qpro.mjs --commit      # write to BO
//   node bin/patch-blacklist-all-qpro.mjs --site=qpro1  # single brand
//   node bin/patch-blacklist-all-qpro.mjs --commit --site=qpro1,qpro2

import { authedFetch } from '../src/api-client.js';
import { listSites } from '../src/sites.js';
import {
  resolveBlacklistTemplateId,
  getBlacklistTemplates,
  parseTemplateName,
  _resetCache,
} from '../src/blacklist-template.js';

const args   = process.argv.slice(2);
const commit = args.includes('--commit');
const siteArg = args.find(a => a.startsWith('--site='))?.replace('--site=', '');

// ─── Site list ────────────────────────────────────────────────────────────────
const allQpro = listSites().filter(s => s.platform === 'qpro').map(s => s.id);
const targetSites = siteArg
  ? siteArg.split(',').map(s => s.trim()).filter(Boolean)
  : allQpro;

// ─── PUT body helpers ─────────────────────────────────────────────────────────
function isoToYmdHms(s) {
  if (!s) return s;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : s;
}

function buildPutBody(det, blacklistId) {
  const body = { ...det, blacklist_id: blacklistId };

  // date format
  if (body.valid_from) body.valid_from = isoToYmdHms(body.valid_from);
  if (body.valid_to)   body.valid_to   = isoToYmdHms(body.valid_to);

  // nullable int FKs
  if (body.promo_p1_id == null) body.promo_p1_id = 0;

  // strip read-only / write-dangerous fields
  delete body.created_at;
  delete body.updated_at;
  delete body.deleted_at;
  delete body.created_by;
  delete body.updated_by;
  delete body.promotion_currency;   // critical — QPRO PUT wipes currency rows
  delete body.message_templates;
  delete body.dialog_popups;
  delete body.dialog_popup_list;

  // reset_frequency=0 → validator rejects as "invalid enum"
  if (body.reset_frequency === 0 || body.reset_frequency == null)
    delete body.reset_frequency;

  // FS-specific fields must be absent on non-FS promos (null fails validator)
  if (body.promo_type !== 4) {
    delete body.free_spin_game_code;
    delete body.free_spin_game_provider_id;
  }

  return body;
}

// ─── Fetch all pages of active promos for a brand ────────────────────────────
async function fetchActivePromos(site) {
  const promos = [];
  let page = 1;
  while (true) {
    const r = await authedFetch(site, `/api/bo/promotion?status=1&perPage=200&page=${page}`);
    const rows = r?.data?.rows || [];
    const arr  = Array.isArray(rows) ? rows : Object.values(rows);
    promos.push(...arr);
    const total = r?.data?.pagination?.total || r?.data?.total || arr.length;
    if (promos.length >= total || arr.length === 0) break;
    page++;
  }
  return promos;
}

// ─── Resolve categories for a promo (from detail) ────────────────────────────
async function fetchDetail(site, promoId) {
  const r = await authedFetch(site, `/api/bo/promotion/${promoId}`);
  return r?.data?.rows?.main || r?.data?.rows || r?.data;
}

// ─── Fetch category catalog (id → name) for a brand ──────────────────────────
async function fetchCatById(site) {
  try {
    const r = await authedFetch(site, '/api/bo/categories');
    const rows = r?.data?.rows || r?.data || [];
    const arr = Array.isArray(rows) ? rows : Object.values(rows);
    return Object.fromEntries(arr.map(c => [c.id, String(c.name || '').toUpperCase().trim()]));
  } catch { return {}; }
}

// ─── Build a canonical category-set key for grouping ─────────────────────────
function catKey(names) {
  return [...new Set(names)].sort().join('+');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(` QPRO Blacklist Template Batch Patch`);
console.log(` Mode   : ${commit ? '⚡ COMMIT (will PUT)' : '🔍 DRY-RUN (read-only)'}`);
console.log(` Brands : ${targetSites.join(', ')}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const summary  = [];   // per-brand totals
const unmatched = {};  // catKey → { brands: Set, codes: [{site,id,code}] }

for (const siteId of targetSites) {
  _resetCache(); // clear template cache per brand (IDs differ across brands)

  console.log(`\n━━━ ${siteId} ━━━`);

  let promos;
  try {
    promos = await fetchActivePromos(siteId);
  } catch (e) {
    console.log(`  ✗ list failed: ${e.message.split('\n')[0]}`);
    summary.push({ site: siteId, total: 0, already: 0, patched: 0, skipped: 0, errors: 0, err: e.message.split('\n')[0] });
    continue;
  }

  // Pre-fetch template list (for display) and category catalog (id→name lookup)
  let templateList = [];
  try {
    templateList = await getBlacklistTemplates(siteId);
  } catch (e) {
    console.log(`  ✗ templates failed: ${e.message.split('\n')[0]}`);
  }
  const tplMap   = Object.fromEntries(templateList.map(t => [t.id, t.name]));
  const catById  = await fetchCatById(siteId);

  // Note: list endpoint does NOT return blacklist_id — we must fetch detail per
  // promo to know its real state. Pre-filter conservatively; actual already-set
  // promos are detected in the detail loop below.
  console.log(`  Active: ${promos.length}  (fetching details to check blacklist_id...)`);

  let patched = 0, already = 0, skipped = 0, errors = 0;

  for (const p of promos) {
    try {
      // Fetch detail — blacklist_id only visible here (not on list endpoint)
      const det = await fetchDetail(siteId, p.id);
      if (!det) { errors++; continue; }

      // Skip promos that already have a blacklist template set
      if (det.blacklist_id) {
        already++;
        continue;
      }

      const isFs = det.promo_type === 4;
      const categoryNames = (det.promotion_category || []).map(c => {
        // Some brands return only category_id (no name field) — resolve via catalog
        const byName = c.name || c.category_name;
        const byId   = c.category_id ? catById[c.category_id] : null;
        return (byName || byId || String(c.category_id || '')).toUpperCase().trim();
      }).filter(Boolean);

      // Attempt resolution
      let templateId, templateName, resolveMode;
      try {
        templateId   = await resolveBlacklistTemplateId(siteId, { categoryNames, isFs });
        templateName = tplMap[templateId] || `id=${templateId}`;
        resolveMode  = isFs ? 'FS→SlotsOnly' : 'resolved';
      } catch (resolveErr) {
        // No exact match and no "All games" fallback — list for team
        const key = isFs ? 'SLOTS' : catKey(categoryNames);
        if (!unmatched[key]) unmatched[key] = { brands: new Set(), codes: [] };
        unmatched[key].brands.add(siteId);
        unmatched[key].codes.push({ site: siteId, id: p.id, code: p.code || det.code });
        skipped++;
        continue;
      }

      if (!commit) {
        console.log(`  [dry] ${det.code || p.code} → "${templateName}"`);
        patched++;
        continue;
      }

      // PUT
      const putBody = buildPutBody(det, templateId);
      await authedFetch(siteId, `/api/bo/promotion/${p.id}`, {
        method: 'PUT',
        body: putBody,
      });

      // Verify
      const v = await fetchDetail(siteId, p.id);
      const stuck = v?.blacklist_id === templateId;
      if (stuck) {
        console.log(`  ✓ ${det.code || p.code} → "${templateName}" [${resolveMode}]`);
        patched++;
      } else {
        console.log(`  ✗ ${det.code || p.code} → PUT ok but blacklist_id didn't stick (got ${v?.blacklist_id})`);
        errors++;
      }

    } catch (e) {
      const msg = (e.message || '').split('\n').slice(0, 2).join(' | ');
      console.log(`  ✗ id=${p.id} ${p.code}: ${msg}`);
      errors++;
    }
  }

  summary.push({ site: siteId, total: promos.length, already, patched, skipped, errors });
  console.log(`  → already=${already}  patched=${patched}  skipped(no template)=${skipped}  errors=${errors}`);
}

// ─── Summary table ────────────────────────────────────────────────────────────
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(` ${'Brand'.padEnd(10)} ${'Total'.padStart(6)} ${'HasTpl'.padStart(7)} ${'Patched'.padStart(8)} ${'Skipped'.padStart(8)} ${'Errors'.padStart(7)}`);
let grandTotal = 0, grandAlready = 0, grandPatched = 0, grandSkipped = 0, grandErrors = 0;
for (const s of summary) {
  console.log(` ${s.site.padEnd(10)} ${String(s.total).padStart(6)} ${String(s.already).padStart(7)} ${String(s.patched).padStart(8)} ${String(s.skipped).padStart(8)} ${String(s.errors).padStart(7)}${s.err ? `  ⚠ ${s.err}` : ''}`);
  grandTotal   += s.total;
  grandAlready += s.already;
  grandPatched += s.patched;
  grandSkipped += s.skipped;
  grandErrors  += s.errors;
}
console.log(' ' + '─'.repeat(55));
console.log(` ${'TOTAL'.padEnd(10)} ${String(grandTotal).padStart(6)} ${String(grandAlready).padStart(7)} ${String(grandPatched).padStart(8)} ${String(grandSkipped).padStart(8)} ${String(grandErrors).padStart(7)}`);

// ─── Unmatched report ─────────────────────────────────────────────────────────
const unmatchedKeys = Object.keys(unmatched);
if (unmatchedKeys.length === 0) {
  console.log('\n✅ All promos resolved — no missing templates.');
} else {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' ⚠  MISSING TEMPLATES — team action required');
  console.log(' Create these templates in BO → Blacklist Templates, then re-run.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Sort by count descending
  const sorted = unmatchedKeys
    .map(k => ({ key: k, count: unmatched[k].codes.length, brands: [...unmatched[k].brands].sort(), codes: unmatched[k].codes }))
    .sort((a, b) => b.count - a.count);

  let totalUnmatched = 0;
  for (const { key, count, brands, codes } of sorted) {
    totalUnmatched += count;
    const suggestedName = key
      ? key.split('+').filter(Boolean).map(c =>
          c.split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        ).join(', ')
      : '(no categories set)';
    console.log(`  Category set : ${key}`);
    console.log(`  Count        : ${count} promos`);
    console.log(`  Brands       : ${brands.join(', ')}`);
    console.log(`  Suggested name: "${suggestedName}"`);
    console.log(`  Example codes: ${codes.slice(0, 5).map(c => `${c.site}/${c.code}`).join('  ')}`);
    console.log('');
  }
  console.log(`  Total promos without template: ${totalUnmatched}`);
  console.log('');
  console.log('  How to fix in BO:');
  console.log('    1. Login → 3.2.1 Promotion Codes → any promo → BlackList → + Blacklist Templates');
  console.log('    2. Create one template per missing category set (set Name, assign currencies, add providers)');
  console.log('    3. Re-run: node bin/patch-blacklist-all-qpro.mjs --commit');
}

if (!commit) {
  console.log('');
  console.log('  ℹ  DRY-RUN complete. Re-run with --commit to apply changes.');
}
