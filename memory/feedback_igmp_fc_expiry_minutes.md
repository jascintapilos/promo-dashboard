---
name: feedback-igmp-fc-expiry-minutes
description: "WS1 FC ExpiryMinutes = claim window in minutes (rewards_validity_days × 1440, default 10080 = 7 days). Not the same as EffectiveMinutes."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d3c34533-7226-490c-9a72-2e0385e4f2d2
---

`ExpiryMinutes` on `/PM/AddFreeCredit` is the **before-claim window** — how long the player has to claim the promo after it is issued.

**Rule:** derive from `rewards_validity_days × 1440`. Default 10080 (7 days) when not set.

```js
ExpiryMinutes: Number(
  rec.expiry_minutes_ws1
  ?? (rec.rewards_validity_days != null ? Number(rec.rewards_validity_days) * 1440 : null)
  ?? rec.expiry_minutes
  ?? 10080,
),
```

**Why:** Operator confirmed 7 days = 10080 minutes is the standard for FC promos. Hardcoding `1` (which was tried mid-session) is wrong — that is `EffectiveMinutes`'s value, not `ExpiryMinutes`.

**How to apply:** Never confuse the two:
- `EffectiveMinutes` = always **1** (see [[feedback-igmp-effective-minutes-one]])
- `ExpiryMinutes` = claim window from `rewards_validity_days`, default 10080

`GetFreeCreditInfo` does NOT return `ExpiryMinutes` in its response — `undefined` in QC output is expected; verify at create-time via the POST response.
