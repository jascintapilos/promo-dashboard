# Plan: VIP Decision Report (WS1 · Malaysia · v1)

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** COMPLETED
**Created:** 2026-08-26
**Goal:** A VIP tab in the Promo Report that reads **player-and-tier first** (program-wide portfolio view), then grades every VIP promo in its own of four lanes (A Performance = money · B Win-back = reactivation+forward-margin · D Engagement = habit+break-even · C Entitlement = not-graded), so the RM8.46M program can be reallocated by player, tier, and promo — with the net-negative subsidy named, Diamond rescue judged on real forward margin, and leaky free-credit flagged before scaling.
**Architecture:** Extend the Retention pipeline (`bin/vip_report/*` mirrors `bin/ret_report/*`): reuse the 7d/14d attribution + tier×mechanic comparator + concentration guard + rollups for Lane A; add a per-member annual ledger + GGR-in-window pulls for the program-wide layer and revenue-quality; per-lane thresholds; a THIRD payload (`VIP`) injected into the shared template, rendering a program-wide section above three lane sections. Member-level pulls stay in scratchpad.
**Tech/Tools:** Python `C:/Users/vdiuser/AppData/Local/Python/pythoncore-3.14-64/python.exe` + clickhouse-connect (`csir_config.get_client`; tunnel `.\start_csir_tunnel.ps1` if 8223 not listening); Node googleapis + local OAuth; Artifact tool.
**Design:** projects/promo-value-creation/plans/2026-08-26-vip-decision-report-design.md

## File Map

- Done: `bin/vip_report/pull_tl_vip_codes.mjs` — TL VIP MY universe → `scratchpad/vip/tl-vip-codes-MY.json` (383 codes).
- Create: `bin/vip_report/00_vip_codes.py` — sub-type + **lane** (A/B/C) + mechanic + is_winback taxonomy (regex on code+name; win-back on the CODE) + claim enrichment → `vip-codes-MY.json`.
- Create: `bin/vip_report/01_pull.py` — per (code, member): 7d/14d attribution (dep/ggr/ngr lift), bonus_cost, claims, tier-at-claim, recency-at-claim, redeposit/durability 30/60/90, **GGR-in-7d-window** (coverage + FC dead-money). Member-level → scratchpad.
- Create: `bin/vip_report/01b_ledger.py` — per-member YTD ledger: bonus RM across ALL VIP codes, YTD NGR, YTD GGR, tier-at-start/end, deposit slope (H1 vs H2), VIP-rescue claim count (recidivism). Member-level → scratchpad.
- Create: `bin/vip_report/02_compute_metrics.py` — per-code lane metrics (Lane A reuse Retention; Lane B reactivation+forward-margin+recidivism; Lane C spend/reach/leakage) + revenue quality (GGR-coverage, FC dead-money) + rollups (tier×mechanic×lane) → `vip-metrics-MY.json`.
- Create: `bin/vip_report/02b_program.py` — program-wide: per-player net-margin + net-negative subsidy; tier funding balance/reach/full-cost-margin; whale concentration + value-at-risk; program ROI+payback (ranged); bonus-out fraud watchlist → merged into `vip-metrics-MY.json`.
- Create: `bin/vip_report/03_thresholds.py` — per-lane decisions (A matrix + quality gates; B scale/maintain/cap/stop; C entitlement+leakage) + program-wide verdicts (over/under-funded tiers, subsidy cut-line).
- Create: `bin/vip_report/qc_check.py` — recompute per-code + program-wide, re-derive decisions, ranges, structural PII guard.
- Modify: `templates/acq-dashboard.html` — add `VIP` payload marker; render the VIP panel (program-wide section + 3 lane sections + Coming-soon); de-"soon" the VIP tab; live Summary card.
- Modify: `bin/build_acq_dashboard.mjs` — inject the THIRD payload (VIP).
- Create: `bin/vip_report/write_sheet_tab.mjs` — "VIP (data)" backend tab.
- Scratchpad only (PII): `scratchpad/vip/*`.

---

## Tasks

### Task 1: VIP code universe + lane/sub-type taxonomy

