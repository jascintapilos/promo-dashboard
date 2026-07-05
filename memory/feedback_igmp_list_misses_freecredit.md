---
name: feedback-igmp-list-misses-freecredit
description: IGMP GetPromotionsList can omit FreeCredit promos — exact-code existence checks MUST use GetPromotionInfoByCode; list-based name-collision probes can false-pass for FC.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7070d480-a826-446c-98e2-8ca3c5828588
---

`/PM/GetPromotionsList` on WS1/WS2 can **omit FreeCredit promos entirely**. Confirmed 2026-07-05: `FT_VMFC_VARIABLE_3X` was live on all 3 IGMP sites (WS1 MY id=2915, WS1 SG id=2153, WS2 id=2486, all IsActive) yet absent from a full paginated list walk (435/308/211 rows), while its sibling Bonus-type promo `FT_VM_REL100PCT_X1` (adjacent id 2914) appeared. Result: a "NOT FOUND" verdict from the list, followed by `AddFreeCredit` failing with "Promotion code is not available."

**Why:** Two independent checks rely on the list and both false-passed: (1) duplicate promo_code probes, and (2) the canary's pre-commit PromotionName-uniqueness probe in `bin/canary-api-igmp.js` (it declared "VIP SPECIAL FREE CREDIT - 3x TO" unique on ws1-v3-sg even though an FC promo with exactly that name existed).

**How to apply:**
- Exact-code existence on IGMP → `POST /PM/GetPromotionInfoByCode {PromotionCode}` (returns PromotionId/IsActive/IsPublished; PromotionRewards always empty in this view — that's normal).
- FC config detail → `GetFreeCreditInfo {PromotionId}` — but it does NOT return `PromotionRewardContents`; read T&C rows via `POST /PM/GetPromotionRewardContents {RewardId}` (same blindspot family as [[feedback-qpro-detail-get-invisible-fields]]).
- Treat "Promotion code is not available." from AddFreeCredit/AddBonus as "code already exists" — re-probe with GetPromotionInfoByCode before concluding anything.
- The canary's name-uniqueness list probe should be considered unreliable for FC names until fixed.
- `bin/_probe-vm-codes.mjs` already uses the correct endpoint (fixed 2026-07-05).

Related: [[feedback-ws1-ws2-unique-promo-name]], [[project-igmp-edit-status-endpoints]].
