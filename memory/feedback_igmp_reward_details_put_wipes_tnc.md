---
name: feedback-igmp-reward-details-put-wipes-tnc
description: IGMP /PM/UpdatePromotionRewardDetails silently DELETES the reward's PromotionRewardContents (T&C) — always re-add T&C after any reward-detail update.
metadata:
  type: feedback
---

On WS1/WS2 (IGMP), `/PM/UpdatePromotionRewardDetails` — used to edit RewardName, CapBonusAmount, WithdrawalCap etc. — **silently wipes the reward's PromotionRewardContents (the reward-tab T&C, all locales)**. `/PM/UpdatePromotionDetails` (promotion-level name/desc/dates) is safe and does NOT touch contents.

**Why:** Discovered 2026-07-06: the 2026-07-04 TLEO RewardName pass (`bin/_rename-ws1-tleo-rewardnames.mjs`) is what emptied all 42 WS1 MY Bonus-TLEO T&C (FC promos it never touched kept theirs); reproduced live when the SG wrong-rate name fix wiped 5 SG promos' T&C, caught by `bin/_deep-qc-ws1-tleo-tnc.mjs` and restored via `bin/_restore-sg-tleo-tnc-5.mjs`.

**How to apply:** Any script calling UpdatePromotionRewardDetails MUST: (1) read `GetPromotionRewardContents {RewardId}` BEFORE the update, (2) re-post them via `BulkAddorUpdatePromotionRewardContents` immediately AFTER, (3) verify locales non-empty post-save. Same preserve-across-PUT pattern as [[feedback-preserve-dialog-on-put]]. QC any reward-detail edit with the T&C probe afterwards.
