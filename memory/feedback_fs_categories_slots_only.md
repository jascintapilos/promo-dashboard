---
name: Free Spin Categories — Slots only (both QPRO and QP2)
description: Operator rule confirmed 2026-05-14. Free Spin promos restrict Eligible Categories to Slots ONLY (not "Select All - exclusions"). Applies uniformly across QPRO and QP2 platforms.
type: feedback
originSessionId: bdcf6e25-b81a-451e-9f65-d950b7db70f8
---
Rule: when `bonus_type === 'Free Spin'` the Categories multi-select picks **Slots only**, never the inverted "all except exclusions" pattern used for Deposit / FC / Cashback.

**Why:** Free Spin promos are tied to a specific slot game (one game from one provider). Allowing other categories would be inconsistent with the bonus mechanic.

**How to apply:**
- For FS in both `bo-mapper-qpro.js` and `bo-mapper-qp2.js`: use `kind: 'multiselect'` with `options: ['SLOTS', 'Slots', 'Slot']`.
- The multi-variant list handles per-brand label casing differences (uppercase / title / singular).
- Game Providers should also be restricted to the FS promo's game provider only — see existing "follow free spin games" rule in both mappers.

**Confirmed today (2026-05-14):** QPRO mapper already had this. QP2 mapper was using inverted exclusions for all bonus types — fixed in this session.
