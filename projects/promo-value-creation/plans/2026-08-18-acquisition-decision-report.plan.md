# Plan: Acquisition Decision Report (WS1 · Malaysia · v1)

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** COMPLETED
**Created:** 2026-08-18
**Goal:** A decision-first HTML dashboard that scores every MY acquisition bonus on the 6-step funnel (purity → conversion → volume → cost-per-FTD → deposit-lift-per-RM → 30-day stick) and gives each a DRAFT scale/maintain/optimise/reduce/stop call, wired to real ClickHouse data.
**Architecture:** Python scripts pull + compute per-code metrics from ClickHouse (reusing the existing 7-day-window attribution machinery); a Node builder injects the resulting JSON into the approved dashboard template; the report publishes as an Artifact with Google Sheets as the optional backend. Member-level rows stay in scratchpad, never git.
**Tech/Tools:** Python `C:/Users/vdiuser/AppData/Local/Python/pythoncore-3.14-64/python.exe` + `clickhouse-connect` (env `~/Downloads/env.env`); Node `googleapis` + local OAuth; the Artifact tool; reuse `bin/pillar_attribution_rebuild.py` for the window/attribution query patterns and `outputs/pvc-csir-probe/` for classification.
**Design:** projects/promo-value-creation/plans/2026-08-18-acquisition-decision-report-design.md

## File Map

- Create: `bin/acq_report/00_acq_codes.py` — build the MY acquisition code list + metadata (code, name, mechanic), universe = **TL-approved Pillar='Acquisition'** pulled from the live All Codes tab (`scratchpad/acq/tl-acq-codes-MY.json`), enriched with GetBonus claim volume.
- Create: `bin/acq_report/01a_first_deposit.py` — per-member first-ever deposit date + amount (MY), from the daily snapshot.
- Create: `bin/acq_report/01b_pull_outcomes.py` — per-claim acquisition outcomes: FTD-in-7d, 7-day-window deposit, 30-day stick, pre-claim history.
- Create: `bin/acq_report/02_compute_metrics.py` — aggregate to per-code metrics + blended KPIs + by-mechanic + monthly trend → `acq-metrics-MY.json`.
- Create: `bin/acq_report/03_draft_thresholds.py` — derive DRAFT cutoffs from the distribution, assign a decision per code.
- Create: `templates/acq-dashboard.html` — the approved reader-friendly dashboard with a data-injection placeholder (from the mockup).
- Create: `bin/build_acq_dashboard.mjs` — inject the metrics JSON + period into the template → `outputs/acq-dashboard-MY.html`.
- Create (optional): `bin/acq_report/write_sheet_tab.mjs` — write an "Acquisition (data)" backend tab to the workbook.
- Scratchpad only (PII, not git): `scratchpad/acq/first-deposit-MY.*`, `scratchpad/acq/claim-outcomes-MY.*`, `scratchpad/acq/acq-metrics-MY.json`.

---

## Tasks

### Task 1: Scaffold pipeline + verify ClickHouse connectivity

- [x] **Task 1**
  - Result: ✅ Dirs created; CSIR tunnel started (cloudflared, cached token — no sign-in). Sanity query: WS1/MYR in-window = 303,702 claim rows / 762 codes / 37,437 members. Confirmed `GetBonus_ABC` has `BonusType`, `BonusName`, `PromotionRemarks` — mechanic sourced directly from claims. Connection pattern (`csir_config.get_client`) reused from `pillar_attribution_rebuild.py`.

**Files:**
- Create: `bin/acq_report/` (dir), `scratchpad/acq/` (dir)

**Step 1:** Create the dirs; open `bin/pillar_attribution_rebuild.py` and copy its ClickHouse connect block (env load + client) as the shared pattern for the pull scripts.
- Tool: Bash (`mkdir -p`), Read

**Step 2:** Run a trivial sanity query — count `WORKSPACE.GetBonus_ABC` rows for MYR in the report window (2026-01-01 → 2026-08-09).
- Tool: Bash (python one-liner)
- Expected: a non-zero count returns without auth error.

**Verify:** ClickHouse responds and the connection pattern is confirmed reusable.

---

### Task 2: Build the MY acquisition code list + metadata

