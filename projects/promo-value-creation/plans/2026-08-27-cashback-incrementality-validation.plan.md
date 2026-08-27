# Plan: VIP Cashback Incrementality Validation (cashback-only pilot)

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** COMPLETED
**Created:** 2026-08-27
**Goal:** Close the holes in the base-rate finding so the Weekly Rescue cashback (esp. Diamond RM1.33M) can be judged on evidence — does it make VIPs *play more* (not just come back), what's the break-even bar per tier, how much top-Diamond value a wrong cut risks, and the experiment that would settle it — all merged into the VIP report's Lane B "Review".
**Architecture:** Extend the existing losing-week panel (`cashback_incrementality.py`) to the intensive margin + a within-member cross-check; a small break-even/downside script; a holdout spec doc; then merge a `cashback_validation` block into `vip-metrics-MY.json`. Observational reads are DIRECTIONAL (98% claim → no clean untreated group); the holdout is the proof. Member-level → scratchpad only.
**Tech/Tools:** Python `C:/Users/vdiuser/AppData/Local/Python/pythoncore-3.14-64/python.exe` + clickhouse-connect (`csir_config.get_client`; tunnel `.\start_csir_tunnel.ps1` if 8223 not listening); data max 2026-08-26; NGR is NET of the bonus (break-even 0 — do NOT re-subtract cost).
**Design:** projects/promo-value-creation/plans/2026-08-27-cashback-incrementality-validation-design.md

## File Map

