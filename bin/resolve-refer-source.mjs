#!/usr/bin/env node
// When an operator writes "Pls refer 'CODE' on QPROx" in column M, the
// fixture should inherit max_bonus / to_multiplier / min_deposit / per-
// currency values from the source code on the referenced brand. This
// resolves the refer pointer + applies operator overrides:
//   - instructions.add_test_prefix → prefix promo_code with TEST_
//   - Slots/LC/Sports detection in name_details_raw → categories_only
//
// Usage:
//   node bin/resolve-refer-source.mjs P071-r72       # dry-run
//   node bin/resolve-refer-source.mjs P071-r72 --commit
//
// On --commit, writes the merged fixture back to disk so the canary picks
// it up. Without --commit, prints the diff.

import fs from 'node:fs';
import { findPromotionByCode, authedFetch } from '../src/api-client.js';
import { BRAND_TO_SITE } from '../src/ingest.js';

const handle = process.argv[2];
const commit = process.argv.includes('--commit');
if (!handle) { console.error('Usage: node bin/resolve-refer-source.mjs <handle> [--commit]'); process.exit(1); }

const fixturePath = `captures/requests/${handle}.json`;
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
let referCode = fixture.instructions?.refer_to;
let referInferred = false;

// Inference: when no explicit refer_to AND fixture has gaps, infer from
// name_details_raw pattern "<RATE>% <CATEGORY> Reload" (operator convention
// per feedback_infer_refer_from_name_pattern.md). Probe BO to confirm.
if (!referCode && (fixture.gaps || []).length > 0) {
  const ndr = String(fixture.name_details_raw || '');
  const m = ndr.match(/(\d+)\s*%\s*(Slots?|LC|Live\s*Casino|Sports?|Fishing|E-?Sports?)\s+Reload/i);
  if (m) {
    const rate = m[1];
    const catRaw = m[2].toUpperCase().replace(/\s+/g, '');
    const catMap = { 'SLOT': 'SLOTS', 'SLOTS': 'SLOTS', 'LC': 'LC', 'LIVECASINO': 'LC',
                     'SPORT': 'SPORTS', 'SPORTS': 'SPORTS', 'FISHING': 'FISHING',
                     'ESPORT': 'ESPORTS', 'ESPORTS': 'ESPORTS', 'E-SPORT': 'ESPORTS', 'E-SPORTS': 'ESPORTS' };
    const cat = catMap[catRaw];
    if (cat) {
      // Try candidate prefixes
      const candidates = [`FT_REL_${cat}_${rate}PCT`, `REL_${cat}_${rate}PCT`];
      const { findPromotionByCode } = await import('../src/api-client.js');
      // Try every QPRO brand site
      const qproSites = [];
      for (let i = 1; i <= 17; i++) qproSites.push(`qpro${i}`);
      console.log(` no explicit refer_to — inferring from "${m[0]}" → trying ${candidates.join(', ')}`);
      var inferredFromBrand = null;
      outer: for (const cand of candidates) {
        for (const s of qproSites) {
          const r = await findPromotionByCode(s, cand).catch(() => null);
          if (r) {
            referCode = cand;
            referInferred = true;
            inferredFromBrand = s.toUpperCase();
            console.log(` ✓ inferred refer_to="${cand}" (found on ${s} id=${r.id})`);
            break outer;
          }
        }
      }
    }
  }
}

if (!referCode) {
  console.log(`No refer_to (explicit or inferred) for ${handle} — nothing to resolve.`);
  process.exit(0);
}
if (referInferred) {
  fixture.instructions = fixture.instructions || {};
  fixture.instructions.refer_to = referCode;
  fixture.instructions.refer_inferred = true;
}
console.log(`Resolving "${referInferred ? 'inferred ' : ''}Pls refer ${referCode}" for ${handle}…`);

// Find source promo. Priority:
//   1. Explicit brand mentioned in name_details_raw ("on QPRO2" → look up QPRO2 first)
//   2. QPRO brands in fixture.brands
//   3. All QPRO sites (broad fallback — operator may not include the source brand in the target list)
//   4. QP2 (last — has different per-currency shape)
const explicitOn = String(fixture.name_details_raw || '').match(/\bon\s+(QPRO\d+|QP2[A-D])\b/i);
const explicitBrand = explicitOn ? explicitOn[1].toUpperCase() : null;

const allQpro = [];
for (let i = 1; i <= 17; i++) allQpro.push(`QPRO${i}`);

