// Source-template-of-record map for Section 6.6 Message Template creation.
//
// When the canary creates a new Message Template (URL .../superuser/message-template),
// the "Sync Content From" select copies the body of an existing template into
// the new one. Authoring CKEditor HTML from scratch is brittle — copying from
// a known-good template is the safe pattern.
//
// Lookup order:
//   1. byBonusTypeSub[`${bonus_type}::${bonus_sub_type}`]
//   2. byBonusType[bonus_type]
//   3. byBrand[brand]                       (brand-specific default)
//   4. defaultSyncTemplate                  (universal fallback)
//   5. null → executor prompts operator at runtime
//
// As Jascinta validates more template-of-record mappings, fill them in below.
// Keep the comment columns up to date so future-you knows which mapping has
// been live-tested vs. inherited from QPRO11.

export const MESSAGE_TEMPLATE_SOURCE = {
  // Universal fallback — only known existing template at time of writing.
  // Captured 2026-05-13 from QPRO11/MSB66, section "Promotions", type "Message".
  defaultSyncTemplate: 'FT_WEL_SLOTS_120PCT',

  // Per-brand defaults — keyed by brand code (QPRO11, QPRO13, …).
  // Use when a brand has its own brand-of-record template set. null = fall
  // through to defaultSyncTemplate.
  byBrand: {
    QPRO11: 'FT_WEL_SLOTS_120PCT',
  },

  // Per-bonus-type defaults — keyed by `resolved.bonus_type` (Deposit /
  // Free Credit / Free Spin / Cashback). Wins over brand default.
  byBonusType: {
    // Deposit:     'DEP_DEFAULT_TEMPLATE',
    // 'Free Credit': 'FC_DEFAULT_TEMPLATE',
    // 'Free Spin':   'FS_DEFAULT_TEMPLATE',
    // Cashback:    'CB_DEFAULT_TEMPLATE',
  },

  // Per-(bonus-type, sub-type) — most specific match. Keyed `${type}::${sub}`.
  byBonusTypeSub: {
    // 'Deposit::Reload':  'REL_DEFAULT_TEMPLATE',
    // 'Deposit::Welcome': 'WEL_DEFAULT_TEMPLATE',
  },
};

export function resolveSyncFromTemplate({ bonusType, bonusSubType, brand }) {
  const m = MESSAGE_TEMPLATE_SOURCE;
  const key = `${bonusType}::${bonusSubType}`;
  if (bonusType && bonusSubType && m.byBonusTypeSub[key]) {
    return { template: m.byBonusTypeSub[key], source: `byBonusTypeSub[${key}]` };
  }
  if (bonusType && m.byBonusType[bonusType]) {
    return { template: m.byBonusType[bonusType], source: `byBonusType[${bonusType}]` };
  }
  if (brand && m.byBrand[brand]) {
    return { template: m.byBrand[brand], source: `byBrand[${brand}]` };
  }
  if (m.defaultSyncTemplate) {
    return { template: m.defaultSyncTemplate, source: 'defaultSyncTemplate' };
  }
  return { template: null, source: 'unresolved' };
}