- [x] **Task 1**
  - Result: ✅ `bin/vip_report/00_vip_codes.py` → `vip-codes-MY.json`. 383 codes, RM8,460,186, 132,555 claims. **4 LANES (user upgraded from 3 → pulled check-in into its own Engagement lane):** A-Performance 350c RM4.60M (54%; vip-free-credit RM3.25M + vip-reload RM1.35M) · B-Win-back 7c RM2.14M (25%; all optimove Weekly Rescue, Diamond tier_3e alone RM1.33M) · D-Engagement 19c RM871K (10%; World Cup check-in, 70,734 claims) · C-Entitlement 7c RM845K (10%; birthday RM761K + welcome RM84K). Win-back detected on the CODE — all 7 rescue codes caught, no leak. Design doc synced to 4 lanes.

**Files:** Create `bin/vip_report/00_vip_codes.py`

**Step 1:** Ensure tunnel up. `00_vip_codes.py`: read `tl-vip-codes-MY.json`; classify each code into a **sub-type** (rescue/win-back · vip-free-credit · vip-reload · vip-free-spins · check-in/engagement · birthday/gift · vip-welcome) via regex on code+name (win-back = rescue|optimove|churn|comeback|reactiv|dormant|lapse), a **lane** (rescue→B; birthday/welcome→C; else→A), a **mechanic** (reload/free-credit/free-spins from BonusType), and **is_winback**. Enrich with redeemed claim volume + amount. Emit `vip-codes-MY.json`.
- Tool: Write, Bash

**Step 2:** Print codes-by-lane + by-sub-type (count · claims · spend) + win-back count.
- Expected: Lane A ~64% spend, B ~25% (7 rescue codes), C ~9%; matches the probe.

**Verify:** Every code has a lane + sub-type + mechanic; win-back flag matches the rescue codes; spend splits reconcile with the probe (RM8.46M).

---

→ CHECKPOINT: Confirm the lane assignment + sub-type buckets (mis-laning sends a code to the wrong metric).

---

### Task 2: Pull per-(code,member) attribution + behaviour + GGR-in-window

- [x] **Task 2**
  - Result: ✅ `bin/vip_report/01_pull.py` → `scratchpad/vip/claim-rows-MY.json`. 64,574 (code,member) rows · 7,410 members · bonus_cost RM8,460,187 (reconciles to Task 1) · w7_ggr added · 0 unmatched. **Blended NGR-Lift −RM6.25M** but decomposes cleanly by lane: **A +0.04/RM** (break-even; FC +0.17, reload −0.26 — dead-weight showing) · **B −3.08/RM** (rescue's big upfront bonus tanks 7d NGR → forward-margin is the lens, ring-fence holds — RATIONALE FLIPPED: NGR/RM understates rescue, doesn't inflate it) · **D +0.83/RM** (check-in engagement is POSITIVE — the Engagement-lane split was right) · **C −0.55/RM** (gifts, expected). GGR-coverage: A 21x · D 20x (huge non-incremental house win). Design validated.
- Depends: Task 1

**Files:** Create `bin/vip_report/01_pull.py`

**Step 1:** Mirror `ret_report/01_pull.py` (attribution 7d/14d + behaviour dep-days 7/30/60/90 + tier-at-claim ASOF + recency 120d), scoped to VIP codes, ADD **GGR-in-7d-window** per (code,member) (for GGR-coverage + FC dead-money). Snapshot bound to data max 2026-08-26. Write `scratchpad/vip/claim-rows-MY.json`.
- Tool: Write, Bash

**Step 2:** Print rows, distinct members, redeemed bonus_cost total (≈ RM8.46M scale on redeemed basis), Σ ngr_lift, Σ ggr_window, redeposit count.
- Verify: totals sane; bonus_cost reconciles with Task 1; GGR present.

---

### Task 3: Pull per-member YTD ledger (program-wide grain)

