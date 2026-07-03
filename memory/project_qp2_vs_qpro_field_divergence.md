---
name: qp2-vs-qpro-field-divergence
description: "For mechanics comparison across QP2 (ibc22) and QPRO sites, the same semantic field is stored under different field names + different rows. Normalize before comparing or the diff is meaningless."
metadata: 
  node_type: memory
  type: project
  originSessionId: 01415b09-50cf-4296-a456-1ac2c801f68b
---

QP2 (ibc22 BO, merchants QP2A-D) and QPRO (qpro1-17) store the same
promotion semantic fields in different places. For ANY cross-platform
mechanics QC, normalize first.

| Semantic field | QP2 location | QPRO location |
| --- | --- | --- |
| Bonus rate (%) for Reload | promotioncurrency.bonus_rate | promotion.bonus_rate (TOP-LEVEL) |
| Min deposit | promotioncurrency.min_deposit | promotioncurrency.min_transfer |
| Max bonus | promotioncurrency.max_bonus | promotioncurrency.max_bonus (same) |
| Free credit amount (FC promos) | promotioncurrency.bonus_amount | promotioncurrency.free_credit_amount |
| Turnover multiplier | promotion.target[0].multiplier (on detail endpoint) | promotion.target[0].multiplier (same, detail endpoint only) |
| Categories (turnover) | promotion.promotion_category[].category_id | promotion.promotion_category[].category_id (same) |
| Currency block | full block, includes min_transfer=0 separately | min_transfer holds min_deposit; bonus_rate not stored here |

**Why this matters:** First mechanics QC pass on 48 codes flagged 47/48
as mismatches — every "diff" turned out to be a field-name divergence,
not a real config mismatch. After normalization only 2 codes had real
issues (both legacy QPRO2 entries, fixed via PUT).

**Normalizer pattern (per-currency row):**
```js
const perCurrency = currencies.map(cc => ({
  currency: cc.currency,
  bonus_rate:        nz(cc.bonus_rate) ?? nz(row.bonus_rate),         // QP2 has it per-curr; QPRO is top-level
  min_deposit:       nz(cc.min_deposit) ?? nz(cc.min_transfer),       // QP2: min_deposit; QPRO: min_transfer
  max_bonus:         nz(cc.max_bonus),
  free_credit_amount: nz(cc.free_credit_amount) ?? nz(cc.bonus_amount), // QPRO: free_credit_amount; QP2: bonus_amount
}));
```
Plus: treat `0` and `null` as equivalent (different platforms write
"not applicable" sentinel differently). Without that, a Reload bonus
with FC=0 on QPRO looks "different" from FC=null on QP2.

**Where this is used:** `bin/_probe-qp2d-sheet-codes-v2.mjs` —
parallel cross-platform probe + mechanics diff.

Also note: `dialog_popup_list` is only on the listing endpoint, never
on the detail. See [[feedback_promotion_put_dialog_popup_list_wipe]].
Same for popup GET-by-id (405) — see [[feedback_popups_get_405_use_listing]].
