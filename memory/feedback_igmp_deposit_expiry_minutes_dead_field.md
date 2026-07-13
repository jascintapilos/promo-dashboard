---
name: feedback_igmp_deposit_expiry_minutes_dead_field
description: "IGMP GetBonusInfo always returns ExpiryMinutes=0 for deposit bonuses — dead placeholder, not a save failure"
metadata:
  type: feedback
---

`rew.ExpiryMinutes` (inside `PromotionRewards[0]`) is **always 0** in `/PM/GetBonusInfo` responses for deposit bonus promos, regardless of what was sent in `/PM/AddBonus`. This is an IGMP platform characteristic — the field is not persisted back in the read response.

**Why:** Verified live 2026-07-13 by comparing P076 (id=3824) and P077 (id=3825) on ws1-v3-my — both show `ExpiryMinutes=0` in GetBonusInfo even though AddBonus sent `ExpiryMinutes: 2880`.

**How to apply:** When Sentinel or any QC gate flags `ExpiryMinutes=0` for a WS1 DEPOSIT bonus, suppress as a known platform dead-field — not a misconfiguration. Confirm by checking that the T&C body states the intended validity period ("valid for two (2) days…"). The actual expiry is enforced by IGMP internally from the AddBonus payload; it simply doesn't round-trip through GetBonusInfo.

Do NOT attempt to patch ExpiryMinutes via UpdatePromotionRewardDetails — it's not in that endpoint's accepted fields, and calling it wipes T&C.

See also: [[feedback_igmp_reward_details_put_wipes_tnc]]
