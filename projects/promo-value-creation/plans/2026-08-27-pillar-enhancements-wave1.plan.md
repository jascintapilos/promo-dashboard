# Plan: Pillar Enhancements — Wave 1

> **REQUIRED:** Execute task-by-task; pause at each → CHECKPOINT for approval.

**Status:** COMPLETED
**Created:** 2026-08-27
**Goal:** Add the approved first-wave analyses to the Acquisition / Retention / VIP tabs — pillar flagships + incrementality + anti-abuse leakage, then a cross-cutting trust/fragility layer.
**Architecture:** For each item: compute in the pillar's Python pipeline (`bin/{acq,ret,vip}_report/`) reading scratchpad metrics + member rows → emit aggregated block into `*-metrics-MY.json` → render a view in `templates/acq-dashboard.html` (section via the numbered-TOC builder, chart via SVG helpers + `axTitle`, or expandable sub-row on a decision table). Member data stays in scratchpad.
**Decisions (locked):** trust layer = expandable confidence sub-row per code; whale/farmer identity = opaque short ref (rank + tier + ref, no name); build order = flagship-first.
**Design:** `projects/promo-value-creation/plans/2026-08-27-pillar-enhancements-wave1-design.md`
**Verify per item:** recompute cross-foots to raw; sanity ranges; plain-language (0-jargon scan); `--verify` build → DOM/console clean; no member rows in committed JSON.

## File Map
- Modify: `bin/acq_report/*` — add Pareto/LOO + funnel-leakage computation
- Modify: `bin/ret_report/*` — add incrementality proxy + cost-per-incremental; surface `by_recency`
- Modify: `bin/vip_report/*` — add whale ledger, cashback-trust surfacing, farming watchlist
- Modify: each pillar's fragility/coverage computation (Phase 4)
- Modify: `templates/acq-dashboard.html` — new sections/charts + confidence sub-rows
- Data (scratchpad only): `scratchpad/{acq,ret,vip}/*-metrics-MY.json` gain new blocks

---

## Phase 1 — Acquisition

### Task 1: Compute spend-vs-FTD Pareto + leave-one-out headline
- [x] **Task 1**
  - Result: ✅ `bin/acq_report/pareto_loo.py` → `acq.pareto`. Gini(spend) 0.77; top code = 35.4% of spend but 5.3% of FTDs; LOO: dropping `welcomegift_fc50` moves the headline RM72→RM49 (−32%, material). Cross-foots to the RM72 headline.
**Files:** Create `bin/acq_report/pareto_loo.py` (or extend the acq metrics builder)
**Step 1:** From `acq-metrics-MY.json` codes[], compute per-code spend_share, ftd_share; cumulative Lorenz curve + Gini; and a leave-one-out array recomputing blended cost-per-FTD dropping each of the top-5 spenders (flag if the headline crosses a threshold when one is removed).
**Step 2:** Emit `acq.pareto = {gini, curve:[{x,y}], loo:[{code, blended_without, delta, flips}]}` into the metrics JSON; round-trip verify.
**Verify:** blended-with-all matches the tab's headline RM72; sum of spend_share ≈ 1; print top-5 LOO deltas.

