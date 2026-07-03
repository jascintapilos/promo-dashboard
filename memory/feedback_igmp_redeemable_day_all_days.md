---
name: feedback_igmp_redeemable_day_all_days
description: "UpdateBonusDetails RedeemableDay must always be \"0,1,2,3,4,5,6\" string — never 0 integer"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a53ca962-83ac-4b74-9ed6-e0202e449a79
---

When calling `/PM/UpdateBonusDetails` on WS1 (IGMP), always set `RedeemableDay` to the string `"0,1,2,3,4,5,6"` (all 7 days). Never use `0` as an integer — the API interprets integer `0` as Sunday only and silently overwrites the schedule.

**Why:** Sending `RedeemableDay: 0` (int) during a botched name-update attempt on P108 MY reset Allowed Days to Sunday only. The API accepted it without error, making it a silent corruption.

**How to apply:** Any time `UpdateBonusDetails` is constructed — whether for a name fix, schedule edit, or any other reason — default `RedeemableDay` to `"0,1,2,3,4,5,6"` unless the operator explicitly requests restricted days. Read the current value from `GetBonusInfo` (`data.RedeemableDay`) and pass it through unchanged if it's already set; only default to all-days if it's null/missing.
