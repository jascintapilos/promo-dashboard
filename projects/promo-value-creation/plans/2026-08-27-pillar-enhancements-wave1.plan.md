# Plan: Pillar Enhancements — Wave 1

> **REQUIRED:** Execute task-by-task; pause at each → CHECKPOINT for approval.

**Status:** IN_PROGRESS
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
- [ ] **Task 1**
**Files:** Create `bin/acq_report/pareto_loo.py` (or extend the acq metrics builder)
**Step 1:** From `acq-metrics-MY.json` codes[], compute per-code spend_share, ftd_share; cumulative Lorenz curve + Gini; and a leave-one-out array recomputing blended cost-per-FTD dropping each of the top-5 spenders (flag if the headline crosses a threshold when one is removed).
**Step 2:** Emit `acq.pareto = {gini, curve:[{x,y}], loo:[{code, blended_without, delta, flips}]}` into the metrics JSON; round-trip verify.
**Verify:** blended-with-all matches the tab's headline RM72; sum of spend_share ≈ 1; print top-5 LOO deltas.

### Task 2: Render the Pareto + LOO flagship
- [ ] **Task 2** · Depends: Task 1
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a card (SVG Lorenz curve + a small LOO strip) with plain caption; wire it into the acquisition `buildPanel` spec near the top of the analysis sections.
**Step 2:** Add axis titles via `axTitle`; add a one-line "what this tells you".
**Verify:** `--verify` build; DOM shows the card with curve + LOO rows; console clean; light+dark.

### Task 3: Compute claim→deposit funnel + freebie-hunter RM leakage
- [ ] **Task 3**
**Files:** Create `bin/acq_report/funnel_leakage.py`
**Step 1:** From `claim-outcomes-MY.json`: per code + blended, count claimers → depositors → stuck; sum bonus_cost of claimers with zero FTD (leakage RM). Rank codes by leakage.
**Step 2:** Emit `acq.funnel = {blended:{claimers, depositors, stuck, leakage_rm, conv_pct}, by_code:[...]}`; verify no member rows leak into the JSON.
**Verify:** claimers = depositors + stuck; leakage_rm ≤ total spend; spot-check one code against raw.

### Task 4: Render the funnel-leakage view
- [ ] **Task 4** · Depends: Task 3
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a compact funnel (3 stages with RM on the drop-off) + a "top leakage codes" mini-table; plain caption naming the guardrail (auto-cut below conversion floor).
**Verify:** `--verify`; numbers cross-foot to the emitted block; console clean.

→ CHECKPOINT: Show Acquisition additions; confirm before Retention.

---

## Phase 2 — Retention

### Task 5: Render lifecycle allocation (uses existing `by_recency`)
- [ ] **Task 5**
**Files:** Modify `templates/acq-dashboard.html` (compute already exists in `ret-metrics-MY.json.by_recency`)
**Step 1:** Add a section: horizontal bands per bucket (active/cooling/dormant/lapsed/120d+) showing spend-share, NGR-per-RM1, redeposit rate. Axis titles + plain caption answering "is budget reaching at-risk players?".
**Step 2:** If any field the view needs is missing from `by_recency`, extend the ret pipeline to add it; else render-only.
**Verify:** bucket spend-shares sum ≈ 1; matches raw `by_recency`; `--verify` clean.

### Task 6: Compute incrementality proxy + cost-per-incremental
- [ ] **Task 6**
**Files:** Create `bin/ret_report/incrementality.py`
**Step 1:** Using `tier_normal_mech`/`tier_normal_cell` baselines, compute per code: redeposit uplift over the tier×mechanic normal, incremental retained players (actual − baseline expectation), and cost per incremental retained (spend ÷ incremental). Label directional.
**Step 2:** Emit `ret.incrementality = {by_code:[{code, uplift_pp, incremental_players, cost_per_incremental}], ...}`; verify.
**Verify:** incremental ≤ total retained; cost_per_incremental sane; spot-check one code.

### Task 7: Render incrementality view
- [ ] **Task 7** · Depends: Task 6
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a chart/table ranking promos by cost-per-incremental-retained + uplift-over-baseline; plain caption ("what the bonus caused, not just what happened").
**Verify:** `--verify`; cross-foot; console clean; 0-jargon scan on new prose.

