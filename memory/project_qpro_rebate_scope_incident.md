---
name: project_qpro_rebate_scope_incident
description: QPRO Dep/FC promos saved without game_provider_ids/game_categories caused rebate engine to not deduct turnover — new Sentinel + Pre-QC guardrails added 2026-07-22
metadata:
  type: project
---

VM_DEP1000_GET500_5X (Deposit) and VM_FC_VARIABLE_5X (Free Credit) were saved by promo_testbot across all QPRO brands without any `game_categories` or `game_provider_ids` set.

The rebate calculation engine could not deduct promo turnover for affected users because it had no provider/category scope to calculate against. Wai Yip fixed live; tech team regenerated turnover summaries.

**Why:** The mapper did not populate `game_provider_ids` for "all games" QPRO Dep/FC promos (no category restriction → no provider list sent). The BO saved with both fields empty. The rebate engine interprets empty scope as "no promo scope" and silently drops turnover deduction, causing players' non-deducted bonus turnover to inflate their rebate payouts.

**How to apply:**
- Sentinel rule added (sentinel.md): FAIL if QPRO Dep/FC has both `game_categories` and `game_provider_ids` null/empty post-save.
- Pre-QC rule updated (promo-qc.md): FAIL if QPRO Dep/FC plan has `game_provider_ids` null/empty (mapper must always set Layer-1 inclusion list).
- **Mapper fix:** `src/api-mapper-qpro.js` now populates `game_provider_ids` with Layer-1 inclusion list for Dep/FC promos (fix merged 2026-07-22 in this worktree; tests added in `test/qpro-api-mapper-gp.test.mjs`, `test/qpro-buildApiPlan-wiring.test.mjs`, `test/qpro-buildApiPlan-nonempty.test.mjs`).
- **GP catalog sync complete (2026-07-24):** `bin/sync-promo-gp-catalog.mjs` patched all 22 QPRO promos (11 brands × 2 codes) to align with live L1 catalog. 0 errors. See [[project_qpro_put_body_format]] for the 4 PUT body transforms required.

Wai Yip → Jascinta DM (2026-07-22): "help set some rules to avoid this ya" — QC guardrails added to agent definitions in this session. [[feedback_qpro_depfc_game_provider_required]]
