// Increment 5 (real-QC upgrade): deterministic expected-vs-live comparison
// engine. Takes two canonicals (expected + live) plus platform metadata,
// runs a fixed rule table, and returns per-field results + aggregate.
//
// Result shape (per rule):
//   { field, expected, actual, status, severity, rule, message,
//     expectedPath, boPath }
//   status: 'MATCH' | 'MISMATCH' | 'UNAVAILABLE' | 'SKIPPED'
//   severity: 'CRITICAL' | 'WARNING' | 'INFO'
//
// Aggregate:
//   { fields[], summary: {passed, failed, warning, unavailable}, verdict }
//
// Verdict rule (per brief §5):
//   - Any MISMATCH with severity CRITICAL   → NOT_SAFE
//   - Any UNAVAILABLE with severity CRITICAL → MANUAL_REQUIRED (no PASS
//     without live evidence)
//   - Any MISMATCH with severity WARNING    → REVIEW
//   - Else                                   → SAFE
//
// Platform quirks encoded (from sentinel.toml):
//   - QPRO detail.auto_reward_activation always null → INCONCLUSIVE (skip)
//   - QP2 max_total_* / max_withdraw null → Unlimited (not "missing")
//   - QPRO4-17 missing SGD → not a fault (single-region brand)
//   - QP2 FS T&C hyperlink absent → PASS (uses :url/terms-conditions param)
//   - MVP scope: promoCode, bonusType, per-currency mechanics, TO, validity,
//     categories/provider consistency. More rules can be added later
//     without changing the engine shape.

import { BONUS_TYPES } from './canonical/canonical-model.js';

// Severity classification per Sentinel field-criteria table.
const CRITICAL = 'CRITICAL';
const WARNING = 'WARNING';
const INFO = 'INFO';

const MATCH = 'MATCH';
const MISMATCH = 'MISMATCH';
const UNAVAILABLE = 'UNAVAILABLE';
const SKIPPED = 'SKIPPED';

// QPRO brands that do NOT support the SG region — missing SGD is expected.
// Per sentinel.toml suppression: QPRO4..QPRO17. QPRO1/2/3 do support SGD.
const QPRO_NO_SG = new Set(Array.from({ length: 14 }, (_, i) => `QPRO${i + 4}`));

// Blocker 4 fix (Real-QC): fields the platform's GET API is known not to
// return. When live is null AND the field is on this list, emit SKIPPED
// with an explanation instead of UNAVAILABLE — otherwise these promos
// forever emit MANUAL_REQUIRED for a systematic platform limitation, not
// for a per-promo evidence gap.
//
// IGMP FS: FreeSpinRounds / AmountPerBet exist only on the create-time POST
// body (/PM/AddFreeSpin) — no GET endpoint returns them. Verified 2026-07-30
// by grepping every /PM/GetFreeSpin* endpoint and the reward record shape.
// Extending the fetch layer to hit an additional endpoint would not help —
// there is no such endpoint. Documented in igmp-adapter.js.
const PLATFORM_UNRETRIEVABLE_CURRENCY_FIELDS = Object.freeze({
  igmp: new Set(['spinCount', 'valuePerSpin']),
});

function mkResult(field, expected, actual, status, severity, rule, message, extras = {}) {
  return {
    field,
    expected: expected === undefined ? null : expected,
    actual: actual === undefined ? null : actual,
    status,
    severity,
    rule,
    message,
    expectedPath: extras.expectedPath || null,
    boPath: extras.boPath || null,
  };
}

function eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' && typeof b === 'number') {
    // Tolerance of 1e-4 = 0.0001 — well below any currency's smallest
    // denomination (0.01). Absorbs floating-point drift + storage-precision
    // rounding without swallowing meaningful mismatches.
    return Math.abs(a - b) <= 1e-4;
  }
  return false;
}

