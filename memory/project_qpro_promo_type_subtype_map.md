---
name: qpro-promo-type-subtype-map
description: "QPRO1 (verified) promo_type + promo_sub_type → rendered Bonus Type label, including Deposit Welcome (t2/s2) vs Reload (t2/s1)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9b3d4c18-171b-4d17-add7-ab89c833c94c
---

QPRO1 BO renders the "Bonus Type" column based on `(promo_type, promo_sub_type)` pair. Verified 2026-06-22 across 60 promos:

| (promo_type, sub_type) | Rendered label | Sample codes |
|---|---|---|
| (2, 1) | **Deposit - Reload** | REL_*, RET_*, WELC_188PCT_25X (misnamed) |
| (2, 2) | **Deposit - Welcome** | aff_bonus_120PCT, TSM_WELC_* (P119-P121) |
| (3, 1) | **Free Credit - Free Credit** | VM_FC_2088_*, FT_KYC_FC188 |
| (3, 6) | Free Credit (BTG Phase 1 variant) | test22_BTG_PHASE_1 |
| (3, 7) | Free Credit (BTG Phase 2 variant) | test22_BTG_PHASE_2 |
| (4, 1) | **Free Spin - Welcome** | WELC_199FS_GOOSS_10X |
| (4, 2) | **Free Spin - Reload** | REL_28FS_FOO, 50FS_*_GOO_WCF |

**Critical:** the CODE NAME does NOT determine the rendered type — `WELC_188PCT_25X` saved with `(2,1)` renders as "Deposit - Reload" even though its name says WELC. Only the type/sub_type pair matters.

**Mapper bug** (2026-06-22): `src/api-mapper-qpro.js` `promoTypeInt()` + `promoSubTypeInt()` always emits `(2, 1)` for any Deposit bonus_type — so WELC requests get saved as Reload. Fix:
- bonus_type contains "Welcome" → `(2, 2)`
- bonus_type contains "Reload" → `(2, 1)`
- otherwise Deposit → `(2, 1)` (Reload default)

P119-P121 (id=1023/1024/1025) on QPRO1 were the first WELC deposits to expose this — manually patched to (2,2). See [[feedback-qpro-type-3-is-free-credit]].

**Discovery method:** the list endpoint `/api/bo/promotion?limit=200` returns a `bonus_type` field per row with the rendered string label. To verify a sub_type combo: PUT with that combo, then re-read the list and check `bonus_type`.