const tryOrder = [];
if (explicitBrand) tryOrder.push(explicitBrand);
// When the refer code was INFERRED (no explicit "on X"), prefer the brand
// where the inference found it FIRST. That's typically the operator's
// canonical source (e.g. QPRO2 holding FT_REL_LC_25PCT) rather than a
// recently-saved copy of the same code on a target brand (e.g. QPRO7
// where we just saved it). Canonical sources have clean per-locale names
// with proper ZH translations.
if (typeof inferredFromBrand !== 'undefined' && inferredFromBrand && !tryOrder.includes(inferredFromBrand)) tryOrder.push(inferredFromBrand);
for (const b of (fixture.brands || []).filter((b) => /^QPRO/.test(b))) if (!tryOrder.includes(b)) tryOrder.push(b);
for (const b of allQpro) if (!tryOrder.includes(b)) tryOrder.push(b);
if (!tryOrder.some((b) => /^QP2/.test(b))) tryOrder.push('QP2A'); // ibc22 fallback as 'QP2A' marker

console.log(' lookup order:', tryOrder.slice(0, 8).join(' → '), tryOrder.length > 8 ? `... +${tryOrder.length - 8}` : '');

let sourceBrand = null;
let sourcePromoId = null;
for (const b of tryOrder) {
  const siteId = /^QP2/.test(b) ? 'ibc22' : ((BRAND_TO_SITE[b] || {}).siteId || b.toLowerCase());
  try {
    const r = await findPromotionByCode(siteId, referCode);
    if (r) {
      console.log(`   ${b} (${siteId}): id=${r.id} ← MATCH`);
      sourceBrand = b; sourcePromoId = r.id;
      break;
    }
  } catch (_) { /* try next */ }
}
if (!sourceBrand) {
  console.error(`Source code "${referCode}" not found on any brand in ${(fixture.brands||[]).join(',')}`);
  process.exit(2);
}
const sourceSite = (BRAND_TO_SITE[sourceBrand] || {}).siteId || sourceBrand.toLowerCase();
console.log(`Found on ${sourceBrand} (${sourceSite}) id=${sourcePromoId}`);

const detail = (await authedFetch(sourceSite, `/api/bo/promotion/${sourcePromoId}`)).data.rows;
const curResp = await authedFetch(sourceSite, `/api/bo/promotioncurrency?promotion_id=${sourcePromoId}&perPage=20`);
const curRows = curResp.data?.rows || [];

// Build merged fixture — only fill MISSING fields (don't override operator values).
const merged = { ...fixture };
merged.parsed = { ...(fixture.parsed || {}) };
merged.per_currency_overrides = { ...(fixture.per_currency_overrides || {}) };

// Numeric fields from source
if (merged.parsed.to_multiplier == null) {
  // Multiplier lives in target.0.multiplier on QPRO
  const tgt = Array.isArray(detail.target) ? detail.target[0] : detail.target;
  if (tgt?.multiplier != null) merged.parsed.to_multiplier = Number(tgt.multiplier);
}
if (merged.parsed.bonus_rate_pct == null && detail.bonus_rate != null) {
  merged.parsed.bonus_rate_pct = Number(detail.bonus_rate);
}

// Per-currency values from source's promotioncurrency rows
const CURRENCY_LABEL_BY_ID = { 1: 'MYR', 3: 'SGD', 4: 'IDR' };
let maxBonusFromCur = null;
let minDepFromCur = null;
for (const pc of curRows) {
  const cid = Number(pc.settings_currency_id);
  const label = CURRENCY_LABEL_BY_ID[cid];
  if (!label) continue;
  const o = merged.per_currency_overrides[label] || {};
  if (pc.min_transfer != null && o.min_deposit == null) o.min_deposit = Number(pc.min_transfer);
  if (pc.max_bonus != null && o.max_bonus == null) o.max_bonus = Number(pc.max_bonus);
  merged.per_currency_overrides[label] = o;
  if (maxBonusFromCur == null) maxBonusFromCur = Number(pc.max_bonus);
  if (minDepFromCur == null) minDepFromCur = Number(pc.min_transfer);
}
if (merged.parsed.max_bonus == null && maxBonusFromCur != null) merged.parsed.max_bonus = maxBonusFromCur;
if (merged.parsed.min_deposit == null && minDepFromCur != null) merged.parsed.min_deposit = minDepFromCur;

