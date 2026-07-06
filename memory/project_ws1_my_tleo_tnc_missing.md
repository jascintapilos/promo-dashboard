---
name: project-ws1-my-tleo-tnc-missing
description: "WS1 MY TLEO reward T&C backfilled 2026-07-06 (41/42 via SG clone); FT_REL_TLEO_45PCT_458MX still open (cap 450 vs 458 mismatch)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 05fa4dab-4d6e-4c2c-b58d-dc42509031b9
---

2026-07-06 probe (`bin/_probe-ws1-tleo-tnc.mjs`): **all 42 Bonus-type TLEO promos on WS1 MY have ZERO PromotionRewardContents rows** (reward tab T&C empty). WS1 SG has approved en+zh T&C on the same 42 codes; MY family was replicated without the T&C step. FC-type TLEO codes (12/site) have T&C on both sites — fine.

Fix drafted, dry-run verified, NOT yet committed: `bin/fix-ws1-my-tleo-tnc.mjs` — clones SG content per code with `SGD→RM` + `mb8sg.com→mb8mys.com` swaps ([[feedback-cross-brand-mt-swap-tncdomain]]), gated on SG content numbers matching MY live economics (MinimumActionAmount/CapBonusAmount/RolloverMultiplier/BonusPercentage). Dry-run: 41/42 clean; **1 flagged: FT_REL_TLEO_45PCT_458MX — MY live cap=450 but code + SG say 458 → MY BO config itself likely wrong; needs cap fix (UpdatePromotionRewardDetails, see WS1 v3 strings quirk in `bin/_rename-ws1-tleo-rewardnames.mjs`) before/instead of clone.**

Endpoints: read `GetPromotionRewardContents {RewardId}` (RewardId from GetBonusInfo `Promotion.PromotionRewards[0]`; FC promos use `GetFreeCreditInfo`, FS use `GetFreeSpinPromotionInfo` — same shape). Write `BulkAddorUpdatePromotionRewardContents {RewardId, PromotionRewardContents:[{Locale, PromotionRewardName, Content}]}`. Related: [[project-ws1-legacy-name-dedupe]].
