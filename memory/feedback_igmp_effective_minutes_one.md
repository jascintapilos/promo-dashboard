---
name: IGMP EffectiveMinutes = 1 (not 1440)
description: WS1/MB8 POST /PM/AddBonus + AddFreeCredit must set EffectiveMinutes=1, not the 1440 default the mapper currently emits
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
The IGMP/WS1 POST body field `EffectiveMinutes` must be **1**, not the `1440` default the mapper currently emits.

Per operator 2026-05-21 (caught from P085–P090 review).

### Current state (wrong)

`src/api-mapper-igmp.js:198` (Deposit Bonus):
```js
EffectiveMinutes: Number(rec.expiry_minutes_ws1 ?? rec.effective_minutes ?? 1440),
```

`src/api-mapper-igmp.js:254` (Free Credit):
```js
EffectiveMinutes: Number(rec.effective_minutes ?? 1440),
```

### Required

```js
EffectiveMinutes: Number(rec.effective_minutes ?? 1),   // default 1, not 1440
```

(If a request explicitly carries `effective_minutes` from the sheet, honor that; otherwise default to 1.)

### Apply also to Free Spin

Check the FS path (`POST /PM/AddFreeSpin`) — if it has its own `EffectiveMinutes` setter, same fix.

### Retroactive

P085–P090 on MB8 MY (IDs 3420–3425) + SG (IDs 2628–2633) currently have `EffectiveMinutes: 1440`. Need a patch-PUT on those 12 promotions to set `EffectiveMinutes: 1`. Helper script can use the same shape as the original `/PM/AddBonus` body — re-emit with EffectiveMinutes=1 (BO accepts a PUT shape that mirrors the POST; verify the endpoint first via probe).

### Why this matters

Field controls how long the bonus stays redeemable after issuance. 1440 minutes = 24 hours; 1 minute = effectively immediate use only. Operator's standard for these promos is 1 — likely tied to immediate-claim CRM workflow (the user gets the bonus, claims within minutes via the Inbox-led flow, then the window closes).

Don't change this default to >1 without explicit operator approval per-batch.
