---
name: feedback-igmp-min-deposit-create-only
description: WS1 (IGMP) deposit-bonus MinimumActionAmount is CREATE-ONLY — no edit endpoint exists; fixing a wrong min deposit requires deactivate + recreate with bumped code suffix.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 590585d7-8f31-4a1b-8cc6-809f6208be61
---

On WS1 v3 (IGMP kiosk BOs), a deposit bonus's `MinimumActionAmount` (min deposit) **cannot be edited after creation**. Live-tested 2026-07-07 on pid 2898 (`FT_REL_70PCT_18X_MIN100_V1`, ws1-v3-sg): both `/PM/UpdatePromotionRewardDetails` and `/PM/UpdateBonusDetails` return success but silently ignore a `MinimumActionAmount` field; the BO edit page's own JS (captures/igmp/ws1-v3/MY/deposit-bonus/Bonus.js) populates the min-deposit textbox but never includes it in any save call; 8 candidate `/PM/Update*` endpoints probed — all 404. Only `AddBonus` accepts it. (FreeSpin promos differ: `/PM/UpdateFreeSpinDetails` DOES accept MinimumActionAmount.)

**Why:** The BO edit-page save chain only carries RewardName / RedeemableQuantity / CapBonusAmount / KYC / WithdrawalCap / MaximumBalance (UpdatePromotionRewardDetails) and schedule + EffectiveMinutes (UpdateBonusDetails). BonusPercentage / RolloverMultiplier / MinimumActionAmount / RedemptionType have no update path either.

**How to apply:** To fix a wrong min deposit (or bonus %, TO) on a WS1 deposit bonus: deactivate the bad promo and recreate via AddBonus with a bumped code suffix (codes stay reserved after deactivation). Precedent: `FT_REL_70PCT_18X_MIN100` pid 2882 (wrong MIN50 config) → deactivated → recreated as `_V1` pid 2898. Remember to relink any FastTrack campaign that references the old code, and follow [[feedback_ws1_ws2_unique_promo_name]] for the new name. See also [[project_igmp_edit_status_endpoints]].
