---
name: QPRO BO `name` field follows column M (internal reference), tier lines stripped
description: QPRO promotion `name` = column M (Name/Details Internal reference) with tier indicator lines like "Silver and below" / "Gold and above" stripped. Consumer-facing names stay in promotion_name rows (column X / Y).
type: feedback
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
For QPRO BO saves, the `name` field on `/api/bo/promotion` is the operator's INTERNAL admin label, sourced from the sheet's column M. The earlier behavior used column X (`promotion_name_en` — the consumer-facing name) which made the BO list view less informative for the operator.

**Why:** Per Jascinta 2026-05-17. Operators scan the QPRO BO promotion-codes list by internal reference — they want to see "Deposit bonus 50%/ max bonus 150/ min depo 300/ TOx3" not "50% Reload Bonus". The consumer-facing copy lives on the per-locale `promotion_name` rows (still set from column X / Y).

**How to apply:**
- `src/api-mapper-qpro.js` → `qproInternalName(resolved)` collapses `name_details_raw` to a single line with `" | "` separators and strips any line matching `/^(normal|bronze|silver|gold|platinum|diamond)\s+(and\s+)?(above|below|only)\b/i` — those lines are tier metadata, not name content.
- Used in both `buildPromotionBody` (POST) and `buildUpdateBody` (PUT). Falls back to `promotion_name_en || promo_code` when column M is empty.
- QP2 leaves `name` = `promotion_name_en` (operator didn't ask for this on QP2; QP2 admin list works fine with consumer-style names).
- Tier-prefix in promo_code (SIL/GLD/PLT/etc.) is unrelated — that's name conventions for the CODE, not the NAME field.
