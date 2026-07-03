---
name: always-qc-after-save
description: "After any live commit to BO/IGMP/CMS, always run parallel QC against the just-created records — never declare a batch done without verification."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 01415b09-50cf-4296-a456-1ac2c801f68b
---

After any live save run (single or batch — QPRO, QP2, WS1/IGMP, or any
brand), ALWAYS run a parallel QC sweep against the just-created records
to verify they're actually complete. Don't end the task or declare success
based on the runner's exit code alone.

**Why:** P124-P163 commit returned "OK" per row from the runner, but the
runner only tracked the popup-POST step's success. Downstream steps
(promotion_name × N + final PUT linking template + popup) had silently
been skipped on the orphan path. The runner exit codes lied about
completion — only an end-to-end QC against the BO caught that
dialog_popup_list was empty and locale names were missing. The user had
to ask for QC explicitly. Avoid that pattern.

**How to apply:**
- After any live commit script runs to completion, fire a QC script that
  reads each record back from BO via the appropriate listing endpoint
  (for QPRO use `/api/bo/promotion?code=X` — the detail endpoint does NOT
  return `dialog_popup_list`; for WS1/IGMP use `/PM/GetPromotionInfoByCode`).
- Verify at minimum: code matches, name set, status active, message
  template linked, dialog popup linked, currency rows present, name rows
  per-locale present.
- Run QC in parallel (concurrency ~20) — single-threaded QC is slow
  and unnecessary; GETs have no inter-dependencies.
- Surface PASS/FAIL counts per check, not just a single aggregate. A
  partial pass is more useful than "all good" when one check is broken.
- Save QC results to a JSON summary file alongside the run logs.
- If QC fails: do NOT silently fix — surface the failures and the
  root cause for operator review.

Related: [[feedback_always_probe_bo_duplicate]] (pre-write probe).
