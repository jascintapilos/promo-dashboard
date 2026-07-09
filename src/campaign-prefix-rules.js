// Campaign objective → required promo_code prefix token rules.
//
// Each entry defines which tokens must appear in the promo_code when the
// source row has a matching campaign objective. The check is applied by
// the QC Engine (source-row triage) and Pre-QC Agent (plan review).
//
// Matching logic:
//   1. Strip leading FT_ from promo_code (WS1 site prefix — not a campaign token).
//   2. For each required token: check that it appears as a segment in the code
//      (i.e. the code contains the token as a substring when split by _).
//   3. For `either` entries: at least one of the listed tokens must be present.
//
// campaign value from the sheet is matched against `pattern` (case-insensitive).
// If no pattern matches, the check is skipped (blank or unknown campaign = no rule).

// ── New convention (rebuilt 2026-07-09 — Pillar-based, replaces the
//    2026-07-07 Owner/Objective version) ─────────────────────────────────
//
// Code format: [FT_]PILLAR_TEAM_OBJECTIVE_[NODEP]_PROMO[_TO].
// Active when the source row uses the new sheet dropdowns: the Requestor
// column (E) holds a team code and the Campaign column (K) holds one of the
// Pillar×Objective combo labels (anchored to 'Ref - Codes' D2:D10). When
// active, the legacy CAMPAIGN_PREFIX_RULES below are skipped — they encode
// the pre-approval token vocabulary that both new conventions retire.
// Legacy rules remain for grandfathered rows (free-text campaign values
// from before Aug 2026).
//
// FT_ is opt-in only (via the generic code_prefixes mechanism in ingest.js
// — "Add FT to code" / "Include FT prefix") — it is NOT auto-added for
// WS1/WS2 brands anymore. TO is optional; include only if needed for
// uniqueness. Objective is flexible — any of WELC/REL/CHURN/ADHOC/GROOM/
// PROBE may pair with any Pillar in principle; the table below lists the
// combos actually in use.

export const OWNER_CODES = ['CRM', 'VM', 'TSM', 'AM', 'AFF']; // = "Team" under the Pillar convention

// K-column dropdown labels → { pillar, objective }. Anchored to the dropdown
// values written by Ref - Codes ($D$2:$D$10) — keep this list in sync with
// that sheet range when adding new Pillar×Objective combos.
const PILLAR_OBJECTIVE_LABELS = [
  { pattern: /^ACQ\s*-\s*Welcome/i,        pillar: 'ACQ', objective: 'WELC' },
  { pattern: /^ACQ\s*-\s*Reload/i,         pillar: 'ACQ', objective: 'REL' },
  { pattern: /^Retention$/i,               pillar: 'RET', objective: 'REL' },
  { pattern: /^Churn\s*-?\s*Reactivation/i, pillar: 'RET', objective: 'CHURN' },
  { pattern: /^Ad\s*Hoc\b/i,               pillar: 'RET', objective: 'ADHOC' },
  { pattern: /^Grooming\b/i,               pillar: 'WHA', objective: 'GROOM' },
  { pattern: /^VIP\s*-\s*Churn/i,          pillar: 'VIP', objective: 'CHURN' },
  { pattern: /^Whale\s*-\s*Probe/i,        pillar: 'WHA', objective: 'PROBE' },
  { pattern: /^Branding\b/i,               pillar: 'BRA', objective: 'WELC' },
];

/**
 * Detect whether a record uses the new dropdown convention.
 * Returns { team, pillar, objective, nodep, expectedPrefix } or null (legacy row).
 */
export function resolveConvention(record) {
  const team = String(record?.requestor || '').trim().toUpperCase();
  if (!OWNER_CODES.includes(team)) return null;
  const campaign = String(record?.campaign || '').trim();
  const hit = PILLAR_OBJECTIVE_LABELS.find((o) => o.pattern.test(campaign));
  if (!hit) return null;
  const nodep = record?.no_deposit === true;
  return {
    team,
    pillar: hit.pillar,
    objective: hit.objective,
    nodep,
    expectedPrefix: `${hit.pillar}_${team}_${hit.objective}${nodep ? '_NODEP' : ''}`,
  };
}

/**
 * Validate a promo_code against the new Pillar×Team×Objective convention.
 * Returns { ok: true, skipped: true } for legacy rows (caller should fall
 * back to validateCampaignPrefix), { ok: true } on pass, or
 * { ok: false, missing, message } on mismatch.
 */
export function validatePrefixConvention(record, promoCode) {
  const conv = resolveConvention(record);
  if (!conv) return { ok: true, skipped: true };

  // Strip TEST_ and FT_ (test/opt-in site prefixes — not convention tokens).
  const code = String(promoCode || '').toUpperCase().replace(/^TEST_/, '').replace(/^FT_/, '');
  const segs = code.split('_');
  const missing = [];
  if (!segs.includes(conv.pillar)) missing.push(`${conv.pillar}_`);
  if (!segs.includes(conv.team)) missing.push(`${conv.team}_`);
  if (!segs.includes(conv.objective)) missing.push(`${conv.objective}_`);
  if (conv.nodep && !segs.includes('NODEP')) missing.push('NODEP_');

  if (!missing.length) return { ok: true, convention: conv };
  return {
    ok: false,
    convention: conv,
    missing,
    message:
      `Pillar "${conv.pillar}" + Team "${conv.team}" + Objective "${conv.objective}"${conv.nodep ? ' + NODEP' : ''} ` +
      `requires prefix ${conv.expectedPrefix}_. Missing: ${missing.join(', ')}.`,
  };
}

