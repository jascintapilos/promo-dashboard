---
name: QP2 promo_type — Deposit Bonus = 2, NOT 1
description: QP2 BO promo_type enum is { 1: Manual, 2: Deposit Bonus, 3: Free Credit, 4: Free Spin }. Deposit/Cashback both go to 2. Defaulting to 1 makes the BO render the promo as "Manual - Normal".
type: feedback
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
QP2 BO promo_type enum (confirmed via operator-saved references 2026-05-20):

| promo_type | UI label |
|---|---|
| 1 | Manual |
| 2 | Deposit Bonus  (Deposit + Cashback) |
| 3 | Free Credit |
| 4 | Free Spin |

**Why:** P091-P096 (2026-05-20) all saved with `promo_type=1` because the QP2 mapper's `promoTypeInt()` fell through to 1 for "deposit". Operator flagged BO showing them as "Manual - Normal" instead of "Deposit Bonus". Mapper fixed (`api-mapper-qp2.js:286-300`) — deposit, cashback, and the unspecified fallback all return 2 now. Six live records re-PUT via `bin/fix-p091-p096-promo-type.mjs`.

**How to apply:** When editing or reviewing QP2 mapper code, never default `promo_type` to 1 for any bonus type — 1 means "Manual" which is operator-managed-only. If a bonus_type is unknown, fall through to 2 (Deposit Bonus) as a safe default — better to mislabel an unknown promo as Deposit than as Manual. QPRO uses a different enum and is unaffected.
