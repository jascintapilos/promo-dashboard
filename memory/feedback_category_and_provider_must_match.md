---
name: feedback_category_and_provider_must_match
description: Category-restricted promos need BOTH Categories AND Game Providers restricted in BO — missing provider restriction = all providers allowed despite category config
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

When a QPRO/QP2 promo has a game category restriction (Sports-only, Slots-only, LC-only, etc.), **both** of the following BO fields must be configured:

1. **Categories** — set to the restricted category (e.g. SPORT)
2. **Game Providers** — restricted to providers belonging to that category only (e.g. CMD88B, IWC/2BC, SABA/MAX for Sports)

**Why:** Setting Categories alone is insufficient. The "Limit Provider Transfer Out" feature restricts transfers to whichever providers are listed in Game Providers. If Game Providers is left as all providers (or empty), members can transfer the bonus to any provider including excluded categories.

**How to apply:** All three QC gates now enforce this:
- Triage Officer: emits NOTE when `categories_only` is set (flags for downstream)
- Pre-QC Agent: FAIL if `plan.categoriesOnly` is set but `game_provider_ids`/`game_provider_codes` is empty
- Sentinel: FAIL if category restriction in live BO but game_provider_ids is null/empty (or vice versa)

Root cause incident: **WC_GLD_100FC_10X** (QPRO7 MYR, 2026-07-01) — Sports-only FC promo had ALL game providers listed; member imneedm transferred 100 MYR FC bonus to Mighty Sevens (Slot provider) and wagered 1,456.50 MYR on Slots. Wai Yip fixed + tagged Jascinta: "lexa's QC issue." Member's claim was allowed to stand.

Applies to: QPRO and QP2 only. IGMP (WS1/WS2) uses a different provider restriction model — skip.
