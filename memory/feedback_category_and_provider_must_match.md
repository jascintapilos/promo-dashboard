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

**Layer-1 exclusions apply ON TOP of the category filter (operator correction 2026-07-09, P026):** the category-restricted provider list must ALSO subtract the standing exclusion names (918KISS, 918KAYA, ALLBET, EKOR, HABANERO, KINGMIDAS, MEGA888, DG, SSG) — a Slots-only promo must not include 918KAYA/Habanero/KingMidas/MEGA888 just because they carry slots games. Fixed in `resolveCategoryGpIds()` (src/api-mapper-qpro.js) and `qproProvidersForCats()` (bin/fix-cat-gp-estate.mjs); QP2 unaffected (its 53-provider catalog contains none of the excluded names). P026's 15 QPRO records remediated live same day (providers 36-41 → 32-36, no drift). NOTE: category-restricted promos saved across the estate BEFORE 2026-07-09 (including the pending 45-promo estate batch's earlier fixes) may still include excluded providers — an estate re-sweep with the corrected target is an open follow-up.

**Verification rule for Sentinel/Pre-QC — check exclusion-list absence, not list length (2026-07-10, P028):** a Slots-only category restriction legitimately pairs with a LONG provider list (30+ of ~40 total installed providers, since most providers offer slots) — a long list is the expected correct shape, not evidence of a bypass. The actual, checkable signal is whether the 9 Layer-1-excluded codes are ABSENT from the list. On P028, 21 of 22 Sentinel agents correctly reasoned this through (marking INCONCLUSIVE when `detail` lacked category/provider fields), but one (QPRO2) escalated to FAIL by pattern-matching list length against the unrelated WC_GLD_100FC_10X incident — which was actually caused by an EMPTY/unrestricted list, not a long category-matched one. Refuted same-session: none of the 9 excluded codes appeared in QPRO2's 33-provider list, confirming the exclusion fix was correctly applied. Guardrail added to `sentinel.md`/`promo-qc.md` Suppressions sections to prevent recurrence.
