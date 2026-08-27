# Plan: Executive-Synthesis Layer (Summary tab overhaul)

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** COMPLETED
**Created:** 2026-08-27
**Goal:** Turn the thin Summary tab (pillar cards only) into a real CEO/stakeholder page that synthesises across pillars — so a leader can see, in one screen, what we spend, what it honestly buys, where the waste is, the top decisions, and how much to trust it.
**Architecture:** Pure client-side render over the THREE payloads already injected into the template (`PAYLOAD`/ACQ, `RET`, `VIP`). NO new data pulls, NO pipeline changes — a new `renderSummary()` computes the four artifacts from the payloads. Respects the ROI steer: each pillar shows its own objective-fit value metric (no forced common ROI); VIP keeps the fixed ex-cashback incremental.
**Tech/Tools:** Edit `templates/acq-dashboard.html` only; rebuild with `node bin/build_acq_dashboard.mjs [--verify]`; verify in the browser pane (`--verify` build fits the snapshot cap); republish the full file to the live artifact (b5e60fe2…).
**Design:** direct plan (brainstorm approved in-chat 2026-08-27 — the 4 "add-now" set; trend + LTV/journey/targets/leakage/SG = coming-soon).

## File Map

- Modify: `templates/acq-dashboard.html` — replace the Summary panel body (`#panel-summary`) with a structured exec layout; add `renderSummary()` + helpers; keep the pillar-card nav.

---

## Tasks

### Task 1: Cross-pillar rollup + Portfolio table (spend → honest value)

- [x] **Task 1**
  - Result: ✅ Portfolio table (Acq/Ret/VIP + total) — spend RM12.43M, each pillar on its own yardstick, total money-to-move RM4.42M; exec banner above.

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** Add a `pillarRollup()` helper that reads PAYLOAD/RET/VIP and returns per built pillar `{name, spend, valueLabel, valueMetric, moneyToMove, calls:{scale,trim,...}, goto}` — Acquisition value = FTDs + cost/FTD (objective-fit, NOT NGR); Retention value = +NGR Lift (net) + NGR/RM; VIP value = incremental ex-cashback + total-value context. Total row sums spend + money-to-move across the 3 pillars (distinct code sets → no double count; label "3 of 6 pillars analysed").
- Tool: Edit

**Step 2:** Render a **Portfolio table** at the top of Summary: Pillar | Spend (+share) | What it buys (objective-fit) | Money to move | Top calls | → open. Plus a total row and a one-line exec thesis banner above it.
- Tool: Edit

**Verify:** Summary shows a 3-row (+total) portfolio table; spends/shares/money-to-move match each pillar tab's own numbers; no forced common ROI.

---

### Task 2: Consolidated action ledger (ranked cross-pillar moves)

- [x] **Task 2**
  - Result: ✅ Cross-pillar action ledger — top 14 of all actionable moves ranked by RM, pillar-tagged + colour-coded, click-through to pillar.
- Depends: Task 1

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** Build a ranked table of the biggest actionable moves across all pillars: pull each pillar's non-hold decisions (Stop/Reduce/Trim/Optimise/Scale/Review), tag with pillar, sort by spend (RM impact) desc, take top ~12–15. Columns: Promo (+pillar chip) | Spend | Call | What to do. Colour by decision (reuse DEC/RDEC/VDEC colour logic).
- Tool: Edit

**Verify:** Ledger lists the top moves with pillar tags, ranked by RM; each row's decision colour matches its pillar tab.

---

### Task 3: Spend-efficiency frontier (where the marginal RM stops paying)

- [x] **Task 3**
  - Result: ✅ Spend-efficiency frontier — 675 money-is-judge codes: peak +RM10.3M NGR at RM3.9M spent, shaded reallocatable tail RM4.5M (gives back RM5.5M).
- Depends: Task 1

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** For the "money-is-judge" codes (Retention + VIP Lane A, which have NGR/RM), sort by NGR/RM desc and plot a cumulative curve: x = cumulative spend, y = cumulative incremental NGR. Mark the peak (where marginal RM turns negative) and shade the losing tail — the "reallocatable" spend. SVG on the shared 480×300 canvas; tooltip the crossover.
- Tool: Edit

**Verify:** Curve rises then rolls over; the peak + shaded tail render; the tail RM ≈ the sum of negative-NGR/RM spend in RET+VIP-A.

---

### Task 4: Confidence & coverage panel (what we can/can't yet prove)

- [x] **Task 4**
  - Result: ✅ Confidence panel — 98% graded-on-matured coverage bar + Verified/Directional/Unproven rows (honest, no over-claim).
- Depends: Task 1

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** A coverage bar + notes: % of analysed spend that is measured (matured window) vs directional; which reads are proven vs need a matched control/holdout; the honest caveats (own-baseline not causal, cashback observational, whale-churn downside). Keep it short and plain.
- Tool: Edit

**Verify:** Panel states coverage honestly and matches the per-pillar caveats; no over-claiming.

---

### Task 5: Wire `renderSummary()` + verify + republish

- [x] **Task 5**
  - Result: ✅ renderSummary() wired into #panel-summary (banner→portfolio→frontier+confidence→ledger→pillar-card nav); 0 console errors, no overflow, published to live artifact b5e60fe2.
- Depends: Task 1, Task 2, Task 3, Task 4

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** Replace the `#panel-summary` body with the exec sections (banner → portfolio table → action ledger → efficiency frontier → confidence → pillar-card nav at the bottom). Call `renderSummary()`; keep the existing `data-goto` card nav working.
- Tool: Edit

**Step 2:** Build `--verify`, open the pane, land on Summary: 0 console errors, no horizontal overflow, all sections render, dark mode ok. Then build full + republish to the live artifact.
- Tool: Bash, browser tools, Artifact

**Verify:** Summary tab is a real exec page; Acq/Retention/VIP tabs unaffected; live artifact updated.

---

→ FINAL: Executive Summary live in the Promo Report. Coming-soon (flagged): month-over-month trend, LTV/cohort payback, player-journey funnel, targets/benchmarks, abuse/leakage, MY↔SG. Fast-follow: VIP (data) backend sheet tab.