// Promotion name fallback — fetch per-locale rows from the source promo
// (NOT detail.name which is the BO admin label and may include suffixes
// like "REL"). Strip any trailing "REL" / "REL." just in case the source's
// per-locale rows are also dirty.
function cleanName(s) {
  return String(s || '').replace(/\s+REL\.?\s*$/i, '').replace(/\s+/g, ' ').trim();
}
try {
  const srcNamesResp = await authedFetch(sourceSite, `/api/bo/promotionname?promotion_id=${sourcePromoId}&perPage=20`);
  const srcNames = srcNamesResp.data?.rows || [];
  // Pick EN: locale_id 1 (MY_EN) or 6 (SG_EN). Pick ZH/ID: locale_id 3/7/8/9.
  const findFor = (ids) => {
    for (const id of ids) {
      const hit = srcNames.find((n) => Number(n.settings_locale_id || n.locale_id) === id);
      if (hit && hit.promotion_name) return cleanName(hit.promotion_name);
    }
    return null;
  };
  const enName = findFor([1, 6]);
  const zhName = findFor([3, 7, 9]);
  // ALWAYS prefer source's per-locale names over the fixture's column X/Y.
  // "Pls refer X" implies operator wants the source's authoritative copy.
  // Operator may have left column X stale (e.g. with a "REL" suffix from
  // a previous copy); the source row is the cleaner truth.
  if (enName) merged.promotion_name_en = enName;
  if (zhName) merged.promotion_name_zh_id = zhName;
} catch (_) { /* fall through */ }
// Final cleanup — strip "REL" from anything the operator may have left in the sheet too
if (merged.promotion_name_en) merged.promotion_name_en = cleanName(merged.promotion_name_en);
if (merged.promotion_name_zh_id) merged.promotion_name_zh_id = cleanName(merged.promotion_name_zh_id);

// Categories — detect from source name + name_details
if (!merged.instructions.categories_only) {
  const text = `${detail.name || ''} ${fixture.name_details_raw || ''}`;
  const cats = [];
  if (/slots?\b/i.test(text)) cats.push('SLOTS');
  if (/\bLC\b|live\s*casino/i.test(text)) cats.push('LIVE CASINO');
  if (/sports?\b/i.test(text)) cats.push('SPORT');
  if (cats.length) merged.instructions.categories_only = cats;
}

// Apply operator-named prefixes from remark (instruction L).
// "Add VIP to code" → VIP_, "Add GOLD to the code" → GLD_, etc.
let finalCode = merged.promo_code || referCode;
if (Array.isArray(merged.instructions?.code_prefixes)) {
  for (const prefix of merged.instructions.code_prefixes) {
    if (prefix && !finalCode.startsWith(`${prefix}_`)) {
      finalCode = `${prefix}_${finalCode}`;
    }
  }
}
// Apply TEST_ prefix. Three triggers (matches src/promo-namer.js):
//   1. instructions.add_test_prefix (remark "Add TEST to code" etc.)
//   2. requestor matches /\btest/i (e.g. "Testbot")
//   3. campaign starts with "test"
// TEST_ goes LAST so it sits at the very front of the final code.
const requestorIsTest = /\btest/i.test(String(merged.requestor || '').trim());
const campaignIsTest  = /^test\b/i.test(String(merged.campaign || '').trim());
if (
  (merged.instructions?.add_test_prefix || requestorIsTest || campaignIsTest)
  && !finalCode.startsWith('TEST_')
) {
  finalCode = `TEST_${finalCode}`;
}
merged.promo_code = finalCode;

// Recompute gaps
const newGaps = [];
const bt = (merged.bonus_type || '').toLowerCase();
if (bt.includes('deposit')) {
  if (merged.parsed.bonus_rate_pct == null) newGaps.push('bonus_rate_pct missing');
  if (merged.parsed.max_bonus == null) newGaps.push('max_bonus missing');
  if (merged.parsed.to_multiplier == null) newGaps.push('to_multiplier missing');
  if (merged.parsed.min_deposit == null && Object.keys(merged.per_currency_overrides).length === 0) newGaps.push('min_deposit missing');
}
merged.gaps = newGaps;

// Tag the resolution
merged.refer_resolved = {
  source_brand: sourceBrand,
  source_site: sourceSite,
  source_id: sourcePromoId,
  source_code: referCode,
  resolved_at: new Date().toISOString(),
};

console.log('');
console.log('Merged fixture:');
console.log('  promo_code:', merged.promo_code);
console.log('  promotion_name_en:', merged.promotion_name_en);
console.log('  parsed:', JSON.stringify(merged.parsed));
console.log('  per_currency_overrides:', JSON.stringify(merged.per_currency_overrides));
console.log('  categories_only:', JSON.stringify(merged.instructions.categories_only));
console.log('  gaps:', merged.gaps);

if (commit) {
  fs.writeFileSync(fixturePath, JSON.stringify(merged, null, 2) + '\n');
  console.log('');
  console.log(`✓ Wrote ${fixturePath}`);
} else {
  console.log('');
  console.log('(dry-run; add --commit to write the fixture)');
}
