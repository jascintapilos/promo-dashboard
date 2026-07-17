---
name: feedback_qp2_promotioncurrency_put_rate_scaling
description: "QP2 standalone PUT /api/bo/promotioncurrency/{id} multiplies bonus_rate ×100 exactly like the standalone POST — echo-PUT of a deposit-type row corrupts the rate (120 → 12000). Send rate/100."
metadata:
  type: feedback
---

# QP2 promotioncurrency PUT scales bonus_rate ×100 (verified live 2026-07-17)

The ×100 `bonus_rate` scaling documented for standalone `POST /api/bo/promotioncurrency` (api-mapper-qp2.js:470) applies to the standalone **PUT /api/bo/promotioncurrency/{id}` too**. Echoing a GET row back (the fix-p030/fix-p074 recipe) corrupts deposit-type rows: `bonus_rate: "120.00"` echoed → stored as `12000.00`. Verified live on ibc22 row 2625 (promo 1400 ACQ_WELC_120PCT_12X_LC); repaired same session by re-PUT with `bonus_rate: 1.20` → stored `120.00`.

**Why:** Prior echo-PUT scripts (fix-p030, fix-p074) never tripped this because their QP2 targets were FC/FS promos with `bonus_rate=0` (0×100=0) — probed 1361/1181 on 2026-07-17, both clean. Any future echo-PUT on a **Deposit-type** currency row will silently 100× the bonus percentage.

**How to apply:** When PUT-ing a promotioncurrency row, always send `bonus_rate: <intended_pct>/100` (e.g. `1.20` for 120%), never the GET-echoed string. Include a post-PUT verify that reads the row back and compares `Number(bonus_rate)` to the intended percentage; stop the batch on mismatch. The embedded promotion-POST path is unaffected (stores 30 as 30.00, no scaling). See [[project_qp2_promotion_put_semantics]].