- [x] **Task 2**
  - Result: ✅ Universe basis = **TL-approved assigned pillar 'Acquisition'** (per user), pulled from the live All Codes tab → `scratchpad/acq/tl-acq-codes-MY.json` (node sheet step) → `bin/acq_report/00_acq_codes.py` enriches with GetBonus claim volume. **37 codes** (34 with in-window claims; 5 FreeCredit / 12 DepositBonus / 20 FreeSpinBonus), 20,244 claims. Welcome-dominated; TL keeps the referral codes and the "VIP Exclusive Offer" FS (`FT_PP_*FS`) codes under Acquisition — so earlier drop-flags are overridden by TL. 3 zero-claim codes present (gated later by the evidence floor). Output `scratchpad/acq/acq-codes-MY.json`. Sheet-vs-claims mechanic: 0 mismatches. NOTE: the RM996K figure is ALL-status assigned; final cost (Task 5) uses the redeemed/approved BonusStatus filter.

**Files:**
- Create: `bin/acq_report/00_acq_codes.py`

**Step 1:** Read `outputs/pvc-csir-probe/reclassified.json` (objective framework) + `tl_pillars.json`; select MY codes whose objective/pillar = Acquisition (welcome / first-deposit / no-deposit sign-up). Emit `scratchpad/acq/acq-codes-MY.json` = `[{code, name, mechanic}]`.
- Tool: Write, then Bash (run it)

**Step 2:** Print the count and the full list.
- Expected: a modest list (tens of codes), names look like welcome/first-deposit/CPL offers.

**Verify:** Every listed code is plausibly acquisition; note any doubtful ones for the checkpoint.

---

→ CHECKPOINT: Show the acquisition code list to the user (mis-tag guard — design §5). Confirm the universe before measuring anything.

---

### Task 3: Per-member first-ever deposit map (MY)

- [x] **Task 3**
  - Result: ✅ `bin/acq_report/01a_first_deposit.py` → `scratchpad/acq/first-deposit-MY.json`. 18,034 acquisition claimers: 4,688 ever deposited (2,429 BEFORE window = existing/leakage, **2,227 IN-window = candidate FTDs**, 32 after); **13,346 never deposited** (freebie-hunters). In-window first-deposit median RM70 (p25 50 / p75 150). Cross-foots (2,429+2,227+32+13,346=18,034). Snapshot data max = 2026-08-26 → 7-day windows fully mature; 30-day stick matures for claims ≤ 2026-07-27 (later = censored, gated out of stick).

**Files:**
- Create: `bin/acq_report/01a_first_deposit.py`

**Step 1:** Query the daily snapshot (`Daily_GMT8_Snapshot_A/_BC`, MYR) for the earliest date with deposit > 0 per member, plus that first deposit amount. Write to `scratchpad/acq/first-deposit-MY.parquet` (member-level → scratchpad only).
- Tool: Write, Bash

**Step 2:** Print distinct-member count + a small sample.
- Expected: count in the plausible range for MY depositors; dates within data range.

**Verify:** First-deposit map covers the member base; no null/zero-amount first deposits.

---

### Task 4: Pull per-claim acquisition outcomes (MY)

- [x] **Task 4**
  - Result: ✅ `bin/acq_report/01b_pull_outcomes.py` → `scratchpad/acq/claim-outcomes-MY.json`. 5,007 (code,member) redeemed/active rows. **Redeemed cost RM243,728 ≈ workbook Acquisition RM244,618 (cost basis validated).** FTD-in-7d=1,873, is_new=2,845, had_prior(existing/leakage)=2,162; 7-day window deposit RM3.78M; 4,626/5,007 claims have a mature 30-day window. Funnel built on the redeemed/active base (consistent with the redeemed cost); window deposit attributed whole to the code (decay/split deferred). Merged first-deposit map for ftd_in_7d + is_new + mature_30 flags.

**Files:**
- Create: `bin/acq_report/01b_pull_outcomes.py`

**Step 1:** For each claim of an acquisition code (GetBonus, MYR, in window): pull member, claim datetime, bonus_cost, bonus_type. Join the first-deposit map → **FTD-in-7d flag** (first-ever deposit within [claim, claim+7d]) + first-deposit amount. Reuse the 7-day-window logic from `pillar_attribution_rebuild.py` for **window deposit**. Add **30-day stick** (any deposit / active day in [FTD, FTD+30d]) and **pre-claim deposit exists?** (for purity). Write `scratchpad/acq/claim-outcomes-MY.parquet`.
- Tool: Write, Bash

**Step 2:** Print totals: claims, distinct claimers, FTDs-in-7d, total bonus_cost.
- Expected: totals are internally consistent; total bonus_cost ≈ the known MY acquisition spend from the workbook.

**Verify:** Claim-outcome rows tie to the code list; FTD count ≤ claimers; bonus_cost cross-checks against the existing acquisition-pillar spend.

---

### Task 5: Compute per-code metrics + KPIs + cuts

