---
name: feedback_qpro_depfc_game_provider_required
description: QPRO Dep/FC must always have game_provider_ids set — even "all games" promos need the Layer-1 inclusion list; empty = rebate engine failure
metadata:
  type: feedback
---

QPRO Deposit and Free Credit promos must have `game_provider_ids` populated in the BO — even when the promo has no category restriction ("all games").

**Why:** The rebate calculation engine uses `game_provider_ids` + `game_categories` to determine which turnover to deduct against a promotion. If both are empty, the engine cannot identify the promo scope, silently drops the turnover deduction, and players' non-deducted bonus turnover inflates their rebate payouts — financial exposure across all QPRO brands. Incident: VM_DEP1000_GET500_5X and VM_FC_VARIABLE_5X (2026-07-22, all QPRO brands). Wai Yip requested the guardrail. [[project_qpro_rebate_scope_incident]]

**How to apply:**
- **Pre-QC:** FAIL if `plan.promotion.game_provider_ids` is null or empty for a QPRO Dep/FC plan — the mapper must always send the Layer-1 inclusion list (all providers minus 918KISS/918KAYA/ALLBET/EKOR/HABANERO/KINGMIDAS/MEGA888/DG/SSG). A large list (30+ providers) is expected and correct.
- **Sentinel:** FAIL if post-save `live_state.detail.game_provider_ids` AND `live_state.detail.game_categories` are both null/empty on a QPRO Dep/FC promo.
- **Mapper (open fix):** `src/api-mapper-qpro.js` should populate `game_provider_ids` with the Layer-1 inclusion list for Dep/FC promos when no category restriction is set. Until this is fixed, Pre-QC will catch mapper-produced empty lists at the plan stage before any BO write occurs.
- "All games" = the full Layer-1 inclusion list, NOT an empty array. Empty ≠ "unrestricted" in the rebate engine; empty = "no scope, no deduction".
- IGMP and QP2 are NOT covered by this specific check — different rebate model on IGMP; QP2 uses game_provider_codes and its rebate engine behaves differently.
