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
