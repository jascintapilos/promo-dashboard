---
name: feedback-value-per-spin-is-amount-per-line
description: "Sheet 'per spin' value = BO amount_per_line directly, no /20 division"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 98902d81-8b64-40ba-84cb-6eac991c35b2
---

Requestors write "per spin" in the sheet but mean BO's `amount_per_line` field directly.

**Why:** Previous `/20` convention (lines=10 × coins=2) was wrong — P001 had "0.01 per spin" meaning amount_per_line=0.01, not value_per_spin=0.01. The division produced 0.0005 which failed BO's 0.01 minimum.

**How to apply:** Both QPRO and QP2 mappers now pass `value_per_spin` straight to `amount_per_line` with no division. QC L2 compares `det.parsed.value_per_spin` (read back from BO's `amount_per_line`) against `resolved.parsed.value_per_spin`. [[feedback_fs_game_name_exact]]
