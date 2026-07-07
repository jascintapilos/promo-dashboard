---
name: feedback-player-neutral-rename-suffixes
description: "WS1/WS2 PromotionName is player-visible — dedupe suffixes must be neutral mechanics (MIN/CAP/TOx from saved BO config), never internal channel tokens."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b9f6f1d4-1561-4bb1-a956-5830b509a1dc
---

When renaming WS1/WS2 promos for uniqueness (see [[feedback-ws1-ws2-unique-promo-name]]), the suffix must be player-neutral: PromotionName shows on the player side, so internal channel/segment tokens (FT, REL, VM, TSM, FB, RET, CHURN, LC, OPS, BR, V#, D#) must never appear in it. Tier labels (GOLD/PLATINUM) stay out too, per [[feedback-no-tier-in-promo-name]].

**Why:** 2026-07-07 — Jascinta rejected the MY-style code-token suffixes ("20% Reload Bonus (FT / REL / TO10)") for the WS1 SG dedupe: "players can see the promo name, find something neutral."

**How to apply:** Suffix only the mechanics that DIFFER within the duplicate group, read from the saved BO config (GetBonusInfo → `data.Promotion.PromotionRewards[0]`): `MinimumActionAmount` → `MIN100`, `CapBonusAmount` → `CAP188`, `RolloverMultiplier` → `TO10x` — joined `(MIN100 / CAP188 / TO10x)`, matching the style already live in player-facing names. Identical-mechanics twins (e.g. FT_/non-FT pairs) get plain numerals: lowest PromotionId keeps the clean name, others get " II", " III". Derive from saved config, not code tokens — BO mechanics are richer and sometimes contradict the code. Reference implementation: `bin/_rename-ws1-sg-legacy-unique.mjs` (54 renames committed 2026-07-07). The 57 WS1 MY renames from 2026-07-06 still carry channel tokens — rework flagged.
