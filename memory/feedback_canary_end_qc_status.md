---
name: canary-end-qc-status
description: "At the end of every canary run, ALWAYS report BO save accuracy+completeness without being asked, and then write \"QC Completed\" back to the promo request sheet status column."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

After every canary auto-flow (triage → dry-run → pre-qc → commit → sentinel), the closing turn MUST do two things WITHOUT being prompted:

1. **Report accuracy + completeness.** End the canary turn with a clear verdict: "BO saves are accurate and complete" (or call out specifically which save is wrong). Include the count (N/N saves verified) and a one-line summary of any false-positives the user can ignore. Don't wait for the user to ask "is qc completed" or "are the saves accurate" — they've made this part of the auto-flow contract.

2. **Update sheet status to "QC Completed".** Once accuracy is confirmed across all saves in the batch, write back `status = "QC Completed"` to each handle's row in the source sheet (overwriting the `"Created"` value the canary commit step set). Use `bin/sheets-writeback.mjs` or equivalent. Confirm the sheet write in the final message.

**Why:** Jascinta's downstream team uses the sheet's `status` column as the signal for "this promo is verified and assignable" vs "this promo just got saved but hasn't been audited". `"Created"` alone is ambiguous — could be saved but broken. `"QC Completed"` means Sentinel passed and the promo is safe for Manual Reward Assignment.

**How to apply:** Inside the canary auto-flow only. Don't update status to "QC Completed" outside a canary run (e.g., don't backfill old rows without explicit user direction). If Sentinel returns any REAL fail (not a known tooling false-positive), DO NOT mark "QC Completed" — report the failure and ask for direction.

Linked: [[feedback_always_qc_after_save]], [[feedback_auto_pre_qc_on_request]].