- [x] **Task 3**
  - Result: ✅ `bin/vip_report/01b_ledger.py` → `member-ledger-MY.json`. 7,410 members · Σ bonus RM8.46M (reconciles) · **Σ YTD NGR +RM56.3M** (players are hugely valuable) · Σ YTD GGR RM82.8M. **Net-negative VIPs 1,964 (27%) = RM1.96M subsidy (23% of spend)** · underwater(bonus>GGR) 505 (7%) · **whale top-1% = 34% of +NGR, top-10% = 75%** · rescue recidivists(≥2) 520 = RM4.07M bonus. Fix: tier ASOF needs the inequality vs a LEFT-column → carry as-of date as a column. The +RM56.3M YTD-NGR vs −RM6.25M claim-window lift IS the dead-weight story (valuable players who'd play anyway). Added `01c_rescue_forward.py` need: Lane-B forward 30/60/90d NGR per reactivated (not in claim-rows).
- Depends: Task 1

**Files:** Create `bin/vip_report/01b_ledger.py`

**Step 1:** Per member who claimed any VIP code: YTD bonus RM (Σ across ALL VIP codes), YTD NGR, YTD GGR, tier-at-start (Jan) + tier-at-end (Aug) from the ASOF log, deposit slope (H1 vs H2 deposits), VIP-rescue claim count (Lane B claims). Write `scratchpad/vip/member-ledger-MY.json` (member-level → scratchpad).
- Tool: Write, Bash

**Step 2:** Print distinct members, Σ bonus vs Σ NGR (program net), net-negative member count (NGR < bonus), top-1%/10% NGR share, rescue-recidivist count (≥2 rescues).
- Verify: Σ bonus ≈ VIP spend; net-negative share is a real number; concentration computable.

---

### Task 4: Per-code lane metrics + revenue quality

- [x] **Task 4**
  - Result: ✅ `02_compute_metrics.py` + `01c_rescue_forward.py` → per-code lane metrics. Lane A NGR/RM +0.04 (break-even; tier×mech mostly negative, only Platinum/Diamond FC positive) · Lane B forward-margin +RM15.2M/30d (7d NGR/RM −3.1 is the wrong lens) · Lane D +0.83 (pays for itself, habitual <3%) · Lane C −0.56. **BIG FINDING: "Weekly Rescue" (Lane B) is NOT win-back — 100% of claimers have recency ≤14d, median 1 day → it's a weekly loss-CASHBACK for ACTIVE VIPs.** organic-net=None (no lapsed players). Reframes Lane B → decision at checkpoint.
- Depends: Task 2

**Files:** Create `bin/vip_report/02_compute_metrics.py`

**Step 1:** Per code, lane-appropriate: **Lane A** reuse Retention (NGR Lift per RM, redeposit-uplift vs tier×mechanic norm, durability, cost/retained, top-1 concentration) + **GGR-coverage** (Σ ggr_window ÷ spend) + **FC dead-money** (share of FC RM with ~0 GGR & no deposit); **Lane B** reactivation rate (raw + organic-net via recency), cost per reactivated, forward net-margin per reactivated, recency buckets; **Lane C** spend, recipients, downstream NGR, dormant-gift leakage. Rollups: tier×mechanic×lane grid. Emit `vip-metrics-MY.json`.
- Tool: Write, Bash

**Step 2:** Cross-foot; print per-lane headline + quality flags + top/bottom codes.
- Verify: metrics cross-foot; Lane B NGR-per-RM NOT in the money leaderboard; GGR-coverage sane.

---

### Task 5: Program-wide metrics

- [x] **Task 5**
  - Result: ✅ `02b_program.py` → program block. 7,410 members · bonus RM8.46M · YTD NGR +RM56.3M · **total-value 6.7x but incremental lift −RM6.15M (−0.73/RM)** (marginal RM reduces NGR — dead-weight). **Net-negative VIPs 1,964 (26.5%) → subsidy RM1.96M (23%)**. Whale top-1% = 34% of +NGR (get only 22% of bonus, UNDER-rewarded); top-10% = 75%; value-at-risk 262 whales RM15.3M NGR. Recidivism 520 = 61% of rescued, RM4.07M. **Tier funding: Bronze OVER-funded (index 2.16), Platinum/Diamond UNDER-funded (0.82/0.90) — the value engine (Diamond=40% of NGR) is starved; reallocate UP.** Reach: top tiers ~100%, Bronze 40%. Note: full_cost_margin field double-subtracts bonus (use net_margin=ytd_ngr).
- Depends: Task 3, Task 4

**Files:** Create `bin/vip_report/02b_program.py`

**Step 1:** From the member ledger: per-player net-margin ledger → **net-negative VIP share + subsidy RM** (by tier/mechanic); **tier funding balance** (spend-share vs NGR-share index) + **reach** (% of tier's actives rewarded) + **full-cost tier margin** (does Diamond earn its RM1.33M); **whale concentration** (top-1%/10% players' NGR share + their bonus share) + **value-at-risk** (declining-slope top-decile); **program ROI + payback** (ranged, directional); **bonus-out fraud watchlist** (payout Gini + top-N share + cross-code claim bursts). Merge into `vip-metrics-MY.json`.
- Tool: Write, Bash

**Step 2:** Print net-negative share + subsidy RM, tier funding indices, whale top-1% NGR share, program ROI range, fraud-flag count.
- Expected: a concrete net-negative subsidy figure; tier over/under-funded flags; whale dependency quantified.

**Verify:** program-wide cross-foots to the ledger; ROI reported as a range; no per-member PII in the metrics JSON.

---

→ CHECKPOINT: Review the program-wide layer + per-lane metrics (the numbers that reframe the program) before drafting decisions.

---

### Task 6: Per-lane thresholds + decisions

- [x] **Task 6**
  - Result: ✅ `03_thresholds.py` → per-lane decisions + Lane A size/wagering cut. **Lane A** (big-ticket free-credit is bimodal: RM400+ −0.73/RM vs <RM50 +5.66): Reduce 95 (RM3.39M, shrink big VIP free-credit — loyalty-softened from Stop) · Maintain 35 · Optimise 71 · Scale 76 (RM144K, the small nudges) · Stop 10 (RM57K) · Monitor/Watch 63. **Lane B cashback**: Diamond (RM1.33M, 29% of loss) → **Review** (recovers cost + 100% kept but generous/unproven); other tiers → Keep. **Lane D**: all 19 Keep (pay for themselves). **Lane C**: 7 Entitlement. Money-to-move: net-neg subsidy RM1.96M · Lane-A reduce RM3.39M · cashback-review RM1.33M. 3 moves: cut subsidy · shrink big FC + review Diamond cashback · reallocate tiers up.
- Depends: Task 5

**Files:** Create `bin/vip_report/03_thresholds.py`

**Step 1:** **Lane A** = the Retention matrix (break-even 0, give-floor, scale-hi, single-whale demote, Watch-money) + quality gates (GGR-coverage <1 or high dead-money → cap/flag). **Lane B** = Scale/Maintain/Cap/Stop from reactivation(organic-net) × forward-net-margin; recidivism-heavy → Cap. **Lane C** = Entitlement (+ Leakage flag). **Program-wide** = tier verdicts (over/under-funded) + subsidy cut-line RM. Write decisions + reasons + "Do:" + money-to-move into the JSON.
- Tool: Write, Bash

**Step 2:** Print per-lane decision histograms + money-to-move + tier verdicts.
- Verify: decisions follow the printed rules; Lane B judged on forward-margin not inflated NGR/RM; Lane C never scale/stop.

---

→ CHECKPOINT: Review DRAFT decisions per lane + the program-wide verdicts before wiring the panel.

---

### Task 7: QC the metrics + decisions

- [x] **Task 7**
  - Result: ✅ `qc_check.py` PASS (383 codes recomputed, decisions re-derived, program cross-foots to ledger, structural PII guard). Adversarial agent af1c37d confirmed the per-code + program arithmetic is sound; found cashback-seam defects → **#1 program-ROI ring-fence, #3 Lane-B↔break-even reconcile, #6 landmine field** fixed in 02b/03 + QC updated to mirror the break-even-gated `decide_B`; re-run PASS.
- Depends: Task 6

**Files:** Create `bin/vip_report/qc_check.py`

**Step 1:** Independently recompute per-code + program-wide from raw; re-derive decisions from thresholds; range sanity; structural PII guard (no member-keyed data / string-value leak). Then an adversarial re-verify (agent) of the lane logic + program-wide math.
- Tool: Write, Bash, Agent

**Verify:** PASS — recompute matches, decisions consistent, ranges sane, no PII; adversarial pass finds no confirmed defects.

---

### Task 8: Add the VIP payload + build wiring

- [x] **Task 8**
  - Result: ✅ `const VIP = /*__VIP_PAYLOAD__*/ null;` added; builder injects the 3rd payload + `slimCodes` DROP-list + a `--verify` mode (truncates ACQ/RET codes to fit the pane's snapshot cap). Full build 611KB, ACQ+RET tabs regress-clean (0 console errors).
- Depends: Task 7

**Files:** Modify `templates/acq-dashboard.html`, `bin/build_acq_dashboard.mjs`

**Step 1:** Add `const VIP = /*__VIP_PAYLOAD__*/ null;` next to PAYLOAD/RET. In the builder, read `vip-metrics-MY.json`, add `sym`, inject the THIRD marker.
- Tool: Edit, Bash

**Step 2:** Build; confirm all three payloads injected; ACQ + Retention tabs still render (regression, 0 console errors).

---

### Task 9: Render the VIP panel

- [x] **Task 9**
  - Result: ✅ `renderVIP()` + `vBars`/`vGroupTable`/`VDEC` built the full panel: program-portfolio (fixed-ROI KPIs · funding-balance bars · whale-concentration + value-at-risk · 4 money-moves) → 4-lane tally → per-lane rules → Lane A (size + wagering bars + table) · Lane B (4 cashback tier-cards w/ break-even verdicts + Diamond bracket/downside + validation) · Lane D/C tables → notes → Coming-soon (holdout #1). Verified in-pane via `--verify` build: 0 console errors, no horizontal overflow (fixed `.moves`/`.cbgrid` to auto-fit), all charts/tables render, VIP tab de-"soon"-ed, live Summary card. **Published to the live artifact (b5e60fe2…).**
- Depends: Task 8

**Files:** Modify `templates/acq-dashboard.html` (the `#panel-vip` placeholder → full panel)

**Step 1:** Program-wide section (exec banner · ROI headline · per-player net-margin + net-negative subsidy · tier funding balance/reach/margin heatmap · whale concentration + value-at-risk · fraud watchlist) → **Lane A** (Retention layout + GGR-coverage/dead-money) → **Lane B** (reactivation × forward-margin quadrant + recidivism + recency buckets) → **Lane D Engagement** (habitual-collector share + does-it-pay-for-itself + claim-frequency/active-day lift, "engagement not profit" tag) → **Lane C** (entitlement spend + reach + leakage, "not graded" tag) → **Coming soon**. De-"soon" the VIP tab; live Summary card. Reuse chart/table/collapsible/heatmap helpers; add `renderVIP()` + repaint hook.
- Tool: Edit

**Step 2:** Build + preview; switch to VIP; console clean, all sections render, charts + heatmaps draw, tables grouped, Coming-soon Soon badges, dark mode, no overflow.
- Tool: preview_start/navigate, read_console_messages, javascript_tool

**Verify:** VIP tab renders end-to-end from real metrics; ACQ + Retention unaffected.

---

→ CHECKPOINT: Present the live VIP tab.

---

### Task 10: VIP (data) backend tab + publish

- [x] **Task 10** — publish DONE (VIP tab live at b5e60fe2…). Backend **"VIP (data)" sheet tab DONE (2026-08-27)** — `bin/vip_report/write_sheet_tab.mjs`, **story-first** per user brainstorm: opens with the portfolio Read → 3 big moves → funding balance + whale risk → per-lane verdicts → how-to-read, then the full code table (lanes A/B/C in full + Lane D with mini-games rolled up by program = 95 rows). Answers the 4 priority topics (does VIP pay + subsidy · where's the waste/what to move · budget allocation by tier · whale risk & big bets). Lives in workbook 1I7LLEir… next to Acquisition/Retention (data).
- Depends: Task 9

**Files:** Create `bin/vip_report/write_sheet_tab.mjs`

**Step 1:** Write a "VIP (data)" workbook tab — per-code metrics grouped by lane then decision, colour-coded; a program-wide summary block on top. Read-back verify.
- Tool: Write, Bash

**Step 2:** Republish `outputs/acq-dashboard-MY.html` (same artifact URL) with the VIP tab live.
- Tool: Artifact

**Verify:** Live report's VIP tab works; backend tab matches the JSON.

---

→ FINAL: VIP tab live in the Promo Report + backend "VIP (data)" tab. Next: Whale Detection + Branding pillars; the phase-2 refinements; the Coming-soon data asks (matched control, withdrawals, registration, promo config).
