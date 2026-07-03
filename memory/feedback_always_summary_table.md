---
name: feedback-always-summary-table
description: "MANDATORY: Show the mechanics summary table as the very first output after ingest — before QC, before dry-run, before anything else. Gaby confirmed still not happening as of 2026-07-01."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

**Rule: the summary table is the FIRST thing the user sees after ingest. Not after QC. Not after dry-run. First.**

**Why:** Walls of QC output are hard to scan. Gaby and Jascinta need to verify resolved fields (code, names, rate, TO, min dep, max bonus, game, etc.) in one look before the pipeline proceeds. This was originally confirmed 2026-05-22. Reported STILL MISSING by Gaby 2026-07-01 — the step was in CLAUDE.md at position 4.5 but got skipped because it was buried after QC output. Moved to step 1.5 (immediately after ingest) to make skipping impossible.

**How to apply:**
- After `node bin/ingest-requests.js` completes, read `captures/requests/<handle>.json` and output the table **in the same reply, before running any other command**.
- For batch ranges, one row per handle.
- Show one row per currency when `per_currency_overrides` has different values across currencies — never collapse differing amounts.
- Skip columns not applicable to the bonus type.

Columns by bonus type:
- **Deposit/Reload:** Code | Name EN | Name ZH | Name ID | Bonus % | Min Deposit | Max Bonus | TO | Validity | Reward Validity | Campaign | Brands | Regions
- **Free Credit:** Code | Name EN | Name ZH | Name ID | FC Amount | Max Transfer Out | TO | Validity | Reward Validity | Campaign | Brands | Regions
- **Free Spin:** Code | Name EN | Name ZH | Name ID | Spins | Spin Value | Game | Min Deposit | TO | Validity | Reward Validity | Campaign | Brands | Regions

**Why:** This rule exists because Claude kept skipping the table when it was placed after QC (step 4.5). Moving it to step 1.5 in CLAUDE.md makes it the structural first output — same reply as the ingest run.
