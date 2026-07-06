---
name: feedback-igmp-list-misses-freecredit
description: IGMP GetPromotionsList can omit FreeCredit promos — exact-code existence checks MUST use GetPromotionInfoByCode; list-based name-collision probes can false-pass for FC.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7070d480-a826-446c-98e2-8ca3c5828588
---

`/PM/GetPromotionsList` on WS1/WS2 with body `PromotionType: 0` returns **Bonus-type promos ONLY** — `0` is the Bonus enum value, not "all types". Confirmed 2026-07-05 on ws1-v3-my: `PromotionType: 0` → 435 rows (all Bonus); `PromotionType: ''` (or `{}` body) → 3,109 rows across 10 types (FreeCredit 350, FreeSpin 236, LuckyWheel 1118, ScratchCard 504, …). `FT_VMFC_VARIABLE_3X` (FreeCredit, live on all 3 IGMP sites: WS1 MY id=2915, WS1 SG id=2153, WS2 id=2486) was invisible to every `PromotionType: 0` scan, producing a false "NOT FOUND" and a late `AddFreeCredit` failure: "Promotion code is not available."

**Why:** Two checks relied on `PromotionType: 0` scans and both false-passed: (1) duplicate promo_code probes, and (2) the canary's pre-commit PromotionName-uniqueness probe in `bin/canary-api-igmp.js` (it declared "VIP SPECIAL FREE CREDIT - 3x TO" unique on ws1-v3-sg even though an FC promo with exactly that name existed). Both fixed 2026-07-05: the name probe now sends `PromotionType: ''`, and the canary gained a pre-commit exact-code idempotency probe via `GetPromotionInfoByCode` (bail exit=10, tested live). `bin/pull-bo-ytd.mjs` (nightly) is unaffected — it enumerates types `[0, 4, 11]` explicitly. Remaining callers fixed 2026-07-06 (commit 23303e7): `bin/pull-bo-to-sheet.mjs` now sends `PromotionType: ''`; `bin/probe-ws1-fs-name-patterns.mjs` archived (one-off for completed P143–P151). Only the untouched TLEO one-offs (`bin/_rename-ws1-*`, `bin/_probe-ws1-tleo-name-match.mjs`) and `bin/_archive/` scripts still carry `PromotionType: 0` — do not reuse them as templates for list scans.

**How to apply:**
- Exact-code existence on IGMP → `POST /PM/GetPromotionInfoByCode {PromotionCode}` (returns PromotionId/IsActive/IsPublished; PromotionRewards always empty in this view — that's normal).
- FC config detail → `GetFreeCreditInfo {PromotionId}` — but it does NOT return `PromotionRewardContents`; read T&C rows via `POST /PM/GetPromotionRewardContents {RewardId}` (same blindspot family as [[feedback-qpro-detail-get-invisible-fields]]).
- Treat "Promotion code is not available." from AddFreeCredit/AddBonus as "code already exists" — re-probe with GetPromotionInfoByCode before concluding anything.
- The canary's name-uniqueness list probe should be considered unreliable for FC names until fixed.
- `bin/_probe-vm-codes.mjs` already uses the correct endpoint (fixed 2026-07-05).

Related: [[feedback-ws1-ws2-unique-promo-name]], [[project-igmp-edit-status-endpoints]].