- Modify: `bin/vip_report/cashback_incrementality.py` — add the INTENSIVE margin (forward-30/60d deposit amount + NGR + GGR, treated vs matched-untreated on tier × loss-decile × prior-deposit-decile) + a within-member cross-check (same member's cashback vs own no-cashback loss-weeks) + a date-shifted placebo. Output → `scratchpad/vip/cashback-incrementality-MY.json` (extended).
- Create: `bin/vip_report/cashback_breakeven.py` — per-tier break-even (incremental forward NGR vs cashback cost) + top-Diamond downside (top-Diamond forward value/LTV + churns-to-wipe-RM1.33M). Output → `scratchpad/vip/cashback-breakeven-MY.json`.
- Create: `bin/vip_report/cashback-holdout-spec.md` — the experiment protocol (design deliverable, not executed).
- Create: `bin/vip_report/merge_cashback_validation.py` — merge both JSONs into `vip-metrics-MY.json` as a `cashback_validation` block + verify (recompute/sanity/PII).
- Scratchpad only (PII): `scratchpad/vip/*`.

---

## Tasks

### Task 1: Intensive-margin — do cashback players deposit/play MORE?

- [x] **Task 1**
  - Result: ✅ Extended `cashback_incrementality.py` → intensive margin via CEM matching (tier×loss-decile×prior-deposit-decile), 19,778 losing-week records (3,705 treated), 96–100% on support. **Cashback recipients do NOT deposit/play more:** Diamond incr deposit **−RM19,159** / incr NGR **−RM22,405**; Gold ~0; Silver −RM1,737; Platinum mixed (+RM4,847 NGR). The +2.7pp binary "came back" does not become extra money → hardens the dead-weight read. (Negative partly residual selection — untreated self-select active; within-member check controls it.)

**Files:** Modify `bin/vip_report/cashback_incrementality.py`

**Step 1:** In the weekly-panel loop, for each qualifying losing week ALSO accumulate forward-30d and forward-60d **deposit amount**, **NGR**, and **GGR** (extend the existing forward-window logic beyond the binary redeposit). Keep per-row: tier, week loss size, prior-28d deposit total (the pre-loss deposit level for matching).
- Tool: Edit, Bash

**Step 2:** Match treated↔untreated within cells of (tier × loss-size decile × prior-deposit decile); drop off-support cells; for each tier compute treated vs matched-untreated mean forward-30/60d deposit amount, NGR, GGR, and the **difference (incremental)**. Emit into `cashback-incrementality-MY.json` alongside the existing base-rate block.
- Tool: Edit, Bash

**Step 3:** Print per tier: treated vs matched-untreated forward deposit + NGR + the incremental, Diamond first.
- Expected: a concrete per-tier intensive-margin lift (RM), esp. Diamond — the number the binary redeposit missed.

**Verify:** Matched cells balance on the covariates (print cell counts); incremental deposit/NGR computed per tier; Diamond has a non-trivial matched sample.

---

### Task 2: Within-member cross-check + date-shifted placebo

- [x] **Task 2**
  - Result: ✅ Within-member (same player's cashback vs own no-cashback losing-weeks) + date-shifted placebo. **KEY FINDING: the two methods DISAGREE on sign for Diamond** — cross-section −RM22K/wk (selection-biased down) vs within-member **+RM5.4K/wk** (208 Diamonds w/ both; mean-reversion-biased up). Platinum +RM1.6K within; Gold/Silver ~0. The RM27K/player swing = observational data cannot resolve Diamond's sign → holdout essential; do NOT cut on this. Placebo noisy (small samples) — reported as directional.

**Files:** Modify `bin/vip_report/cashback_incrementality.py`

**Files:** Modify `bin/vip_report/cashback_incrementality.py`

**Step 1:** For members with BOTH cashback loss-weeks and own no-cashback loss-weeks, compare that member's forward-30d NGR/deposit after a cashback week vs their own no-cashback weeks (member-mean difference, averaged). This nets out the player's own stickiness.
- Tool: Edit, Bash

**Step 2:** Placebo: re-run the treated/untreated contrast with claim dates shifted back ~21 days (assign sham "treated" to the wrong week); a genuine effect must SHRINK under the shift. Emit both into the JSON.
- Tool: Edit, Bash

**Step 3:** Print the within-member difference + the placebo delta.
- Expected: if within-member ≈ 0 or the placebo doesn't shrink → the post-cashback bounce is natural rebound (dead-weight); a robust positive that vanishes on placebo → real.

**Verify:** Within-member sample size printed; placebo contrast computed; interpretation line emitted (directional).

---

### Task 3: Per-tier break-even + top-Diamond downside

- [x] **Task 3**
  - Result: ✅ `cashback_breakeven.py`. **Per-tier break-even (incremental NGR>0 since NGR nets cost): Platinum CLEARS (+RM4.8K/+RM1.6K — keep) · Gold & Silver FAIL both methods (dead-weight — cut candidates) · Diamond INCONCLUSIVE (cross −22K vs within +5.4K).** **Top-Diamond downside: the #1 Diamond generates RM1.99M YTD NGR — churning just 1 top Diamond wipes the entire RM1.33M "saving."** → hold Diamond, run holdout; Gold/Silver are the cleaner cuts. Turns "cut Diamond" into a nuanced tier-by-tier call.

**Files:** Create `bin/vip_report/cashback_breakeven.py`

**Files:** Create `bin/vip_report/cashback_breakeven.py`

**Step 1:** Read `cashback-incrementality-MY.json` + `vip-metrics-MY.json` (Lane B per-code spend) + `member-ledger-MY.json`. Per tier: cashback cost B; incremental forward NGR (treated − matched-untreated) × N; since NGR nets the bonus, **incremental NGR > 0 = break-even** (do NOT subtract B again). Report per tier the incremental NGR vs B and the **attributable-retention bar** Diamond's RM1.33M must clear.
- Tool: Write, Bash

**Step 2:** Top-Diamond downside: from the ledger, the top-N Diamonds' YTD NGR (proxy LTV) and **how few of them must churn to erase the RM1.33M "saving"**. Emit `cashback-breakeven-MY.json`.
- Tool: Write, Bash

**Step 3:** Print per-tier break-even + the "N Diamond churns wipe RM1.33M" number.
- Expected: a clear "Diamond clears / doesn't clear its bar" read + the bar-to-cut (e.g. "~3 Diamonds").

**Verify:** No double-subtraction of bonus (assert incremental-NGR basis); downside number is concrete; cross-foots to the ledger.

---

→ CHECKPOINT: Review the validation numbers — does the intensive margin change the dead-weight read? What's Diamond's break-even bar and the churns-to-wipe? Confirm before writing the spec + merging.

---

### Task 4: Holdout spec (the experiment that settles it)

- [x] **Task 4**
  - Result: ✅ `bin/vip_report/cashback-holdout-spec.md` — self-contained protocol: Gold/Silver/flat 80/20 offer-withhold; Diamond 29/22/15% within-subject rate-crossover (never zeroed); primary endpoint forward 60–90d NGR + deposit amount; guardrails (host sign-off, auto-release, mask from VMs, no >1 consecutive week); per-tier decision rule (keep iff incremental NGR CI>0; Diamond→15% if it retains as well as 29%).
- Depends: Task 3

**Files:** Create `bin/vip_report/cashback-holdout-spec.md`

**Step 1:** Write the protocol: low/mid tiers 80/20 offer-withhold; Diamond 29/22/15% within-subject rate-crossover (never zero); primary endpoint **forward 60–90d NGR + deposit amount** (secondary churn); rough power/duration; guardrails (cap Diamond exposure, VIP-host sign-off, auto-release on distress, mask holdout from front-line VMs); the per-tier decision rule (keep only if incremental forward NGR clears cost with confidence; Diamond → cut to 15% if it retains as well as 29%).
- Tool: Write

**Verify:** Spec is self-contained and runnable by the business — endpoints, arms, guardrails, decision rule all present; no whale is ever fully cut off.

---

### Task 5: Merge into vip-metrics-MY.json + verify

- [x] **Task 5**
  - Result: ✅ `merge_cashback_validation.py` → `cashback_validation` block in `vip-metrics-MY.json`. **VERIFY PASS** — cross-foots (5 tiers), verdicts valid, downside sane, no member-id PII, JSON round-trips. Ready for Lane B "Review" rendering (parent VIP plan Tasks 7–10).
- Depends: Task 3, Task 4

**Files:** Create `bin/vip_report/merge_cashback_validation.py`

**Step 1:** Read both scratchpad JSONs; write a `cashback_validation` block into `vip-metrics-MY.json` = {base_rate, intensive_margin (per tier), within_member, placebo, break_even (per tier), top_diamond_downside, holdout_spec_path}. Keep it code-level (no member IDs).
- Tool: Write, Bash

**Step 2:** Verify — recompute the merged block totals from the source JSONs; sanity (rates in range, incremental-NGR basis correct); structural PII guard (no member-id string leaks). Print PASS/FAIL.
- Tool: Bash

**Verify:** PASS — block present, cross-foots to sources, no PII; `vip-metrics-MY.json` still valid JSON and the VIP build still reads it.

---

→ FINAL: The four analyses + holdout spec are done and merged into `vip-metrics-MY.json`. Next: render them under Lane B "Review" + put the holdout at the top of "Coming soon" when building the VIP panel (parent plan `2026-08-26-vip-decision-report.plan.md`, Tasks 7–10). Fast-follow: reuse this machinery for the big free-credit + net-negative subsidy (the other directional bets).
