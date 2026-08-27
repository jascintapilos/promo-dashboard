# Plan: Retention Decision Report (WS1 · Malaysia · v1)

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** COMPLETED
**Created:** 2026-08-26
**Goal:** A Retention tab in the Promo Report that scores every MY retention code on NGR Lift per RM (+ redeposit-uplift, durability, win-back, by-tier, by-mechanic) and gives each a scale/maintain/optimise/reduce/stop call — concentrating the budget on what actually adds money.
**Architecture:** Mirror the acquisition pipeline (`bin/ret_report/*`): pull per-(code,member) attribution + behaviour from ClickHouse, aggregate to per-code retention metrics, draft thresholds, then inject a SECOND payload (`RET`) into the shared template and render the retention panel (which is currently a placeholder). Member-level pulls stay in scratchpad. Reuses the 7-day-window/14-day-baseline attribution from `bin/pillar_attribution_rebuild.py`.
**Tech/Tools:** Python `C:/Users/vdiuser/AppData/Local/Python/pythoncore-3.14-64/python.exe` + clickhouse-connect (`csir_config.get_client`; start tunnel `.\start_csir_tunnel.ps1` if 8223 not listening); Node googleapis + local OAuth; Artifact tool.
**Design:** projects/promo-value-creation/plans/2026-08-26-retention-decision-report-design.md

## File Map

- Create: `bin/ret_report/00_ret_codes.py` — MY retention code universe (TL Pillar='Retention') + mechanic taxonomy (reload/cashback/free-credit/win-back/other) from BonusName/BonusType.
- Create: `bin/ret_report/01_pull.py` — per (code, member): NGR/GGR/deposit lift (7d vs 14d, reuse attribution), bonus_cost, claims; tier-at-claim; recency-at-claim (days since last deposit before claim); redeposit-in-30d; durability (active/deposited at 30/60/90d); dep-days.
- Create: `bin/ret_report/02_compute_metrics.py` — per-code retention metrics + tier & mechanic rollups + mechanic×tier grid + win-back buckets + durability + flags + KPIs + money-to-move → `scratchpad/ret/ret-metrics-MY.json`.
- Create: `bin/ret_report/03_thresholds.py` — decision matrix (NGR Lift per RM × redeposit-uplift) + give-to-take floor + volume floor→"monitor" + win-back "pending control" guardrail → decisions.
- Create: `bin/ret_report/qc_check.py` — recompute cross-foot + range sanity + PII scan.
- Modify: `templates/acq-dashboard.html` — add `RET` payload marker; render the Retention panel (KPIs, call+money-to-move, decision rules+matrix, 4 charts incl by-tier + mechanic×tier, grouped/collapsible table, notes) + a "Coming soon" section tagged **Soon**.
- Modify: `bin/build_acq_dashboard.mjs` — inject BOTH payloads (acquisition + retention).
- Create: `bin/ret_report/write_sheet_tab.mjs` — "Retention (data)" backend tab.
- Scratchpad only (PII): `scratchpad/ret/*` (pulls, metrics).

---

## Tasks

### Task 1: Retention code universe + mechanic taxonomy