- [x] **Task 5**
  - Result: ✅ `bin/acq_report/02_compute_metrics.py` → `scratchpad/acq/acq-metrics-MY.json`. 34 codes; blended cost/FTD RM130, conversion 37.4%, 30-day stick 44.4%. Cross-foot OK; ranges valid. By mechanic: FreeSpins RM45/FTD (cheapest, stick 36%), DepositBonus RM142/FTD (stick 50%), FreeCredit RM634/FTD (dear — mass FC50 converts 9% — but stick 58%). **BUG FOUND + FIXED:** 2-arg `countIf` was invalid → stick=100% everywhere; switched to `sum(if(...))`, re-pulled, stick now 31–60%. Note: purity==conversion for deposit bonuses is expected (new claimer's trigger deposit IS the FTD). Base = redeemed/active claimers (consistent with the redeemed cost).

**Files:**
- Create: `bin/acq_report/02_compute_metrics.py`

**Step 1:** Aggregate claim-outcomes to **per code**: new-player purity, claim→FTD conversion %, FTD volume, cost-per-FTD, deposit-lift-per-RM (window deposit ÷ bonus cost), 30-day stick %, first-deposit median, evidence-gate n (claimers), concurrent-overlap flag, NGR (context). Also compute blended KPIs, by-mechanic rollup, and monthly FTD trend. Emit `scratchpad/acq/acq-metrics-MY.json`.
- Tool: Write, Bash

**Step 2:** Cross-foot: Σ per-code FTDs = total FTDs; Σ spend = total; every rate in [0,100]; cost-per-FTD > 0.
- Expected: all cross-foot checks pass.

**Verify:** The metrics JSON cross-foots to the raw pull and every value is in a sane range.

---

### Task 6: Draft decision thresholds + assign decisions

- [x] **Task 6**
  - Result: ✅ `bin/acq_report/03_draft_thresholds.py` → DRAFT thresholds (floor 20 claimers; cost/FTD p25=41/p50=66/p75=280; stick median 45%) written into acq-metrics-MY.json. Decisions: Scale 2 / Maintain 3 / Optimise 6 / Reduce 1 / Stop 2 / Low-volume 20. Material spend fully covered (low-volume codes = only RM9.9K total). TWO items surfaced at checkpoint: (a) 20/34 gated as low-volume — floor tuning question; (b) referral codes wrongly land in Stop (their success = the *referee's* deposit, not the code's own FTD — need referral-specific handling). Awaiting user sign-off on thresholds before wiring the dashboard.

**Files:**
- Create: `bin/acq_report/03_draft_thresholds.py`

**Step 1:** Derive DRAFT cutoffs from the data distribution (e.g., cost-per-FTD quartiles, stick-rate median, an evidence floor for min claimers). Assign Scale/Maintain/Optimise/Reduce/Stop per code by the design §7 rules. Write cutoffs + per-code decision back into `acq-metrics-MY.json`, tagged `"thresholds_status":"DRAFT"`.
- Tool: Write, Bash

**Step 2:** Print the cutoffs and the decision histogram.
- Expected: a spread across buckets (not all one action); codes below the evidence floor flagged "insufficient volume", not decided.

**Verify:** Decisions follow the printed cutoffs deterministically; thin-volume codes are gated, not judged.

---

→ CHECKPOINT: Review the DRAFT thresholds + resulting decisions with the user before wiring the dashboard. (These are what YG/WY will sign off.)

---

### Task 7: Turn the mockup into a data-driven template

- [x] **Task 7**
  - Result: ✅ `templates/acq-dashboard.html` — mockup turned data-driven (`/*__ACQ_PAYLOAD__*/` injection), added Referral + Low-volume decision colours, a "How decisions are made" panel that DEFINES the thresholds + all 7 verdicts in plain terms, n/a handling, and referral/low-volume note in "The call".
- Depends: none (parallel-safe)

**Files:**
- Create: `templates/acq-dashboard.html`
- Source: `scratchpad/acq-dashboard-mockup.html` (approved format)

**Step 1:** Copy the approved mockup. Replace the hardcoded `DATA`, `TREND`, KPI, and period/meta values with a single injection placeholder `/*__ACQ_PAYLOAD__*/` that a build step fills with `{codes, kpis, byMechanic, trend, period, thresholds}`. Keep ALL styling, fonts, charts, and "The call" logic unchanged.
- Tool: Read, Write, Edit

**Step 2:** Confirm the template has the placeholder and no inline illustrative data.
- Expected: `grep` finds `__ACQ_PAYLOAD__` and finds no leftover mock codes.

**Verify:** Template is data-agnostic; the reader-friendly type + layout are intact.

---

### Task 8: Build the dashboard from real metrics

- [x] **Task 8**
  - Result: ✅ `bin/build_acq_dashboard.mjs` → `outputs/acq-dashboard-MY.html` (43.7KB, 34 codes). Verified live: no console errors, real KPIs (RM243,727 / 1,873 FTD / RM130 per FTD / 44.4% stick), charts render, rule panel + 34-row table populated. Fixed a double-render bug (stored-theme init painted twice).
- Depends: Task 6, Task 7

**Files:**
- Create: `bin/build_acq_dashboard.mjs`

**Step 1:** Read `acq-metrics-MY.json` + period meta → inject into `templates/acq-dashboard.html` → write `outputs/acq-dashboard-MY.html`. Set the meta bar (real period + "data as of"), keep the mockup banner OFF for the real build (or set a "DRAFT thresholds" note instead).
- Tool: Write, Bash

**Step 2:** Preview live (copy to project, `serve`, navigate) — check console has no errors, all charts render, "The call" and KPIs compute from real numbers.
- Tool: Bash (copy), preview_start, navigate, read_console_messages, javascript_tool
- Expected: zero console errors; row count = number of acquisition codes.

**Verify:** The real-data dashboard renders correctly and the on-page totals match `acq-metrics-MY.json`.

---

### Task 9: QC the report (adversarial)

- [x] **Task 9**
  - Result: ✅ `bin/acq_report/qc_check.py` PASS — 34 codes recompute exactly from raw claim-outcomes, all 34 decisions follow the DRAFT thresholds, ranges sane, KPI cross-foot OK, and PII scan over 3,659 member ids found NONE in the HTML.
- Depends: Task 8

**Files:** none (verification only)

**Step 1:** Run an adversarial QC (Workflow) over the built report vs the source JSON: cross-foot KPIs and by-mechanic; sanity (rates ≤ 100, cost > 0, FTD ≤ claimers); confirm the honesty caveats are present; confirm each decision matches the printed thresholds; check no member-level PII leaked into the HTML.
- Tool: Workflow

**Step 2:** Fix anything the QC confirms; re-verify.
- Expected: QC returns clean (or fixed).

**Verify:** Numbers tie out, decisions are consistent with thresholds, and no PII is embedded.

---

→ CHECKPOINT: Present the real-data acquisition dashboard to the user.

---

### Task 10: Publish + optional backend tab

- [x] **Task 10**
  - Result: ✅ Published live report as a NEW Artifact https://claude.ai/code/artifact/b5e60fe2-bef0-4c29-ab19-1261c25fd619 (mockup URL kept separate). Backend "Acquisition (data)" tab written to the workbook via `bin/acq_report/write_sheet_tab.mjs` — 34 codes grouped by decision, colour-coded, with KPI + rule header. Final tabs incl. "Acquisition (data)".
- Depends: Task 9

**Files:**
- Create (optional): `bin/acq_report/write_sheet_tab.mjs`

**Step 1:** Publish `outputs/acq-dashboard-MY.html` as an Artifact (new URL — the mockup URL stays the mockup). Note it in the design doc.
- Tool: Artifact

**Step 2 (optional):** Write an "Acquisition (data)" tab to the workbook holding the per-code metric table as the human-readable backend.
- Tool: Write, Bash (node)
- Expected: the tab matches `acq-metrics-MY.json`.

**Verify:** The live link works and (if built) the backend tab matches the JSON to the row.

---

### Task 11: Sign-off gate (YG / WY)

- [x] **Task 11**
  - Result: ✅ Sign-off one-pager `projects/promo-value-creation/plans/acq-signoff-request.md` — objective, KPI set, the two windows, and DRAFT cut-offs for YG/WY to approve, with links + honest limits. Handed to user to send (not sent on their behalf). Report stays DRAFT until approved.
- Depends: Task 10

**Files:**
- Create: `projects/promo-value-creation/plans/acq-signoff-request.md` — the one-page ask: the KPI + window + threshold definitions for YG/WY to approve, with the DRAFT cutoffs and the honesty caveats.

**Step 1:** Draft the sign-off one-pager (objective → KPI → window → decision rule), referencing the live dashboard. The report stays labelled DRAFT until approved.
- Tool: Write

**Step 2:** Hand it to the user to send to YG/WY (do not send on their behalf without approval).
- Expected: a ready-to-send sign-off request.

**Verify:** The blocking gate from design §12 is captured; nothing is presented as final before sign-off.

---

→ FINAL: The dashboard link, the metrics JSON, and the sign-off one-pager are the deliverables. Retention/reactivation/VIP and the control group are the next plan, reusing this same engine.
