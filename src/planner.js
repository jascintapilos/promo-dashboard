// Phase 4 — Dry-run planner.
//
// Given an ingested request record (or a Request ID), produces:
//   1. A resolved record — duplicate_of references followed and parsed
//      fields inherited from the parent code.
//   2. A platform-specific BO Config Plan in markdown, matching the format
//      that the promo-bo-config-qp2 / promo-bo-config-qpro skills produce.
//   3. A validation gate that refuses to mark a plan READY if any required
//      field is still missing post-resolution.
//
// Nothing in this module touches the BO. It only reads from captures/requests/.

import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BRAND_TO_SITE, REGION_TO_CURRENCY_LOCALES } from './ingest.js';

// ── Loading ──────────────────────────────────────────────────────────────
// All resolution operates over a pre-loaded map of {request_id → record}.
// The map also lets us index by promo_code for duplicate_of lookup.

export async function loadAllRequests(dir = 'captures/requests') {
  const root = path.resolve(dir);
  let names;
  try { names = await readdir(root); }
  catch (e) {
    if (e.code === 'ENOENT') return { byHandle: new Map(), byId: new Map(), byCode: new Map() };
    throw e;
  }
  // byHandle keys on the unique composite (e.g. P069-r77) — never collides.
  // byId keys on the Request Number alone and returns the CURRENT-MONTH
  // record (the one with the highest source_line). The team's spreadsheet
  // reuses P### numbers across months, so picking the first match leads to
  // wrong-target moments. The current-month rule is canonical — see
  // memory/feedback_promo_request_sheet_current_month.md.
  // byCode is the parent-lookup index used by resolveDuplicates.
  const byHandle = new Map();
  const byId = new Map();
  const byCode = new Map();
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const rec = JSON.parse(await readFile(path.join(root, n), 'utf8'));
    const handle = rec.handle || rec.request_id;
    byHandle.set(handle, rec);
    // Prefer higher source_line (= newer month tab) when the same P###
    // appears multiple times.
    const existing = byId.get(rec.request_id);
    if (!existing || (Number(rec.source_line) || 0) > (Number(existing.source_line) || 0)) {
      byId.set(rec.request_id, rec);
    }
    if (rec.promo_code) byCode.set(rec.promo_code, rec);
  }
  return { byHandle, byId, byCode };
}

// Resolve a user-supplied request identifier to the canonical handle.
// Accepts:
//   - "P065-r1435"  → returned as-is (full handle)
//   - "P065"        → resolved to the CURRENT-MONTH row's handle (highest
//                     source_line among matching files)
// Returns null if no match.
export function resolveHandle(input, { byHandle, byId }) {
  if (!input) return null;
  if (byHandle.has(input)) return input;
  // Bare P### — pick the current-month record from byId.
  const rec = byId.get(input);
  if (rec) return rec.handle || rec.request_id;
  return null;
}

// ── Resolver ─────────────────────────────────────────────────────────────
// Walk duplicate_of chains. Merges parent.parsed + parent.per_currency_overrides
// into the current row, then overlays the current row's own values (so this
// row's overrides win over the parent's). Tracks the inheritance chain so
// the human can see what was inherited and from where.
//
// Parent-code lookup order:
//   1. The recent request log (byCode).
//   2. If not found there, the BO snapshot (boIndex + boFetcher) — a code
//      set up months ago is still live in the BO and can be reconstructed
//      from its detail endpoints.
//
// The resolver is async because the BO fallback fetches over the network.
// In-process detail caching (in bo-cache.js) makes batch runs efficient —
// each parent code is fetched once even if many children reference it.

