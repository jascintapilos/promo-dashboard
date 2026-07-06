---
name: feedback-igmp-fc-expiry-outer-wrapper
description: WS1 FreeCredit claim-window (ExpiryMinutes) lives on the OUTER GetFreeCreditInfo response, not inside PromotionRewards[0] — the reward-level field is always 0 for FC.
metadata:
  type: feedback
---

`/PM/GetFreeCreditInfo` returns TWO different `ExpiryMinutes` fields: `data.Promotion.PromotionRewards[0].ExpiryMinutes` (always 0 for FreeCredit — dead field) and `data.ExpiryMinutes` on the outer response, sibling to `Promotion` (this is the real claim-window value, matching [[project-ws1-legacy-name-dedupe]]-adjacent memory "WS1 FC ExpiryMinutes = claim window = rewards_validity_days × 1440").

**Why:** `bin/_deep-qc-ws1-tleo-tnc.mjs` originally read only the reward-level field, saw 0, and concluded the field "wasn't available" for FC — so it silently skipped validating claim-window vs the T&C's "valid for N day(s)" clause entirely. This meant a real discrepancy (WS1 SG's 12 TLEO FC promos had `ExpiryMinutes=0`, i.e. no enforced claim window, while their T&C promised "valid for 1 day") went undetected across multiple full audit runs on 2026-07-06 — MY had already been corrected to 1440 by the operator, SG had not.

**How to apply:** Any script reading FC detail must capture `outer = det.data` BEFORE destructuring into `promo = outer.Promotion`, and use `outer.ExpiryMinutes` for anything claim-window related — never `rew.ExpiryMinutes`. The auditor's E1 check (issue-level, not warn) now compares `outer.ExpiryMinutes / 1440` against the days figure in T&C clause 2 and FAILs on mismatch, including the "T&C promises a window but 0 is configured" case. Note: for Bonus (reload) type, no equivalent single field exists on either the outer or reward object — GetBonusInfo's outer wrapper only carries `RedeemableCount/RedeemableDay/RedeemableStartTime/RedeemableEndTime`, so the old V1 check for Bonus stays a documented no-op, not a verified pass.


**FIXED 2026-07-06:** SG's 12 TLEO FC promos corrected 0→1440 via bin/_fix-sg-fc-tleo-expiry.mjs (endpoint: /PM/UpdateFreeCreditDetails). Independently re-probed live post-commit: all 12 confirmed ExpiryMinutes=1440, T&C intact, deep-QC 54 PASS / 0 fail both sites.