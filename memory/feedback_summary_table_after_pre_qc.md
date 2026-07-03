---
name: feedback_summary_table_after_pre_qc
description: "After presenting Pre-QC results, always show a summary table of promo code, promo name (EN + ZH), and key mechanics before asking for commit confirmation."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

After the Pre-QC verdict table, ALWAYS show a second summary table with the resolved promo details so the operator can confirm what will actually be saved before committing.

**Table columns:**
| Handle | Brand | Code | EN Name | ZH Name | Bonus | TO | Min Dep | Categories |

Pull values from the plan bundles (`captures/qc-plans/<handle>__<brand>.json`).

**Why:** The operator caught that P165-P168 codes/names didn't reference the World Cup campaign (column K). Without this table the operator can't catch mismatches between what the sheet intended and what the bot plans to save.

**How to apply:** Fire this table immediately after the Pre-QC result table, before "ready to commit whenever you say go." Applies to every canary batch regardless of size.

[[feedback_summary_table_before_commit]]
[[feedback_always_summary_table]]
