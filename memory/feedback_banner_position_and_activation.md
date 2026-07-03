---
name: Banner positioning + activation rules (QPRO)
description: Position and status rules for 3.3 Promotion Contents and 14.2 Banners on QPRO. In-house=1/2, PP=3/4, others=5. Homepage always 5 total.
type: feedback
originSessionId: a31ede4f-1d05-4976-a033-a57703302ce0
---
## Position order (homepage, always 5 slots total)

| Slot | Type | Example |
|------|------|---------|
| 1–2  | In-house brand campaigns | BP9 Mid-Year Spend & Win, May Turnover Streak |
| 3–4  | Pragmatic Play vendor campaigns | Daily Wins Season X, PP Sweet Bonanza |
| 5    | Other vendors | Microgaming, Ezugi, FastSpin |

- **Future-dated in-house campaigns still get position 1 or 2** — they are inactive (status=0) until live, so they don't displace the current homepage banner; set position at creation time.
- **Winners list 3.3 content** gets the same position as the main promo (position 1 for in-house).
- Only 5 active positions on the homepage; position 6+ = promotions page only.

## Activation

- Both **3.3 Promotion Content** and **14.2 Banner** must be explicitly activated (status=1).
- They are created as status=0 (draft/inactive) by upload-promo.js — always activate separately.
- Winners list 3.3 content stays at status=1 but is kept future-dated; it surfaces automatically on its start date.

## Apply to

Every new banner upload (B-ID flow): set position immediately after creation based on campaign type, then activate both 3.3 + 14.2 when ready.

**Why:** B46 BP9 Mid-Year Spend & Win was created at position=99 / status=0 and needed manual repositioning + activation. Position and activation are not automatic.