- [x] **Task 1**
  - Result: ✅ Tunnel restarted; `bin/ret_report/00_ret_codes.py` → `scratchpad/ret/ret-codes-MY.json`. **325 TL-Retention codes** (all with claims), 142,845 claims, RM5.69M raw. Mechanic split: **reload 138** (RM3.04M) · **free-credit 68** (RM1.94M) · **free-spins 117** (RM714K) · **win-back 2** (RM383) · cashback 0. **KEY FINDING (as predicted): win-back is near-empty in TL-Retention** — the big rescue/optimove codes are classified VIP under TL, so TL-Retention has only 2 tiny "Comeback Reload" codes (4 claims). Win-back lens will be near-empty here; the recency-at-claim cut still applies to all codes (are we paying active players who'd deposit anyway).

**Files:** Create `bin/ret_report/00_ret_codes.py`, dir `scratchpad/ret/`

**Step 1:** Ensure tunnel up (`start_csir_tunnel.ps1` if 8223 not listening). Pull TL-approved Pillar='Retention', MY from the live All Codes tab (node) → `scratchpad/ret/tl-ret-codes-MY.json` (mirror acquisition's sheet pull). Then `00_ret_codes.py`: join names + classify each into a **mechanic** (reload / cashback / free-credit / free-spins / win-back / other) from BonusName+BonusType keywords; enrich with GetBonus claim volume. Emit `scratchpad/ret/ret-codes-MY.json` = [{code,name,mechanic,is_winback,claims,bonus_amt}].
- Tool: Bash (node sheet pull + python)

**Step 2:** Print code count by mechanic + win-back count + total claims.
- Expected: ~325 codes, sensible mechanic split, a win-back subset identified.

**Verify:** Every code has a mechanic; win-back flag matches obvious win-back/rescue names; count near ~325.

---

→ CHECKPOINT: Show the mechanic taxonomy + win-back tag split. Confirm the buckets before measuring (mis-bucketing skews the whole by-mechanic story).

---

### Task 2: Pull per-(code,member) attribution (retention)

- [x] **Task 2**
  - Result: ✅ `bin/ret_report/01_pull.py` → `scratchpad/ret/claim-rows-MY.json`. 3 queries (attribution / behaviour+tier / recency), merged at (code,member). **42,766 rows · 10,137 members**. Redeemed/active bonus_cost **RM3,801,232** (of RM5.69M gross = 67% redeemed). **Σ NGR Lift +RM4,705,061** (net positive ✓, ≈ expected +RM4.5M scale). Σ deposit-lift +RM12.1M. **Redeposit-in-30d 79.0%** (near-universal → confirms NGR Lift must lead, not redeposit). **90.3% deposited in prior 120d** (the pay-the-already-active trap is real → recency cut earns its place). 0 behaviour rows without an attribution match (clean alignment). Fix: recency range-join moved from ON→WHERE (ClickHouse rejects mixed-condition JOIN). Tier-at-claim ASOF from `dedup_PlayerMembershipLog_A` (WS1_MYS_MYR); heavy "(Trial)" suffixes + Unknown(14%) to be normalised in 02 (Silver(Trial)→Silver, Unknown→Classic).
- Depends: Task 1

**Files:** Create `bin/ret_report/01_pull.py`

**Step 1:** Reuse the `pillar_attribution_rebuild.py` SQL, scoped to the retention codes, output at (BonusCode, MEMBER_ID) grain: bonus_cost, claims, t1_dep, dep_lift, ggr_lift, ngr_lift (7d window vs 14d baseline). Add tier-at-claim (membership log ASOF). Add per (code,member): min claim_date; recency = days since the member's last deposit BEFORE claim; redeposit-in-30d flag; active/deposited at 30/60/90d (durability); dep_days. Snapshot bound to data max (2026-08-26); note maturity cutoffs (7d to ~20 Aug, 30d stick to 28 Jul, 90d only for older cohorts). Write `scratchpad/ret/claim-rows-MY.parquet|json` (member-level → scratchpad only).
- Tool: Write, Bash

**Step 2:** Print totals: rows, distinct members, redeemed bonus_cost total, Σ ngr_lift (should be net POSITIVE for MY retention), redeposit count.
- Expected: bonus_cost cross-checks vs the workbook's Retention spend; Σ ngr_lift ≈ the known +RM4.5M-scale positive.

**Verify:** Totals sane and internally consistent; NGR Lift net positive (retention makes money).

---

### Task 3: Compute per-code retention metrics + cuts

- [x] **Task 3**
  - Result: ✅ `bin/ret_report/02_compute_metrics.py` → `scratchpad/ret/ret-metrics-MY.json`. 325 codes, cross-foot OK. Blended: RM3.80M spend · **+RM4.71M NGR Lift · NGR Lift/RM 1.24** · redeposit 78.2% · cost/retained RM111. **By mechanic:** reload 1.9 (60% budget, the engine) · free-spins 1.2 · **free-credit −0.66 (loses money, 21% budget)** · win-back 13.51 but RM147 (ring-fenced, immaterial). **By tier:** rises with value — Diamond 1.75 › Platinum 1.43 › Gold 1.13 › Silver 1.05 › Bronze 0.53. **By recency (key):** 79% of budget → already-active 0–14d players (NGR/RM 1.55, profitable); lapsed 60d+ loses money (−0.42). **Money-losing pool: 123 codes / RM959K = 25% of budget** (43 free-credit = RM626K). 42 codes too new (RM350K → monitor). Top 10 codes = 55% of budget. Redeposit-uplift + tier-normal working (e.g. FT_LV_38 −21.8pp). Win-back NOT dominating headline ✓.
- Depends: Task 2

**Files:** Create `bin/ret_report/02_compute_metrics.py`

**Step 1:** Aggregate to per code: **NGR Lift per RM** (ngr_lift ÷ bonus_cost) [headline], NGR Lift total, redeposit rate, **redeposit-uplift** (code redeposit rate − that code's tier-weighted normal 30-day redeposit rate), cost per retained, players retained, durability survival (30/60/90), payback restatement. For **win-back** codes: recency-bucket the members, compute reactivation rate + cost per reactivated. Rollups: by-mechanic, by-tier, **mechanic×tier grid** (NGR Lift per RM). Flags: over-rewarding-by-tier, segment-target purity. KPIs (retention spend, NGR Lift RM, NGR Lift per RM, redeposit-uplift). **Money-to-move** = Σ spend on (to-be) reduce/stop. Emit `scratchpad/ret/ret-metrics-MY.json`.
- Tool: Write, Bash

**Step 2:** Cross-foot (Σ per-code = totals); ranges sane; print top/bottom codes by NGR Lift per RM + the mechanic and tier tables.
- Expected: coherent story (some codes strongly +, some ~0/negative; win-back handled via its own lens).

**Verify:** Metrics cross-foot; win-back codes NOT dominating the headline via inflated lift.

---

→ CHECKPOINT: Review the metrics — mechanic table, tier table, win-back lens, money-to-move. Confirm before drafting decisions.

---

### Task 4: Draft thresholds + decisions

- [x] **Task 4**
  - Result: ✅ `bin/ret_report/03_thresholds.py` → decisions written into `ret-metrics-MY.json`. Thresholds (draft from distribution): VOL_FLOOR=15 matured · GIVE_FLOOR=RM0.50/RM · SCALE_HI=RM2.00/RM · incr=uplift>0. Matrix (money × uplift) after Monitor/Hold gates. **Spread:** Scale 34 (RM1.46M, 39%) · Maintain 29 (RM484K) · Optimise 30 (RM513K) · Reduce 25 (RM495K) · Stop 37 (RM401K) · Monitor 168 (RM444K, mostly thin/new — only 12% of budget) · Hold 2 (win-back). **Money-to-move: RM896K** (Stop+Reduce) → redeploy into Scale (RM1.46M today); +RM513K Optimise reclaimable by right-sizing. Spot-checks correct: big reloads→Scale; over-generous 888MX (RM4,287/retained)→Optimise+flag; free-credit LV/MV/HV→Stop/Reduce; too-new check-ins→Monitor. 5 codes carry off-target/over-generous flags. Decisions cover 88% of budget.
- Depends: Task 3

**Files:** Create `bin/ret_report/03_thresholds.py`

**Step 1:** Draft cutoffs from the distribution: NGR-Lift-per-RM bands (makes/loses money, break-even 0 + a give-to-take stop-floor ~RM1), redeposit-uplift median (above/below tier-normal), volume floor→"monitor". Assign the matrix verdict (Scale/Maintain/Optimise/Reduce/Stop); win-back codes → judged on their lens + tagged "pending control" (held, not auto-scaled). Write thresholds + per-code decision + reason (+ "Do:" action) into `ret-metrics-MY.json`.
- Tool: Write, Bash

**Step 2:** Print thresholds + decision histogram + spend-by-decision + money-to-move.
- Expected: a spread across buckets; thin codes → monitor; win-back ring-fenced.

**Verify:** Decisions follow the printed rule; give-to-take floor and volume floor applied; win-back held.

---

→ CHECKPOINT: Review DRAFT thresholds + decisions (what YG/WY sign off) before wiring the panel.

---

### Task 5: QC the metrics

- [x] **Task 5** — deterministic QC PASS + adversarial remediation COMPLETE + independently re-verified (all 5 fixes real, recompute exact, 0 regressions); single-whale hard-demote (>50%) added. Break-even verified NET. Final spread: Scale 12 · Maintain 34 · Optimise 40 · Reduce 16 · Stop 33 · Watch-money 23 · Monitor 111 · Hold 56. money-to-move RM867K.
  - Result (part 1): ✅ `bin/ret_report/qc_check.py` **PASS** — recompute + decisions + PII all clean (PII scan fixed: whole-token + hex-colour).
  - Result (part 2 — adversarial 5-lens workflow, 16 findings): fixing before Task 6. **Break-even convention VERIFIED**: empirically confirmed Snapshot.NGR is NET of the promo bonus (corr(bonus, GGR−NGR)=0.79; GGR−NGR≈bonus+RM14 other) → break-even=0 is correct, thresholds stand, finding #6 (ROI-100% recalibration) REFUTED; +RM4.7M is genuine net-of-bonus profit (no double-subtract). **Fixes being applied:** (1 CRIT) win-back detect on CODE not just name — 54 churn/comeback/optimove codes (RM85,438) leaked into matrix, incl a Scale → route to Hold [00]; (2 CRIT) redeposit-uplift mechanic-confounded → stratify tier_normal by (tier×mechanic) [02]; (3 HIGH) single-member NGR concentration drives Scale → add top-1-member guard + ex-top1 recompute, demote one-whale Scales [02/03]; (4 HIGH) Monitor gate keyed on matured_30 not matured_7 → split gate, add "Watch-money" provisional for mature-money/immature-redeposit codes (surfaces RM338K) [03]; (MED) Unknown tier folded into real Classic → separate "Unknown" bucket [02]; recency "lapsed/none" conflates true-new + 120d-lapsed → rename [02]; (LOW) incr dead-band ±1pp, Optimise reason branch on uplift sign, mech_tier_grid n<30 suppress, NGR gate on mature_7, PII floor len≥2, 00 status filter. by_tier Simpson's-paradox (mechanic mix) → panel narrative leads with mech_tier_grid + caveat.
- Depends: Task 4

**Files:** Create `bin/ret_report/qc_check.py`

**Step 1:** Recompute per-code metrics from raw claim-rows and compare to `ret-metrics-MY.json`; re-derive decisions from thresholds; range sanity; KPI cross-foot.
- Tool: Write, Bash

**Verify:** PASS — recompute matches, decisions consistent, ranges sane.

---

### Task 6: Add the RET payload + build wiring

- [x] **Task 6**
  - Result: ✅ Added `const RET = /*__RET_PAYLOAD__*/ null;` to template; `build_acq_dashboard.mjs` now injects BOTH payloads (ACQ 34 + RET 325, NGR-Lift/RM 1.25, money-to-move RM867K). Build clean, 0 markers remain, acquisition tab still renders (0 console errors — regression check passed).
- Depends: Task 5

**Files:** Modify `templates/acq-dashboard.html`, `bin/build_acq_dashboard.mjs`

**Step 1:** In the template, add `const RET = /*__RET_PAYLOAD__*/ null;` next to the acquisition PAYLOAD (acquisition rendering unchanged). In `build_acq_dashboard.mjs`, read `ret-metrics-MY.json`, add `sym`, and replace BOTH markers (acquisition + retention).
- Tool: Edit, Bash

**Step 2:** Build; confirm both payloads injected (RET not null).
- Verify: build succeeds; `grep` shows RET payload present; acquisition tab still renders (regression check).

---

### Task 7: Render the Retention panel

- [x] **Task 7**
  - Result: ✅ Retention panel built + rendering end-to-end (0 console errors). Meta · **exec banner "money is the judge"** · call (+RM4.63M, RM1.25/RM, RM867K to move) · tally (12/34/40/16/33) · KPIs · Decision rules (thresholds + 8 verdicts + NGR×uplift matrix) · **4 charts** (NGR-Lift/RM bars, money×retention quadrant, by-tier bars, **mech×tier heatmap = budget-steering map** showing reload green everywhere / free-credit red = Simpson's-paradox proof) · **grouped collapsible table** (8 groups, Scale/Reduce/Stop/Watch-money open, big groups collapsed, ~79px rows) · Notes · **Coming-soon (5 Soon badges)**. Retention tab badge de-"soon"ed; Summary grid has a live Retention card. Dark mode adapts (paint() repaints charts). Fixes during build: chart value-labels moved to open side of zero (no collision), grouped-table min-width (223px→79px rows), pillar-neutral footer.
- Depends: Task 6

**Files:** Modify `templates/acq-dashboard.html` (the `#panel-retention` placeholder → full panel)

**Step 1:** Replace the retention placeholder with the panel: meta bar, **The call** (with money-to-move line), KPIs, **Decision rules** (thresholds + verdicts&actions + NGR×redeposit-uplift matrix), 4 charts (**NGR Lift per RM by code · money×retention quadrant · by-tier · bonus-type×tier grid**), grouped+collapsible decision table (tier-context col, win-back tag), Notes, and the **"Coming soon"** section (withdrawals/abuse · wagering · tenure/registration · promo config · matched control) each with a **Soon** badge. Add a JS `renderRetention()` reading `RET`, reusing the chart/table/collapsible helpers. Exec banner: "money IS the judge here".
- Tool: Edit

**Step 2:** Build + preview live; switch to Retention tab; check console clean, charts render, table grouped, matrix shows, Coming-soon Soon badges present, cards collapsible, no overflow.
- Tool: preview_start, navigate, read_console_messages, javascript_tool
- Expected: zero console errors; Retention panel populated from real data.

**Verify:** Retention tab renders end-to-end from real metrics; acquisition tab unaffected.

---

→ CHECKPOINT: Present the live Retention tab.

---

### Task 8: Retention (data) backend tab + publish

- [x] **Task 8**
  - Result: ✅ `bin/ret_report/write_sheet_tab.mjs` → **"Retention (data)"** tab written (325 codes, 333 rows, grouped by decision + 8-colour-coded, frozen header, RM/±/% number formats). Read-back verified: header + rows correct (FT_PAYDAY_30PCT: 974 players · RM653,751 NGR Lift · RM3.24/RM · +3.2pp · RM212/retained · 0% one-player). Live report republished (both tabs) at the same artifact URL.
- Depends: Task 7

**Files:** Create `bin/ret_report/write_sheet_tab.mjs`

**Step 1:** Write a "Retention (data)" workbook tab (per-code metrics grouped by decision, colour-coded) — mirror the acquisition tab writer.
- Tool: Write, Bash

**Step 2:** Republish `outputs/acq-dashboard-MY.html` (same Artifact URL) with the Retention tab live.
- Tool: Artifact

**Verify:** Live report's Retention tab works; backend tab matches the JSON.

---

→ FINAL: Retention tab live in the Promo Report + backend "Retention (data)" tab. Next: the matched control group (fast-follow) and the "Coming soon" data asks. VIP pillar reuses this same shell.