// ── Legacy rules (grandfathered rows — pre-Aug 2026 free-text campaigns) ──

export const CAMPAIGN_PREFIX_RULES = [
  {
    label:    'ACQ (WELCOME BONUS)',
    pattern:  /^ACQ\b/i,
    required: ['ACQ_', 'WELC_'],
    either:   [],
    example:  'ACQ_WELC_DEP_100PCT',
  },
  {
    label:    'Retention- AdHoc (CHURN PLAYERS)',
    pattern:  /^Retention.*AdHoc/i,
    required: ['ADHOC_', 'RET_'],
    either:   [],
    example:  'ADHOC_RET_DEP_50PCT',
  },
  {
    label:    'CRM - Retention (ACTIVE PLAYERS)',
    pattern:  /^CRM.*Retention/i,
    required: ['CRM_', 'REL_'],
    either:   [],
    example:  'CRM_REL_DEP_30PCT',
  },
  {
    label:    'CRM- Churn (CHURN PLAYERS)',
    pattern:  /^CRM.*Churn/i,
    required: ['CRM_', 'CHURN_', 'RET_'],
    either:   [],
    example:  'CRM_CHURN_RET_DEP_50PCT',
  },
  {
    label:    'CRM- Monthly Camps (AD HOC CAMPAIGNS)',
    pattern:  /^CRM.*Monthly/i,
    required: ['CRM_'],
    either:   ['REL_', 'RET_'],
    example:  'CRM_REL_FS_28',
  },
  {
    label:    'VIP Grooming (VIP PROGRESSION BONUS)',
    pattern:  /^VIP.*Groom/i,
    required: ['VIP_', 'GROOM_', 'REL_'],
    either:   [],
    example:  'VIP_GROOM_REL_DEP_50PCT',
  },
  {
    label:    'VIP AdHoc (AD HOC CAMPAIGNS)',
    pattern:  /^VIP.*AdHoc/i,
    required: ['VIP_', 'ADHOC_'],
    either:   [],
    example:  'VIP_ADHOC_FC_50',
  },
  {
    label:    'VIP Churn (CHURN PLAYERS)',
    pattern:  /^VIP.*Churn/i,
    required: ['VIP_', 'CHURN_', 'RET_'],
    either:   [],
    example:  'VIP_CHURN_RET_DEP_50PCT',
  },
  {
    label:    'VIP Retention (ACTIVE PLAYERS)',
    pattern:  /^VIP.*Retention/i,
    required: ['VIP_', 'REL_'],
    either:   [],
    example:  'VIP_REL_DEP_30PCT',
  },
  {
    label:    'TSM Churn (CHURN PLAYERS)',
    pattern:  /^TSM.*Churn/i,
    required: ['TSM_', 'CHURN_'],
    either:   [],
    example:  'TSM_CHURN_DEP_50PCT',
  },
  {
    label:    'TSM Retention (ACTIVE PLAYERS)',
    pattern:  /^TSM.*Ret/i,
    required: ['TSM_', 'RET_'],
    either:   [],
    example:  'TSM_RET_DEP_30PCT',
  },
];

/**
 * Find the rule matching a campaign objective string.
 * Returns null if no rule matches (blank or unknown campaign = skip check).
 */
export function findCampaignRule(campaign) {
  if (!campaign) return null;
  const s = String(campaign).trim();
  return CAMPAIGN_PREFIX_RULES.find((r) => r.pattern.test(s)) ?? null;
}

/**
 * Validate a promo_code against the campaign objective rule.
 * Returns { ok: true } or { ok: false, missing: string[], message: string }.
 *
 * @param {string} promoCode  - raw promo_code from source or plan
 * @param {string} campaign   - campaign objective from source row
 */
export function validateCampaignPrefix(promoCode, campaign) {
  const rule = findCampaignRule(campaign);
  if (!rule) return { ok: true, skipped: true };   // unknown/blank campaign — no rule

  // Strip leading FT_ (WS1 site prefix) before checking campaign tokens.
  const code = String(promoCode || '').replace(/^FT_/i, '').toUpperCase();
  const missing = [];

  for (const token of rule.required) {
    if (!code.includes(token.toUpperCase())) missing.push(token);
  }

  if (rule.either.length > 0) {
    const hasEither = rule.either.some((t) => code.includes(t.toUpperCase()));
    if (!hasEither) missing.push(`(${rule.either.join(' or ')})`);
  }

  if (missing.length === 0) return { ok: true };

  return {
    ok: false,
    rule: rule.label,
    missing,
    message:
      `Campaign "${campaign}" requires these tokens in promo_code: ` +
      `${rule.required.join(', ')}` +
      (rule.either.length ? ` + one of [${rule.either.join(', ')}]` : '') +
      `. Missing: ${missing.join(', ')}. ` +
      `Expected format: ${rule.example}`,
  };
}
