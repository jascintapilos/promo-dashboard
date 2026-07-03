---
name: auto-pre-qc-on-request
description: "Always auto-fire /pre-qc after the dry-run and before suggesting --commit for any P### request. Symmetric with the existing always-QC-after-save rule."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

Saved 2026-06-23 after user opted into "Always auto-fire" for the pre-qc sub-agent fan-out.

**The rule:** For every P### / B### promo request (single or batch), the assistant MUST automatically run `/pre-qc <handle>` after the canary dry-run, present the pass/fail table, and wait for user direction before suggesting `--commit`.

**Why:** Operator concerned that sub-agents could be missed if invocation is manual. Pairs with [[feedback_always_qc_after_save]] for symmetric vigilance both sides of the commit. User explicitly chose this over opt-in to prioritize accuracy over speed.

**How to apply:**

When the user prompts a new request — phrasings like:
- "process P172"
- "run P175-P180"
- "check the new ones"
- "set up this promo" (with a P### context)
- Pasted Slack delegation with P### / B###

Execute this sequence automatically without asking:

1. `node bin/ingest-requests.js` (refresh from sheet — per [[feedback_always_reingest_before_run]])
2. **`/qc-engine <handle>`** ← AUTO. Spawn `promo-qc-engine` sub-agent to validate the ingested row (completeness, naming, parsed fields, mechanics limits, region/currency match). If any FAIL, present issues + suggested fixes, wait for user to fix source sheet and re-ingest before proceeding.
3. `node bin/canary-multi-brand.js <handle> --parallel` (dry-run writes plan bundles)
4. **`/pre-qc <handle>`** ← AUTO. Spawn `promo-qc` sub-agent per brand via Agent tool, aggregate findings.
5. Present pass/fail table to user.
6. **Wait** for user direction. Do NOT proceed to commit automatically.
7. After user confirms commit: `node bin/canary-multi-brand.js <handle> --commit --parallel --parallel-qc`
8. **`/deep-qc <handle>`** ← AUTO. Post-save verification.

**Skip conditions:**
- If the dry-run aborts on idempotency (code already exists on BO) for ALL brands, no plan bundles exist, so /pre-qc has nothing to read. Surface the idempotency block instead.
- If `/qc-engine` returns FAIL with `field: "request_file"` (handle not ingested), tell the user to run ingest and stop — do not attempt the dry-run.

**Cost note:** Adds ~10-15s + a few cents per request. For batch runs (e.g. P060-P073), cost scales linearly. User accepted this tradeoff for accuracy.

Related: [[feedback_always_qc_after_save]], [[feedback_always_reingest_before_run]], [[project_parallel_qc_deep_qc]], [[feedback_subagent_design_principles]].