function setsEqual(aArr, bArr) {
  const a = [...(aArr || [])].map(String).sort();
  const b = [...(bArr || [])].map(String).sort();
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// ── Rule implementations ─────────────────────────────────────────────────

function ruleIdentityCode(exp, act) {
  const e = exp.identity.promoCode;
  const a = act.identity.promoCode;
  if (e == null || a == null) {
    return mkResult('promoCode', e, a, UNAVAILABLE, CRITICAL, 'identity.promoCode', 'promo code unavailable in expected or live', { expectedPath: 'source.promo_code', boPath: 'live.list_row.code' });
  }
  return e === a
    ? mkResult('promoCode', e, a, MATCH, CRITICAL, 'identity.promoCode', 'promo code matches', { expectedPath: 'source.promo_code', boPath: 'live.list_row.code' })
    : mkResult('promoCode', e, a, MISMATCH, CRITICAL, 'identity.promoCode', `promo code mismatch: expected "${e}", got "${a}"`, { expectedPath: 'source.promo_code', boPath: 'live.list_row.code' });
}

function ruleIdentityBonusType(exp, act) {
  const e = exp.identity.bonusType;
  const a = act.identity.bonusType;
  if (e == null || a == null) {
    return mkResult('bonusType', e, a, UNAVAILABLE, CRITICAL, 'identity.bonusType', 'bonus type unavailable', { expectedPath: 'source.bonus_type', boPath: 'live.list_row.bonus_type' });
  }
  // OTHER on either side is a normalization failure — flag but don't crash.
  if (e === BONUS_TYPES.OTHER || a === BONUS_TYPES.OTHER) {
    return mkResult('bonusType', e, a, UNAVAILABLE, CRITICAL, 'identity.bonusType', 'bonus type could not be normalized to a known enum', { expectedPath: 'source.bonus_type', boPath: 'live.list_row.bonus_type' });
  }
  return e === a
    ? mkResult('bonusType', e, a, MATCH, CRITICAL, 'identity.bonusType', 'bonus type matches')
    : mkResult('bonusType', e, a, MISMATCH, CRITICAL, 'identity.bonusType', `bonus type mismatch: expected ${e}, got ${a}`);
}

function ruleSchedule(field, exp, act, severity = CRITICAL) {
  const e = exp.schedule[field];
  const a = act.schedule[field];
  const path = { expectedPath: `source.${field === 'validityDays' ? 'validity_days' : 'rewards_validity_days'}`, boPath: `live.list_row.${field === 'validityDays' ? 'validity' : 'reward_validity'}` };
  if (e == null && a == null) return mkResult(field, e, a, SKIPPED, INFO, `schedule.${field}`, 'not asserted in source or live', path);
  if (e == null) return mkResult(field, e, a, SKIPPED, INFO, `schedule.${field}`, 'no expected value from source', path);
  if (a == null) return mkResult(field, e, a, UNAVAILABLE, severity, `schedule.${field}`, `${field} unavailable in live BO`, path);
  return e === a
    ? mkResult(field, e, a, MATCH, severity, `schedule.${field}`, `${field} matches`, path)
    : mkResult(field, e, a, MISMATCH, severity, `schedule.${field}`, `${field} mismatch: expected ${e}, got ${a}`, path);
}

function ruleCurrencies(exp, act, brand) {
  const results = [];
  const expByCode = new Map((exp.currencies || []).map((c) => [c.code, c]));
  const actByCode = new Map((act.currencies || []).map((c) => [c.code, c]));

  // Missing-currency check per brand quirks.
  for (const [code] of expByCode) {
    if (!actByCode.has(code)) {
      // QPRO4-17 quirk: SGD missing is expected — suppress to SKIPPED
      if (code === 'SGD' && QPRO_NO_SG.has(brand)) {
        results.push(mkResult(`currency:${code}:present`, code, null, SKIPPED, INFO, 'currency.presence.no-sg-region', `SGD not supported on ${brand} (no-SG brand)`, { expectedPath: `source.currencies[${code}]`, boPath: 'live.detail.promotion_currency_list' }));
        continue;
      }
      results.push(mkResult(`currency:${code}:present`, 'present', 'missing', MISMATCH, CRITICAL, 'currency.presence', `currency ${code} missing from live BO`, { expectedPath: `source.currencies[${code}]`, boPath: 'live.detail.promotion_currency_list' }));
    }
  }

  // Per-currency field checks (only for currencies that exist in BOTH sides).
  for (const [code, expCcy] of expByCode) {
    const actCcy = actByCode.get(code);
    if (!actCcy) continue;
    const perFieldPath = (f, boSrc) => ({ expectedPath: `source.per_currency_overrides.${code}.${f}`, boPath: boSrc });
    for (const [field, boPath, sev] of [
      ['minDeposit', 'live.detail.per_currency_overrides.*.min_deposit', CRITICAL],
      ['maxBonus', 'live.detail.per_currency_overrides.*.max_bonus', CRITICAL],
      ['bonusRatePct', 'live.detail.per_currency_overrides.*.bonus_rate', CRITICAL],
      ['freeCreditAmount', 'live.detail.per_currency_overrides.*.free_credit_amount', CRITICAL],
      ['spinCount', 'live.detail.per_currency_overrides.*.spin_count', CRITICAL],
      ['valuePerSpin', 'live.detail.per_currency_overrides.*.amount_per_line', CRITICAL],
      ['toMultiplier', 'live.detail.to_multiplier', CRITICAL],
      ['maxTransferOut', 'live.detail.per_currency_overrides.*.max_transfer_out', WARNING],
    ]) {
      const e = expCcy[field];
      const a = actCcy[field];
      const fieldKey = `currency:${code}:${field}`;
      const paths = perFieldPath(field, boPath);
      if (e == null) {
        // Source didn't assert this field — skip. Not every bonus type uses every field.
        continue;
      }
      if (a == null) {
        // Blocker 4 fix: if the platform's GET API cannot return this field
        // (documented, verified), emit SKIPPED so the promo isn't forever
        // MANUAL_REQUIRED for a systematic platform limitation. This is
        // never a per-promo evidence gap — the fetch layer already hit
        // every endpoint that exists.
        const platform = act.identity.platform;
        if (PLATFORM_UNRETRIEVABLE_CURRENCY_FIELDS[platform]?.has(field)) {
          results.push(mkResult(fieldKey, e, a, SKIPPED, INFO, `currency.${field}.platform-limit`, `${field} for ${code} not exposed by ${platform.toUpperCase()} GET endpoints — cannot verify from live BO`, paths));
          continue;
        }
        // Blocker (Real-QC): value-per-spin needs lines-per-spin to convert
        // BO's `amount_per_line` to the player-facing unit the source uses.
        // When the resolver is inconclusive (missing game code / catalog
        // miss), the canonical carries a note — surface it as UNAVAILABLE
        // (still CRITICAL, still aggregates to MANUAL_REQUIRED) with the
        // specific conversion-evidence reason instead of the generic
        // "unavailable in live BO" text.
        if (field === 'valuePerSpin' && actCcy.valuePerSpinInconclusive && actCcy.valuePerSpinNote) {
          results.push(mkResult(fieldKey, e, a, UNAVAILABLE, sev, `currency.valuePerSpin.inconclusive`, `valuePerSpin for ${code} cannot be verified — ${actCcy.valuePerSpinNote}`, paths));
          continue;
        }
        results.push(mkResult(fieldKey, e, a, UNAVAILABLE, sev, `currency.${field}`, `${field} for ${code} unavailable in live BO`, paths));
        continue;
      }
      // When the compare passes, include the derivation trail in the message
      // so operators can see exactly why the match / mismatch was called.
      const trailer = field === 'valuePerSpin' && actCcy.valuePerSpinNote
        ? ` [${actCcy.valuePerSpinNote}]`
        : '';
      results.push(eq(e, a)
        ? mkResult(fieldKey, e, a, MATCH, sev, `currency.${field}`, `${field} for ${code} matches (${a})${trailer}`, paths)
        : mkResult(fieldKey, e, a, MISMATCH, sev, `currency.${field}`, `${field} for ${code} mismatch: expected ${e}, got ${a}${trailer}`, paths));
    }
  }

  // Extra-currency-in-live check (present on live but not in source): WARNING.
  for (const [code] of actByCode) {
    if (!expByCode.has(code)) {
      results.push(mkResult(`currency:${code}:present`, 'unspecified', code, MISMATCH, WARNING, 'currency.extra', `live has currency ${code} not asserted in source`, { expectedPath: 'source.currencies', boPath: 'live.detail.promotion_currency_list' }));
    }
  }

  return results;
}

function ruleCategoriesAlignment(exp, act) {
  const eCats = exp.scope.categories || [];
  const aCats = act.scope.categories || [];
  const aProviders = act.scope.gameProviderIds.length > 0 || act.scope.gameProviderCodes.length > 0;
  // Category set comparison — unordered set equality.
  const results = [];
  if (eCats.length === 0 && aCats.length === 0) {
    results.push(mkResult('categories', [], [], SKIPPED, INFO, 'scope.categories', 'no category restriction in source or live'));
  } else if (setsEqual(eCats, aCats)) {
    results.push(mkResult('categories', eCats, aCats, MATCH, CRITICAL, 'scope.categories', 'category set matches'));
  } else {
    results.push(mkResult('categories', eCats, aCats, MISMATCH, CRITICAL, 'scope.categories', `category mismatch: expected [${eCats.join(', ')}], got [${aCats.join(', ')}]`));
  }
  // Category-set-with-empty-providers safety rule (Sentinel: unrestricted
  // provider list on a category-restricted promo = FAIL — bypass risk).
  if (eCats.length > 0 && aCats.length > 0 && !aProviders) {
    results.push(mkResult('categoryProviderConsistency', 'providers restricted', 'providers empty', MISMATCH, CRITICAL, 'scope.category-provider-consistency', 'category restriction set but provider list empty on live — configuration bypass risk'));
  } else if (eCats.length > 0 && aCats.length > 0) {
    results.push(mkResult('categoryProviderConsistency', 'providers restricted', 'providers restricted', MATCH, CRITICAL, 'scope.category-provider-consistency', 'category + provider both restricted (consistent)'));
  }
  return results;
}

function ruleAutoReward(exp, act) {
  const e = exp.autoReward.autoRewardActivation;
  const a = act.autoReward.autoRewardActivation;
  // Platform limitations — the GET APIs do NOT expose this field:
  //   QPRO — API bug (never returned)
  //   IGMP — auto-reward is not a concept in the iGMP promotion model
  // For both, downgrade to SKIPPED so per-platform limitations don't force
  // MANUAL_REQUIRED forever (blocker 4).
  const platform = act.identity.platform;
  if (platform === 'qpro') {
    return mkResult('autoRewardActivation', e, a, SKIPPED, INFO, 'autoReward.qpro-inconclusive', 'QPRO GET does not return auto_reward_activation — cannot verify (Sentinel Rule 3)');
  }
  if (platform === 'igmp') {
    return mkResult('autoRewardActivation', e, a, SKIPPED, INFO, 'autoReward.igmp-not-applicable', 'auto-reward is not a concept on IGMP — no equivalent field to compare');
  }
  if (e == null) return mkResult('autoRewardActivation', e, a, SKIPPED, INFO, 'autoReward.no-expected', 'no expected value asserted');
  if (a == null) return mkResult('autoRewardActivation', e, a, UNAVAILABLE, CRITICAL, 'autoReward.presence', 'auto_reward_activation unavailable in live BO');
  return e === a
    ? mkResult('autoRewardActivation', e, a, MATCH, CRITICAL, 'autoReward.exact', 'auto_reward_activation matches')
    : mkResult('autoRewardActivation', e, a, MISMATCH, CRITICAL, 'autoReward.exact', `auto_reward_activation mismatch: expected ${e}, got ${a}`);
}

function ruleLinkage(exp, act) {
  const results = [];
  // Only assert linkage rules the source can specify. Templates/dialog IDs
  // are creation-time artifacts, not authored in the source. We check
  // *presence* on live BO based on the bonus type.
  const bonusType = act.identity.bonusType;
  const platform = act.identity.platform;

  // IGMP has no MT/dialog linkage concept — skip.
  if (platform === 'igmp') {
    results.push(mkResult('mtLinkage', null, null, SKIPPED, INFO, 'linkage.igmp-not-applicable', 'IGMP: T&C embedded in reward contents — no separate MT linkage'));
    results.push(mkResult('dialogLinkage', null, null, SKIPPED, INFO, 'linkage.igmp-not-applicable', 'IGMP: no dialog popup concept'));
    return results;
  }

  const tId = act.linkage.templateId;
  results.push(tId != null
    ? mkResult('mtLinkage', 'linked', 'linked', MATCH, WARNING, 'linkage.mt-present', `message template linked (id=${tId})`)
    : mkResult('mtLinkage', 'linked', 'unlinked', MISMATCH, WARNING, 'linkage.mt-present', 'no message template attached to promotion'));

  const dIds = act.linkage.dialogPopupList;
  if (Array.isArray(dIds) && dIds.length > 0) {
    // QP2 multi-merchant check: dialog count should equal merchant count.
    if (platform === 'qp2') {
      const merchantCount = (act.linkage.promotionListIds || []).length;
      if (merchantCount > 0 && dIds.length < merchantCount) {
        results.push(mkResult('dialogLinkage', `${merchantCount} popups (one per merchant)`, `${dIds.length} popups`, MISMATCH, CRITICAL, 'linkage.qp2-dialog-count', `dialog count mismatch — ${merchantCount} merchants attached but only ${dIds.length} popups linked`));
      } else {
        results.push(mkResult('dialogLinkage', 'linked', 'linked', MATCH, WARNING, 'linkage.dialog-present', `dialog popup linked (${dIds.length} popup${dIds.length === 1 ? '' : 's'})`));
      }
    } else {
      results.push(mkResult('dialogLinkage', 'linked', 'linked', MATCH, WARNING, 'linkage.dialog-present', `dialog popup linked (id=${dIds[0]})`));
    }
  } else {
    results.push(mkResult('dialogLinkage', 'linked', 'unlinked', MISMATCH, WARNING, 'linkage.dialog-present', 'no dialog popup linked to promotion'));
  }

  return results;
}

// ── Public API ────────────────────────────────────────────────────────────

export function compare({ expected, actual, brand, platform }) {
  if (!expected || !actual) {
    throw new Error('compare: both expected and actual canonicals required');
  }
  const fields = [];
  fields.push(ruleIdentityCode(expected, actual));
  fields.push(ruleIdentityBonusType(expected, actual));
  fields.push(ruleSchedule('validityDays', expected, actual));
  fields.push(ruleSchedule('rewardValidityDays', expected, actual));
  fields.push(...ruleCurrencies(expected, actual, brand || expected.identity.brand));
  fields.push(...ruleCategoriesAlignment(expected, actual));
  fields.push(ruleAutoReward(expected, actual));
  fields.push(...ruleLinkage(expected, actual));

  // Aggregate summary + verdict per brief §5.
  let passed = 0, failed = 0, warning = 0, unavailable = 0;
  let anyCriticalMismatch = false;
  let anyCriticalUnavailable = false;
  let anyWarningMismatch = false;

  for (const f of fields) {
    if (f.status === MATCH) passed++;
    else if (f.status === MISMATCH) {
      if (f.severity === CRITICAL) { failed++; anyCriticalMismatch = true; }
      else { warning++; anyWarningMismatch = true; }
    } else if (f.status === UNAVAILABLE) {
      if (f.severity === CRITICAL) { unavailable++; anyCriticalUnavailable = true; }
      else warning++;
    }
    // SKIPPED with INFO doesn't count as passed/failed/warning/unavailable.
  }

  let verdict;
  if (anyCriticalMismatch) verdict = 'NOT_SAFE';
  else if (anyCriticalUnavailable) verdict = 'MANUAL_REQUIRED';
  else if (anyWarningMismatch) verdict = 'REVIEW';
  else verdict = 'SAFE';

  return {
    verdict,
    summary: { passed, failed, warning, unavailable },
    fields,
  };
}