const mergeNonNull = (p = {}, c = {}) => {
  const out = { ...p };
  for (const [k, v] of Object.entries(c)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
};
const mergePerCurrency = (p = {}, c = {}) => {
  const out = { ...p };
  for (const [ccy, overrides] of Object.entries(c)) {
    out[ccy] = { ...(p[ccy] || {}), ...overrides };
  }
  return out;
};

export async function resolveDuplicates(record, byCode, opts = {}, _chain = []) {
  const ref = record.parsed?.duplicate_of;
  if (!ref) return { ...record, _resolution: { inherited_from: null, chain: _chain } };

  if (_chain.includes(ref)) {
    return {
      ...record,
      _resolution: {
        inherited_from: null,
        chain: _chain.concat(ref),
        error: `cycle detected: ${_chain.concat(ref).join(' → ')}`,
      },
    };
  }

  // 1) Try the request log first.
  let parent = byCode.get(ref);
  let parentSource = 'request-log';

  // 2) Fallback: look up in the BO snapshot.
  if (!parent && opts.boIndex && opts.boFetcher) {
    // Hint the fetcher with the platform-mapped site id for this row's
    // primary brand, so it picks the matching BO when the same code exists
    // on multiple merchants.
    const platformBrand = record.brands?.find((b) => BRAND_TO_SITE[b]);
    const siteIdHint = platformBrand ? BRAND_TO_SITE[platformBrand].siteId : null;
    parent = await opts.boFetcher(ref, opts.boIndex, { siteIdHint });
    if (parent) parentSource = `bo (${parent._bo_site || '?'})`;
  }

  if (!parent) {
    return {
      ...record,
      _resolution: {
        inherited_from: null,
        chain: _chain.concat(ref),
        error: `referenced code "${ref}" not found in request log or BO snapshot`,
      },
    };
  }

  // Recurse only if the parent itself has duplicate_of (BO records never do,
  // request-log records sometimes do).
  const resolvedParent = parent.parsed?.duplicate_of
    ? await resolveDuplicates(parent, byCode, opts, _chain.concat(ref))
    : { ...parent, _resolution: { inherited_from: null, chain: _chain.concat(ref) } };

  return {
    ...record,
    parsed: mergeNonNull(resolvedParent.parsed, record.parsed),
    per_currency_overrides: mergePerCurrency(resolvedParent.per_currency_overrides, record.per_currency_overrides),
    _resolution: {
      inherited_from: ref,
      inherited_via: parentSource,
      chain: _chain.concat(ref),
      error: resolvedParent._resolution?.error || null,
    },
  };
}

// ── Validation ───────────────────────────────────────────────────────────
// Returns an array of missing-field descriptions. Empty array = ready.

export function validatePlan(resolved) {
  const gaps = [];
  const r = resolved.parsed || {};
  const bt = (resolved.bonus_type || '').toLowerCase();

  if (!resolved.promo_code) gaps.push('promo_code');
  if (!resolved.brands || resolved.brands.length === 0) gaps.push('brand');
  if (!resolved.currencies || resolved.currencies.length === 0) gaps.push('currencies');
  if (!resolved.bonus_type) gaps.push('bonus_type');

  if (bt.includes('free spin')) {
    if (r.spin_count == null)     gaps.push('spin_count');
    if (r.value_per_spin == null) gaps.push('value_per_spin');
    if (r.to_multiplier == null)  gaps.push('to_multiplier');
    if (r.game == null && (!r.game_by_brand || Object.keys(r.game_by_brand).length === 0)) gaps.push('game');
  } else if (bt.includes('free credit')) {
    if (r.free_credit_amount == null) gaps.push('free_credit_amount');
    if (r.to_multiplier == null)      gaps.push('to_multiplier');
  } else if (bt.includes('deposit')) {
    if (r.bonus_rate_pct == null) gaps.push('bonus_rate_pct');
    if (r.max_bonus == null)      gaps.push('max_bonus');
    if (r.to_multiplier == null)  gaps.push('to_multiplier');
    if (r.min_deposit == null && Object.keys(resolved.per_currency_overrides || {}).length === 0) {
      gaps.push('min_deposit');
    }
  }

  if (resolved._resolution?.error) gaps.push(`resolution: ${resolved._resolution.error}`);

  return gaps;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function effectiveMinDep(resolved, currency) {
  return resolved.per_currency_overrides?.[currency]?.min_deposit ?? resolved.parsed?.min_deposit ?? null;
}

function effectiveMaxBonus(resolved, currency) {
  return resolved.per_currency_overrides?.[currency]?.max_bonus ?? resolved.parsed?.max_bonus ?? null;
}

function fmt(v) {
  if (v === null || v === undefined || v === '') return '⚠️  MISSING';
  return String(v);
}

// ── QP2 plan renderer ────────────────────────────────────────────────────

export function renderQp2Plan(resolved, { brand } = {}) {
  const r = resolved.parsed || {};
  const status = validatePlan(resolved).length === 0 ? '✅ READY' : '⛔ BLOCKED';
  const bt = (resolved.bonus_type || '').toLowerCase();
  const isFs = bt.includes('free spin');
  const isFc = bt.includes('free credit');
  const isDep = bt.includes('deposit');

  // Brand for this plan instance — pick from the row's brands, or the override.
  const planBrand = brand || resolved.brands.find((b) => BRAND_TO_SITE[b]?.platform === 'qp2');
  const merchantName = BRAND_TO_SITE[planBrand]?.merchantName || planBrand;

  const validity = resolved.validity_days ?? 30;
  const rewardsValidity = resolved.rewards_validity_days ?? validity;
  const frequency = resolved.recurring === false ? 'Once' : 'Daily';
  const eligibleTypes = isFs && !resolved.parsed?.deposit_status ? 'Members' : 'Members';
  const memberGroup = 'default';
  const recurring = resolved.recurring === true ? 'Yes' : (resolved.recurring === false ? 'No' : '⚠️  MISSING');
  const depositStatus = isFc && /no\s+min\s+dep/i.test(resolved.name_details_raw || '') ? 'None' : 'Last Deposit';

  const inherited = resolved._resolution?.inherited_from
    ? `\nINHERITED FROM: ${resolved._resolution.inherited_from}` +
      (resolved._resolution.chain.length > 1 ? ` (chain: ${resolved._resolution.chain.join(' → ')})` : '')
    : '';
  const errLine = resolved._resolution?.error ? `\n⚠ RESOLUTION ERROR: ${resolved._resolution.error}` : '';

  // Per-currency block
  function currencyBlock(currency, n) {
    const minDep = effectiveMinDep(resolved, currency);
    const maxBonus = effectiveMaxBonus(resolved, currency);
    const lines = [
      `  ${n}.  Open Promotion Currency popup → Add ${currency}`,
      `  ${n+1}. Eligible Time           → 00:00:00 – 23:59:59`,
      `  ${n+2}. Max Total Applications  → Unlimited`,
      `  ${n+3}. Max Total Amount        → Unlimited`,
      `  ${n+4}. Min Wallet Balance      → ${fmt(minDep)}`,
      `  ${n+5}. Type of Max Withdraw    → Fixed Amount`,
      `  ${n+6}. Status                  → Active`,
    ];
    if (isFs) {
      lines.push(
        `  ${n+7}. Bonus Type             → Free Spin`,
        `  ${n+8}. Spin Count             → ${fmt(r.spin_count)}`,
        `  ${n+9}. Value Per Spin         → ${fmt(r.value_per_spin)}`,
        `  ${n+10}. Max Withdraw         → Unlimited`,
      );
    } else if (isFc) {
      lines.push(
        `  ${n+7}. Bonus Type             → Fixed Amount`,
        `  ${n+8}. Free Credit Amount     → ${fmt(r.free_credit_amount)}`,
        `  ${n+9}. Max Withdraw           → ${fmt(r.max_transfer_out ?? 'Unlimited')}`,
      );
    } else if (isDep) {
      lines.push(
        `  ${n+7}. Bonus Type             → Percentage`,
        `  ${n+8}. Bonus Rate (%)         → ${fmt(r.bonus_rate_pct)}`,
        `  ${n+9}. Max Bonus              → ${fmt(maxBonus)}`,
        `  ${n+10}. Max Withdraw         → Unlimited`,
      );
    }
    lines.push(`  ${n+11}. Save  [CLOSE POPUP]`);
    return lines.join('\n');
  }

  // Promotion Names block (per locale)
  const promoNameEn = resolved.promotion_name_en;
  const promoNameZh = resolved.promotion_name_zh_id;
  const localeRows = resolved.locales.map((l, i) => {
    const name = l.endsWith('_EN') ? promoNameEn : promoNameZh;
    return `  ${41 + i}.  ${l.replace('_', ' / ')}  → ${fmt(name)}   (Rewards Name = same)`;
  });

  const currencyBlocks = resolved.currencies
    .map((c, i) => `  For [${c}]:\n${currencyBlock(c, 29 + i * 13)}`)
    .join('\n\n  [next currency]\n');

  return [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `BO CONFIG PLAN — ${resolved.promo_code} (QP2)`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `STATUS:   ${status}`,
    `REQUEST:  ${resolved.request_id} (${resolved.requestor})`,
    `BRAND:    ${planBrand} (merchant: ${merchantName})`,
    `REGIONS:  ${resolved.regions.join(', ')}`,
    `CURRENCIES: ${resolved.currencies.join(', ')}`,
    `LOCALES:  ${resolved.locales.join(', ')}`,
    inherited.trim() ? inherited.trimStart() : '',
    errLine.trim() ? errLine.trimStart() : '',
    '',
    '▼ MAIN SCREEN — Create Promotion Code',
    '',
    '  ┌─ A. Basic Info ─────────────────────',
    `  1.  Type Code            → ${resolved.promo_code}`,
    `  2.  Type Name            → ${fmt(promoNameEn)}`,
    `  3.  Click Types dropdown → ${fmt(resolved.bonus_type)}`,
    `  4.  In sub-dropdown      → ${fmt(resolved.bonus_sub_type)}`,
    `  5.  Status               → Active`,
    '',
    '  ┌─ B. Display Settings ───────────────',
    `  6.  Set Valid From       → (current datetime at setup)`,
    `  7.  Set Valid To         → (leave blank)`,
    `  8.  Set Validity         → ${validity} days`,
    `  9.  Set Rewards Validity → ${rewardsValidity} days`,
    `  10. Frequency            → ${frequency}`,
    '',
    '  ┌─ C. Eligibility ────────────────────',
    `  11. Select Merchant      → ${planBrand}`,
    `  12. Eligible Types       → ${eligibleTypes}`,
    `  13. Member Group         → ${memberGroup}`,
    `  14. Recurring            → ${recurring}`,
    `  15. Deposit Status       → ${depositStatus}`,
    '',
    '  ┌─ D. Bonus Conditions (checkboxes) ──',
    '  16. Allow Deposit                → OFF',
    '  17. Auto Approve                 → ON',
    '  18. Auto Reward Activation       → OFF',
    '  19. Auto Unlock                  → OFF',
    '  20. Unlock Upon Withdrawal       → OFF',
    '  21. Fingerprint Check            → OFF',
    `  22. Check Incomplete Free Spin   → ${isFs ? 'ON' : 'OFF'}`,
    '',
    '  ┌─ E. Target Amount ──────────────────',
    '  23. Target Type          → Turnover',
    '  24. Wallet               → (include)',
    `  25. Target Multiplier    → ${fmt(r.to_multiplier)}x`,
    '',
    '  ┌─ F. Game / Category Settings ───────',
    `  26. Tick Categories      → ${(r.categories || ['(from input)']).join(', ')}`,
    `      (do NOT tick: Arcade, Cock Fight, Lottery, Table)`,
    `  27. Select Game Providers:`,
    isFs
      ? `      • Free Spin → Pragmatic Play ONLY`
      : `      • all EXCEPT 918KAYA, ALLBET, DREAM GAMING, HABANERO, KINGMIDAS, PNG, PP, SBO, SSG, YL GAMING`,
    isFs ? `  28. Select Game          → ${fmt(r.game)}` : '',
    '',
    `▼ G. PROMOTION CURRENCY  [OPENS POPUP × ${resolved.currencies.length} currencies]`,
    '',
    currencyBlocks,
    '',
    `▼ H. PROMOTION NAMES  [OPENS POPUP × ${resolved.locales.length} locales]`,
    '',
    localeRows.join('\n'),
    `  ${41 + resolved.locales.length}. [CLOSE POPUP]`,
    '',
    `▼ I. GAME PROVIDER BLACKLIST  [OPENS POPUP]   ★ REQUIRED — right after Game Categories`,
    `   Rule: pick the Template whose name = the categories selected (e.g. "Live Casino + Slots" → "Live Casino and Slot")`,
    `   Categories on this promo: ${(r.categories || ['Slots']).join(', ')}`,
    `  ${50 + resolved.locales.length}. Click the "Template:" dropdown → select the template that matches this category set`,
    `  ${51 + resolved.locales.length}. If no matching template exists on this brand, click "+ Blacklist Templates" → create one named after the category set, tick sub-game-types, Submit, then re-select it`,
    `  ${52 + resolved.locales.length}. Apply to other currencies (MYR, SGD${resolved.currencies.includes('IDR') ? ', IDR' : ''}) if not already covered`,
    `  ${53 + resolved.locales.length}. Submit  [CLOSE POPUP]`,
    '',
    '▼ FINAL',
    `  ${60 + resolved.locales.length}. Review all fields on main screen`,
    `  ${61 + resolved.locales.length}. STOP — wait for user confirmation before clicking Save/Submit`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].filter((s) => s !== null).join('\n');
}

// ── QPRO plan renderer ───────────────────────────────────────────────────

export function renderQproPlan(resolved, { brand } = {}) {
  const r = resolved.parsed || {};
  const status = validatePlan(resolved).length === 0 ? '✅ READY' : '⛔ BLOCKED';
  const bt = (resolved.bonus_type || '').toLowerCase();
  const isFs = bt.includes('free spin');
  const isFc = bt.includes('free credit');
  const isDep = bt.includes('deposit');

  const planBrand = brand || resolved.brands.find((b) => BRAND_TO_SITE[b]?.platform === 'qpro');
  const siteInfo = BRAND_TO_SITE[planBrand] || {};
  const merchantName = siteInfo.merchantName || planBrand;

  const validity = resolved.validity_days ?? 30;
  const rewardsValidity = resolved.rewards_validity_days ?? validity;
  const recurring = resolved.recurring === true ? 'Recurring' : (resolved.recurring === false ? 'One Time' : '⚠️  MISSING');

  const inherited = resolved._resolution?.inherited_from
    ? `\nINHERITED FROM: ${resolved._resolution.inherited_from}`
    : '';
  const errLine = resolved._resolution?.error ? `\n⚠ RESOLUTION ERROR: ${resolved._resolution.error}` : '';

  // Per-currency popup block (QPRO is simpler than QP2 — fewer fields)
  function currencyBlock(currency, n) {
    const minDep = effectiveMinDep(resolved, currency);
    const maxBonus = effectiveMaxBonus(resolved, currency);
    return [
      `  ${n}.  Click "+ Promotion Currency" button`,
      `  ${n+1}. Currency               → ${currency}`,
      `  ${n+2}. Max Total Applications → 0 (Unlimited)`,
      `  ${n+3}. Max Total Amount       → 0 (Unlimited)`,
      `  ${n+4}. Min Transfer           → ${fmt(minDep)}`,
      `  ${n+5}. Max Bonus              → ${fmt(maxBonus)}`,
      `  ${n+6}. Max Transfer Out       → 0 (Unlimited)`,
      `  ${n+7}. Status                 → Active`,
      `  ${n+8}. Submit  [CLOSE POPUP]`,
    ].join('\n');
  }

  const currencyBlocks = resolved.currencies
    .map((c, i) => `  For [${c}]:\n${currencyBlock(c, 45 + i * 10)}`)
    .join('\n\n');

  // Promotion Names — QPRO supports ID locales too
  const localeRows = resolved.locales.map((l, i) => {
    const isEn = l.endsWith('_EN');
    const name = isEn ? resolved.promotion_name_en : resolved.promotion_name_zh_id;
    return `  ${55 + i}.  ${l.replace('_', ' / ')}  → ${fmt(name)}`;
  });

  // Free Spin Games (FS only)
  const fsGames = isFs && r.game
    ? `Add provider tag + game tag: PP2 - Pragmatic Play / ${r.game} (game tag — verify in BO)`
    : isFs ? '⚠️  MISSING (FS requires provider + game tags)' : 'N/A';

  return [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `QPRO BO CONFIG PLAN — ${resolved.promo_code}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `STATUS:   ${status}`,
    `REQUEST:  ${resolved.request_id} (${resolved.requestor})`,
    `BRAND:    ${planBrand} (merchant: ${merchantName})`,
    `REGIONS:  ${resolved.regions.join(', ')}`,
    `CURRENCIES: ${resolved.currencies.join(', ')}`,
    `LOCALES:  ${resolved.locales.join(', ')}`,
    inherited.trim() ? inherited.trimStart() : '',
    errLine.trim() ? errLine.trimStart() : '',
    '',
    '▼ MAIN SCREEN — Edit Promotion Code (3-column layout)',
    '',
    '  ┌─ A. Basic Info (left column) ───────',
    `  1.  Type Code                    → ${resolved.promo_code}`,
    `  2.  Type Name                    → ${fmt(resolved.promotion_name_en)}`,
    `  3.  Types (top dropdown)         → ${fmt(resolved.bonus_type)}`,
    `  4.  Types (bottom dropdown)      → ${fmt(resolved.bonus_sub_type)}`,
    isFs ? `  5.  Free Spin Games              → ${fsGames}` : '',
    `  6.  Linked Promotions            → (blank)`,
    `  7.  Restrict Claim If Bonus Round Active → ${isFs ? 'ON' : 'OFF'}`,
    isFs ? `  8.  Restrict Other Game Same Provider → OFF` : '',
    '',
    '  ┌─ Bonus (left column) ───────────────',
    `  9.  Limit Provider Transfer In   → ON`,
    `  10. Limit Provider Transfer Out  → ON`,
    `  11. Bonus Rate %                 → ${isFs || isFc ? '0.00' : fmt(r.bonus_rate_pct)}`,
    `  12. Auto Unlock                  → ON`,
    `  13. Allow Cancel Promotion       → OFF`,
    '',
    '  ┌─ KYC Verification (left column) ────',
    `  14. Type                         → KYC Status`,
    `  15. KYC Status                   → tick eligible tiers (Basic / Advanced / Pro)`,
    '',
    '  ┌─ B. Basic Setting (center column) ──',
    `  16. Set Valid From               → (current datetime at setup)`,
    `  17. Set Valid To                 → (leave blank)`,
    `  18. Set Validity                 → ${validity} days`,
    `  19. Set Rewards Validity         → ${rewardsValidity} (0 = unlimited)`,
    `  20. Frequency                    → Daily Max`,
    '',
    '  ┌─ Target Amount — Turnover (center) ─',
    `  21. Target Type                  → Turnover (locked)`,
    `  22. Transfer Amount              → Included (radio)`,
    `  23. Target Multiplier            → ${fmt(r.to_multiplier)}`,
    `  24. Tick Categories              → ${(r.categories || ['(from input)']).join(', ')}`,
    `  25. Select Game Providers        → ${isFs ? 'handled via Free Spin Games above' : 'all EXCEPT Layer 1 exclusions'}`,
    '',
    '  ┌─ C. Eligibility (right column) ─────',
    `  32. Eligible Types               → Members`,
    `  33. Member Group                 → default`,
    `  34. Visible by Affiliate         → OFF`,
    `  35. Last Deposit                 → ${(isFc && /no\s+min\s+dep/i.test(resolved.name_details_raw || '')) ? 'OFF (no-deposit bonus)' : 'ON'}`,
    `  36. Auto Approve                 → ON`,
    `  37. Recurring                    → ${recurring}`,
    `  38. Reset Frequency              → Daily Max (radio)`,
    `  39. Max Per Player (Lifetime)    → 99999 (default; 0 = unlimited)`,
    `  40. Daily Max                    → 1`,
    `  41. Status                       → Active`,
    '',
    '  ┌─ Message (right column) ────────────',
    `  42. SMS                          → (blank unless specified)`,
    `  43. Message                      → (auto-fills as PROMOTIONS.MESSAGE.${resolved.promo_code})`,
    `  44. Dialog Popup                 → (blank unless specified)`,
    '',
    `▼ Promotion Currency  [OPENS POPUP × ${resolved.currencies.length} currencies]`,
    '',
    currencyBlocks,
    '',
    `▼ Promotion Names  [OPENS POPUP × ${resolved.locales.length} locales]`,
    '',
    `  54. Click "+ Promotion Names" button`,
    ...localeRows,
    `  ${55 + resolved.locales.length}. Submit  [CLOSE POPUP]`,
    '',
    `▼ Blacklist  [OPENS POPUP]   ★ REQUIRED — right after Game Categories`,
    `   Rule: select the Template whose name matches the categories (e.g. categories = Slots only → template "Slots Only")`,
    `   Categories on this promo: ${(r.categories || ['Slots']).join(', ')}`,
    `  ${57 + resolved.locales.length}. Open "Template:" dropdown → pick the template that matches this category set`,
    `  ${58 + resolved.locales.length}. If none matches, click "+ Blacklist Templates" → create one (name = category list, tick sub-game-types) → Submit → re-select`,
    `  ${59 + resolved.locales.length}. Apply to other currencies (MYR, SGD${resolved.currencies.includes('IDR') ? ', IDR' : ''}) if needed → Submit`,
    '',
    '▼ FINAL',
    `  ${64 + resolved.locales.length}. Review all fields on main screen`,
    `  ${65 + resolved.locales.length}. STOP — wait for user confirmation before clicking Submit`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].filter((s) => s !== null && s !== '').join('\n');
}

// ── Top-level dispatch ───────────────────────────────────────────────────
// For multi-platform / multi-brand requests, produce one plan per (brand, platform).

export function plansForRequest(resolved) {
  const out = [];
  for (const brand of resolved.brands) {
    const info = BRAND_TO_SITE[brand];
    if (!info) {
      out.push({ brand, platform: null, plan: null, status: '⛔ BLOCKED', gaps: [`unknown brand: ${brand}`] });
      continue;
    }
    const plan = info.platform === 'qp2'
      ? renderQp2Plan(resolved, { brand })
      : renderQproPlan(resolved, { brand });
    const gaps = validatePlan(resolved);
    out.push({
      brand,
      platform: info.platform,
      siteId: info.siteId,
      plan,
      status: gaps.length === 0 ? '✅ READY' : '⛔ BLOCKED',
      gaps,
    });
  }
  return out;
}