→ CHECKPOINT: Show Retention additions; confirm before VIP.

---

## Phase 3 — VIP

### Task 8: Compute at-risk whale ledger (opaque ref)
- [ ] **Task 8**
**Files:** Create `bin/vip_report/whale_ledger.py`
**Step 1:** From `member-ledger-MY.json` + `program.whale`: identify cooling top players (declining recent NGR/deposit vs their own baseline); rank by NGR-at-risk. Output rank + tier + **opaque short ref** (stable hash prefix) + NGR-at-risk + a one-line signal. NO name/real id.
**Step 2:** Emit `vip.whale_ledger = [{rank, ref, tier, ngr_at_risk, signal}]` (top N); verify the committed JSON carries only opaque refs.
**Verify:** refs are non-reversible short hashes; ledger NGR-at-risk ≤ program NGR; spot-check ranking.

### Task 9: Render the whale ledger
- [ ] **Task 9** · Depends: Task 8
**Files:** Modify `templates/acq-dashboard.html` (VIP tab)
**Step 1:** Add a section: ranked table "Whale #1 · Diamond · ref · RM… at risk · signal"; plain caption (turn the top-1% concentration risk into a watch list).
**Verify:** `--verify`; renders in VIP; no identifiers beyond ref/tier; console clean.

### Task 10: Surface cashback trust (placebo + durability)
- [ ] **Task 10**
**Files:** Modify `bin/vip_report/*` (reuse `cashback-incrementality-MY.json` / `rescue-forward-MY.json`)
**Step 1:** Assemble the placebo (date-shifted) result, common-support check, and forward-60/90-day durability into a `vip.cashback_trust` block with a plain verdict ("clean / can't settle").
**Verify:** figures match the source files; verdict logic matches the base-rate finding.

### Task 11: Render cashback trust on Lane B
- [ ] **Task 11** · Depends: Task 10
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a "can we trust this?" panel to Lane B (money-back) showing placebo + durability + the plain verdict.
**Verify:** `--verify`; cross-foot; console clean; 0-jargon.

### Task 12: Compute bonus-farming watchlist
- [ ] **Task 12**
**Files:** Create `bin/vip_report/farming_watchlist.py`
**Step 1:** From `claim-rows` + `member-ledger`: flag codes eaten by one player (top-member share of a code's claims/cost) and members hitting many codes (breadth); output aggregated counts + opaque refs.
**Step 2:** Emit `vip.farming = {by_code:[...], by_member:[{ref, codes_hit, ...}]}`; verify no real ids.
**Verify:** flagged shares/counts reproduce from raw; refs opaque.

### Task 13: Render farming watchlist
- [ ] **Task 13** · Depends: Task 12
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a compact watchlist (top code-concentration + top multi-code members) with plain caption + the guardrail it implies.
**Verify:** `--verify`; renders; console clean.

→ CHECKPOINT: Show VIP additions; confirm before the trust layer.

---

## Phase 4 — Trust & fragility layer (all 3 tables)

### Task 14: Compute per-code coverage + one-member fragility
- [ ] **Task 14**
**Files:** Modify each pillar's pipeline (acq: `claim-outcomes`; ret/vip: `claim-rows`)
**Step 1:** Per graded code, compute n (depositors/claimers), matured-window share, top-member share of the code's NGR-lift (or FTD), and a boolean "verdict holds without the single biggest member". Emit into each code object (e.g. `code.robustness = {...}`).
**Verify:** n matches existing counts; top-member share ∈ [0,1]; spot-check the flip flag on a known one-whale code.

### Task 15: Render expandable confidence sub-rows
- [ ] **Task 15** · Depends: Task 14
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** On the Acquisition / Retention / VIP (Lane A/D) decision tables, add a per-row expander revealing n, matured %, top-member share, and the "survives without top member?" result; mute/tag verdicts that fail (low-n or one-whale-carried) as "provisional".
**Step 2:** Add a one-line "how to read confidence" note.
**Verify:** `--verify`; expanders toggle; provisional tags appear on the right rows; console clean; light+dark.

→ FINAL: Full report `--verify` + full build; publish to the artifact; 0-jargon scan across all tabs; confirm no member data committed; update Status to COMPLETED.
