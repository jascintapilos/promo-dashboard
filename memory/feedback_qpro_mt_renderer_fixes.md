---
name: feedback-qpro-mt-renderer-fixes
description: QPRO MT renderer now uses instructions.categories_only + :url placeholder; QC checker updated to match
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 0f7dcdbf-9acb-4a53-96ff-93e9485f1168
---

After 2026-06-16 fixes, the QPRO MT renderer (`src/message-template-renderer.js`) behaves as follows:

1. **Categories**: reads `r.instructions.categories_only` first (via `INSTRUCTION_CAT_MAP`), falls back to `r2.categories`. `buildDepositCatClause()` generates the full "X categories eligible except Y." sentence including sub-exclusions (Sports→VS/NG, Slots→TG/ARC).
2. **T&C URL**: `hyperlinkQproTnc()` produces `<a href=":url/terms-conditions">` — the BO substitutes `:url` per-brand at display time. NOT hardcoded domain anymore.
3. **QC checker** (`src/qc-mt-tnc.js`): now asserts `href=":url/terms-conditions"` is present for BOTH QPRO and QP2 (previously QPRO asserted its absence, causing false fails).
4. **Deposit body templates**: `{{deposit_cat_clause}}` replaces nested conditionals; single-level `{{#if_all_categories}}` only.

**Why:** Auto-rendered QPRO MTs had "Slots only" category clause and hardcoded `bp9mys.com/en-my/...` URL for all locales — SG members saw wrong URL, wrong categories.

**How to apply:** No post-run MT fix scripts needed for deposit promos with Sports/Slots categories. QC L3 should pass without manual intervention.