### Task 2: Render the Pareto + LOO flagship
- [x] **Task 2** · Depends: Task 1
  - Result: ✅ `acqParetoCard` (section #4, after Key numbers): Lorenz curve (spend-share vs FTD-share, axis-titled) + LOO strip (green=protect / red=cap-cut) + plain note. `paretoLOO()` wired into init line + `paint()`. Verified drawn on load; console clean.
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a card (SVG Lorenz curve + a small LOO strip) with plain caption; wire it into the acquisition `buildPanel` spec near the top of the analysis sections.
**Step 2:** Add axis titles via `axTitle`; add a one-line "what this tells you".
**Verify:** `--verify` build; DOM shows the card with curve + LOO rows; console clean; light+dark.

### Task 3: Compute claim→deposit funnel + freebie-hunter RM leakage
- [x] **Task 3**
  - Result: ✅ `bin/acq_report/funnel_leakage.py` → `acq.funnel`. 5,124 claimers → 1,999 depositors (39%) → 3,125 stuck; RM152,740 leaked (62.5% of spend). Worst: `welcomegift_fc50` (91% leaked, 8.9% conv) — same code the Pareto flags. Cross-foots (claimers = depositors + stuck).
**Files:** Create `bin/acq_report/funnel_leakage.py`
**Step 1:** From `claim-outcomes-MY.json`: per code + blended, count claimers → depositors → stuck; sum bonus_cost of claimers with zero FTD (leakage RM). Rank codes by leakage.
**Step 2:** Emit `acq.funnel = {blended:{claimers, depositors, stuck, leakage_rm, conv_pct}, by_code:[...]}`; verify no member rows leak into the JSON.
**Verify:** claimers = depositors + stuck; leakage_rm ≤ total spend; spot-check one code against raw.

### Task 4: Render the funnel-leakage view
- [x] **Task 4** · Depends: Task 3
  - Result: ✅ `acqFunnelCard` (section #11): 2-stage funnel (claimed→deposited, conv %) + top-6 leakage table + guardrail note. `acqFunnelDraw()` wired into init + `paint()`. Plain-language nits fixed (dropped "leave-one-out"/"freebie-hunter" from visible copy). Console clean.
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a compact funnel (3 stages with RM on the drop-off) + a "top leakage codes" mini-table; plain caption naming the guardrail (auto-cut below conversion floor).
**Verify:** `--verify`; numbers cross-foot to the emitted block; console clean.

→ CHECKPOINT: Show Acquisition additions; confirm before Retention.

---

## Phase 2 — Retention

### Task 5: Render lifecycle allocation (uses existing `by_recency`)
- [x] **Task 5**
  - Result: ✅ `retLifecycleCard` (section #4): spend-by-stage + pay-back-by-stage bars (axis-titled) + note. Finding: 80% of budget → Active(0–14d) players who return 93.9% anyway; Lapsed(60–120d) win-back loses money (−RM0.40/RM1). Render-only (by_recency already computed). Wired into renderRetention + paint.
**Files:** Modify `templates/acq-dashboard.html` (compute already exists in `ret-metrics-MY.json.by_recency`)
**Step 1:** Add a section: horizontal bands per bucket (active/cooling/dormant/lapsed/120d+) showing spend-share, NGR-per-RM1, redeposit rate. Axis titles + plain caption answering "is budget reaching at-risk players?".
**Step 2:** If any field the view needs is missing from `by_recency`, extend the ret pipeline to add it; else render-only.
**Verify:** bucket spend-shares sum ≈ 1; matches raw `by_recency`; `--verify` clean.

### Task 6: Compute incrementality proxy + cost-per-incremental
- [x] **Task 6**
  - Result: ✅ `bin/ret_report/incrementality.py` → `ret.incrementality` (uses existing redeposit_expected/retained/matured_30 — no member rows). Finding: 28,818 retained vs 28,819 baseline-expected → ~0 incremental returners; only 98/237 codes (37.5% of spend) lift returns above baseline. Reconciles with "makes money" = bigger deposits, not more returners. Cross-foots.
**Files:** Create `bin/ret_report/incrementality.py`
**Step 1:** Using `tier_normal_mech`/`tier_normal_cell` baselines, compute per code: redeposit uplift over the tier×mechanic normal, incremental retained players (actual − baseline expectation), and cost per incremental retained (spend ÷ incremental). Label directional.
**Step 2:** Emit `ret.incrementality = {by_code:[{code, uplift_pp, incremental_players, cost_per_incremental}], ...}`; verify.
**Verify:** incremental ≤ total retained; cost_per_incremental sane; spot-check one code.

### Task 7: Render incrementality view
- [x] **Task 7** · Depends: Task 6
  - Result: ✅ `retIncrCard` (section #5): come-back-vs-baseline bars (green/red) + "cheapest extra returners" table + honest note (headcount ~0 extra; money = bigger deposits; target the 98 codes that add returns). Wired into renderRetention + paint. 0-jargon on the tab; console clean.
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a chart/table ranking promos by cost-per-incremental-retained + uplift-over-baseline; plain caption ("what the bonus caused, not just what happened").
**Verify:** `--verify`; cross-foot; console clean; 0-jargon scan on new prose.

→ CHECKPOINT: Show Retention additions; confirm before VIP.

---

## Phase 3 — VIP

### Task 8: Compute at-risk whale ledger (opaque ref)
- [x] **Task 8**
  - Result: ✅ bin/vip_report/whale_ledger.py → vip.whale_ledger (opaque 6-hex refs only). 74 whales(top 1%), 44 cooling, RM10.7M NGR-at-risk; top = Diamond FBAA77 RM1.14M, deposits -48%. Verified no member ids.
**Files:** Create `bin/vip_report/whale_ledger.py`
**Step 1:** From `member-ledger-MY.json` + `program.whale`: identify cooling top players (declining recent NGR/deposit vs their own baseline); rank by NGR-at-risk. Output rank + tier + **opaque short ref** (stable hash prefix) + NGR-at-risk + a one-line signal. NO name/real id.
**Step 2:** Emit `vip.whale_ledger = [{rank, ref, tier, ngr_at_risk, signal}]` (top N); verify the committed JSON carries only opaque refs.
**Verify:** refs are non-reversible short hashes; ledger NGR-at-risk ≤ program NGR; spot-check ranking.

### Task 9: Render the whale ledger
- [x] **Task 9** · Depends: Task 8
  - Result: ✅ vipWhaleCard (section #6): ranked table (rank/ref/tier/YTD NGR/signal) + note (44/74 cooling, RM10.7M at risk). Refs confirmed opaque in DOM.
**Files:** Modify `templates/acq-dashboard.html` (VIP tab)
**Step 1:** Add a section: ranked table "Whale #1 · Diamond · ref · RM… at risk · signal"; plain caption (turn the top-1% concentration risk into a watch list).
**Verify:** `--verify`; renders in VIP; no identifiers beyond ref/tier; console clean.

### Task 10: Surface cashback trust (placebo + durability)
- [x] **Task 10**
  - Result: ✅ bin/vip_report/cashback_trust.py → vip.cashback_trust. Matched effect COSTS money most tiers (Diamond -RM22.4K@30d), small positives within placebo noise; forward NGR grows only because claimers are whales. Cross-checks cashback_validation.
**Files:** Modify `bin/vip_report/*` (reuse `cashback-incrementality-MY.json` / `rescue-forward-MY.json`)
**Step 1:** Assemble the placebo (date-shifted) result, common-support check, and forward-60/90-day durability into a `vip.cashback_trust` block with a plain verdict ("clean / can't settle").
**Verify:** figures match the source files; verdict logic matches the base-rate finding.

### Task 11: Render cashback trust on Lane B
- [x] **Task 11** · Depends: Task 10
  - Result: ✅ v_cbTrust card in Lane B: per-tier table (real 30/60d, sanity check, match quality, verdict) + plain durability note + plain 'hold + run holdout' verdict. Plain-language (placebo/durability reworded); 0-jargon.
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a "can we trust this?" panel to Lane B (money-back) showing placebo + durability + the plain verdict.
**Verify:** `--verify`; cross-foot; console clean; 0-jargon.

### Task 12: Compute bonus-farming watchlist
- [x] **Task 12**
  - Result: ✅ bin/vip_report/farming_watchlist.py → vip.farming (opaque refs). Median 6 codes/member, max 194, 671 hit ≥20; 9 one-player-concentrated codes (mini-games). No member ids in output.
**Files:** Create `bin/vip_report/farming_watchlist.py`
**Step 1:** From `claim-rows` + `member-ledger`: flag codes eaten by one player (top-member share of a code's claims/cost) and members hitting many codes (breadth); output aggregated counts + opaque refs.
**Step 2:** Emit `vip.farming = {by_code:[...], by_member:[{ref, codes_hit, ...}]}`; verify no real ids.
**Verify:** flagged shares/counts reproduce from raw; refs opaque.

### Task 13: Render farming watchlist
- [x] **Task 13** · Depends: Task 12
  - Result: ✅ vipFarmCard (after lanes): breadth table + one-player-concentration table + watchlist note (cross-links to whale ledger). Also added a 'Key metric' row to the VIP method card (about break-even ex-money-back). Console clean.
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a compact watchlist (top code-concentration + top multi-code members) with plain caption + the guardrail it implies.
**Verify:** `--verify`; renders; console clean.

→ CHECKPOINT: Show VIP additions; confirm before the trust layer.

---

## Phase 4 — Trust & fragility layer (all 3 tables)

### Task 14: Compute per-code coverage + one-member fragility
- [x] **Task 14**
  - Result: bin/robustness.py -> per-code robustness on all 3 pillars (n, matured %, one-member NGR share, ex-top1 per-RM, survives, provisional). 240/325 RET + 240/383 VIP provisional; unstable shares guarded.
**Files:** Modify each pillar's pipeline (acq: `claim-outcomes`; ret/vip: `claim-rows`)
**Step 1:** Per graded code, compute n (depositors/claimers), matured-window share, top-member share of the code's NGR-lift (or FTD), and a boolean "verdict holds without the single biggest member". Emit into each code object (e.g. `code.robustness = {...}`).
**Verify:** n matches existing counts; top-member share ∈ [0,1]; spot-check the flip flag on a known one-whale code.

### Task 15: Render expandable confidence sub-rows
- [x] **Task 15**
  - Result: expandable confidence sub-row on the Acq/Ret/VIP decision tables (shared confDetail + one delegated toggle); provisional tag inline; 'click any row' note. Verified via simulation + build. · Depends: Task 14
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** On the Acquisition / Retention / VIP (Lane A/D) decision tables, add a per-row expander revealing n, matured %, top-member share, and the "survives without top member?" result; mute/tag verdicts that fail (low-n or one-whale-carried) as "provisional".
**Step 2:** Add a one-line "how to read confidence" note.
**Verify:** `--verify`; expanders toggle; provisional tags appear on the right rows; console clean; light+dark.

→ FINAL: Full report `--verify` + full build; publish to the artifact; 0-jargon scan across all tabs; confirm no member data committed; update Status to COMPLETED.
