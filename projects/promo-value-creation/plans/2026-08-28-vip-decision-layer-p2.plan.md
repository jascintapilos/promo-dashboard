# Plan: VIP report — decision layer, Phase 2 (compute passes)

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** IN_PROGRESS
**Created:** 2026-08-28
**Goal:** Ship the four P2 decision surfaces — Reallocation-return, Trend decomposition + do-nothing counterfactual, Monthly operating system, and Scope/compliance notes — computed entirely from existing scratchpad data (no new ClickHouse pulls), so the report answers "what is the reinvestment worth", "why is VIP degrading", "how do we track that the moves worked", and "what's out of scope / the compliance & incentive risks".
**Architecture:** Three new Python builders in `bin/vip_report/` (`reallocation_return.py`, `trend_decompose.py`, `operating_baseline.py`) each read existing scratchpad files and **merge a block into `vip-metrics-MY.json`** (same pattern as P1's `decision_layer.py` — the build passes the whole JSON through, so no build-script change). The template gains three cards + one notes block in the VIP "answers"/"need-to-know" area, each reading `VIP.<block>` and each with CALC + READ notes. Causal figures (cost-per-retained-whale, recoverable fraction) ship as **directional, holdout-gated estimates with explicit labels** — never as authorised numbers.
**Tech/Tools:** Python 3 (existing `bin/vip_report/` pattern), Node build (`bin/build_acq_dashboard.mjs`), Browser-pane verify at `http://127.0.0.1:8899/acq-dashboard-MY.html`, Artifact publish to the existing URL.
**Design:** `projects/promo-value-creation/plans/2026-08-28-vip-report-ceo-decision-layer-design.md` — this plan implements Phase 2 (components 4–7). P0/P1 already shipped (commits `6ca9dbe`, `067f6d5`).

## Key facts the executor MUST know (verified 2026-08-28)
- **Scratchpad root** (member-level; NEVER commit): `C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad`. Resolve via env `VIP_SCR` with this baked default (as `decision_layer.py` does). VIP dir: `<SCR>/vip/`.
- **Existing scratchpad inputs (all present, no pulls needed):**
  - `vip/member-ledger-MY.json` — 7,410 rows: `{member, vip_bonus, vip_claims, rescue_claims, ytd_ngr, ytd_ggr, dep_h1, dep_h2, tier_start, tier_end}`. `dep_h1/dep_h2` = first-half vs second-half deposits (the slip signal); `tier_start/tier_end` = migration.
  - `vip/claim-rows-MY.json` — 64,574 rows: `{code, member, claim_date, tier, claims, bonus_cost, t1_dep, t1_ngr, dep_lift, ggr_lift, ngr_lift, w7_dep, w7_ggr, dep_days_7, redep_days_30, dep_days_30/60/90, dep_days_8_29, last_dep_before, recency_days, mature_7/30/60/90}`. `claim_date` drives the monthly trend; forward `dep_days_*` / `ngr_lift` give per-claim forward behaviour.
  - `vip/vip-metrics-MY.json` — already has computed blocks to SURFACE (do not recompute): `tier_migration` `{climbed,held,slid,known,climbers{n,med_bonus,med_ngr},held_grp,by_end_tier[{tier,climbed_in,med_bonus,med_ngr}]}`; `whale_ledger.members[{rank,ref,tier,ytd_ngr,drop_pct,dep_h1,dep_h2,signal}]` (ref is already an OPAQUE code e.g. FBAA77 — safe to show); `whale` `{value_at_risk_members:262, value_at_risk_ngr:15335222, top1pct/top10pct...}`; `survival.by_mechanic[{mechanic,matured_90,still_60,still_90}]`; `bonus_sizing.by_band[{band,claims,spend,dep_lift_per_rm,ngr_lift_per_rm}]`; `sweet_by_tier` (`per_tier`, `size_grid`, `mech_grid`); `cashback_validation.base_rate[tier]{treated_redep,untreated_redep,lift_pp}`, `.break_even`, `.top_diamond_downside`; `deposit_split`; `program.by_tier`; and the P1 `decision` block.
- **Opaque refs only** in any shared/committed view: use `whale_ledger.members[].ref` (already opaque). NEVER surface `member` ids from member-ledger/claim-rows. Member-level stays in scratchpad.
- **Causal honesty (non-negotiable):** cost-per-retained-whale and recoverable-fraction are directional observational estimates (selection + mean-reversion not controlled). Label them "directional — the matched holdout is the proof step", exactly as the report already treats NGR-lift. Never call NGR promo-attributed. The Rescue reclaimable figure is an upper-bound-of-non-incremental read from the ≤2.7pp lift over a ~96% base rate — present as perk right-sizing, not a keep/cut ROI verdict ([[feedback_weekly_rescue_is_a_perk]]).
- **Template mechanics:** builders merge into `vip-metrics-MY.json`; template reads `VIP.<block>`. Render helpers: `vM()`/`fmt`, `CV()`, `el()`, `annotateCalc()` (keys by inner element id, appends note to `closest('.card')`, runs BEFORE buildPanel). New cards: add a `<div class="card col12" id="vipXCard"><div class="card-h">…</div><div id="v_x"></div></div>` in the `#panel-vip` markup + a render IIFE guarded `if(!VIP.<block>) return;` + `CALC_DATA["v_x"]`/`READ_DATA["v_x"]` + a `cardSec(byId('vipXCard'))` entry in `buildPanel('panel-vip',[…])`. Reusable table styles from P1: `.dregwrap`/`.dreg`/`.dregrisk`; badges `.fbadge.floor/.band`; `.varbox`, `.sub2`, `.fine`.
- **Verify loop:** extract largest `<script>` → `node --check`; `node bin/build_acq_dashboard.mjs`; navigate `?v=N` (bump); `javascript_tool` DOM asserts; `read_console_messages onlyErrors:true` must be clean. Artifact URL `https://claude.ai/code/artifact/b5e60fe2-bef0-4c29-ab19-1261c25fd619`, title "Promo Report", favicon 📊.
- **Build order:** after editing any builder, run ALL VIP builders that emit blocks the template needs (at minimum the new P2 builders + P1 `decision_layer.py` if metrics were regenerated), THEN `node bin/build_acq_dashboard.mjs`.

## File Map
- Create: `bin/vip_report/reallocation_return.py` — emits `reallocation` block (marginal-return-by-tier, migration funnel, reclaimable-Rescue, directional cost-per-retained-whale + recoverable fraction, total upside).
- Create: `bin/vip_report/trend_decompose.py` — emits `trend_decomp` block (monthly VIP series + decline decomposition + do-nothing projection) from claim-rows.
- Create: `bin/vip_report/operating_baseline.py` — emits `operating` block (baseline snapshot locked as of data_as_of, leading-indicator strip, whale-slip watchlist from whale_ledger).
- Modify: `templates/acq-dashboard.html` — 3 new cards (`vipReallocCard`, `vipTrendDecompCard`, `vipOperatingCard`) + 1 scope/compliance notes block; render IIFEs; CALC/READ entries; `buildPanel('panel-vip')` wiring.
- Modify (regenerated): `outputs/acq-dashboard-MY.html`.
- No change: `bin/build_acq_dashboard.mjs`.

---

## Tasks

### Task 1: `reallocation_return.py` — surface-and-arithmetic pieces

- [x] **Task 1**
  - Result: ✅ reallocation_return.py computes marginal-return-by-tier (from size_grid), climb funnel (tier_migration), reclaimable-Rescue perk band. Verified prints reconcile (climbers med_bonus 797 vs held 396; Diamond rescue RM1.47M).

**Files:**
- Create: `bin/vip_report/reallocation_return.py`

**Step 1:** Load `vip-metrics-MY.json`. Build a `reallocation` dict with the pieces derivable from EXISTING blocks (no member-level crunch yet):
  - `marginal_by_tier`: from `sweet_by_tier` (`per_tier`/`size_grid`) + `bonus_sizing.by_band` — for each tier a "return on the next RM" read: the `ngr_lift_per_rm` of the next size band up from where the tier currently concentrates. Keep it directional; include the tier's current median bonus (from `tier_migration.by_end_tier` med_bonus) for context.
  - `migration_funnel`: surface `tier_migration` as a climb funnel — per end-tier `climbed_in`, and `climbers` vs `held_grp` median bonus/ngr (climbers get more bonus AND return more → the pipeline is real). No recompute; reshape only.
  - `reclaimable_rescue`: from `cashback_validation.base_rate` — Diamond Rescue spend (from `lane_summary['B-cashback']` / `program`) × the non-incremental share implied by the lift (e.g. lift_pp 2.7 over ~96% base ⇒ ~97%+ would redeposit anyway ⇒ reclaimable range as a band). Emit `{tier, rescue_spend, lift_pp, reclaimable_low, reclaimable_high, basis}`. Frame as perk right-sizing, not ROI.
- Tool: `Write`

**Step 2:** Print a summary; do NOT write the file yet (Task 2 adds the causal pieces and writes once).
- Tool: `Write` (same script, guarded so Task 2 completes it)

**Verify:** `python bin/vip_report/reallocation_return.py` prints marginal-by-tier rows, the funnel (climbers med_bonus 797 vs held 396), and a reclaimable-Rescue band — numbers reconcile with the source blocks.

---

### Task 2: `reallocation_return.py` — directional cost-per-retained-whale + write block

- [x] **Task 2**
  - Result: ✅ Added directional cost-per-retained-whale from member-ledger+claim-rows. Surfaced a key honesty finding: 95% of slipping whales (378/397) already get deposit-tied bonuses → only 19 control → flagged thin-control, recoverable NGR marked illustrative/not-bankable. `reallocation` block written.
- Depends: Task 1

**Files:**
- Modify: `bin/vip_report/reallocation_return.py`

**Step 1:** Add the directional causal estimate from `member-ledger-MY.json` + `claim-rows-MY.json`:
  - Define **slipping whales** = top-decile-by-ytd_ngr members with `dep_h2 < dep_h1`. Split by whether they received a **deposit-tied bonus** in H2 (join to claim-rows: a claim with `t1_dep>0` / deposit-required code in the second half). Compare mean forward deposit retention (`dep_h2/dep_h1`, and forward `ngr_lift`) treated vs untreated, **matched on tier** (and loss/deposit decile if feasible).
  - `cost_per_retained_whale` = deposit-tied bonus spend on that cohort / (extra whales retained vs the untreated rate). `recoverable_fraction` = share of the RM15.3M at-risk NGR the treated-vs-untreated delta implies is recoverable per RM. Emit both with an explicit `caveat` and `gated_on:"Lane A / retention matched holdout"`.
  - `total_upside`: a single directional figure — freed floor (~RM228k) redeployed at the estimated recoverable rate — carrying the same caveat.
- Tool: `Edit`

**Step 2:** Merge `reallocation` into the JSON and write once (`ensure_ascii=False, indent=2`). Print the full summary.
- Tool: `Edit` + `Bash` run.

**Verify:** JSON has `reallocation` with `marginal_by_tier`, `migration_funnel`, `reclaimable_rescue`, `cost_per_retained_whale`, `recoverable_fraction`, `total_upside`, each causal field carrying a `caveat`/`gated_on`. Counts sane (treated/untreated n printed).

---

### Task 3: Reallocation-return card (render + CALC/READ + wire)

- [x] **Task 3**
  - Result: ✅ 'What the reinvestment is worth' card: marginal table + climb funnel + Rescue perk note + DIRECTIONAL whale block (thin-control warning visible). Ordered after cost-of-wrong, before register. CALC/READ added. Build clean, DOM asserts pass, zero console errors.
- Depends: Task 2

**Files:**
- Modify: `templates/acq-dashboard.html`

**Step 1:** Add `<div class="card col12" id="vipReallocCard"><div class="card-h"><h3>What the reinvestment is worth</h3><span class="hint">return on moving the money</span></div><div id="v_realloc"></div></div>` in `#panel-vip` markup; render IIFE (guarded) showing: marginal-return-by-tier mini-table; the climb funnel (climbers get more AND return more); reclaimable-Rescue band; and a **directional** cost-per-retained-whale + recoverable-fraction + total-upside block styled distinctly (amber/`band` treatment) with the "directional — holdout is the proof" label visible, not hidden.
- Tool: `Edit`

**Step 2:** Add `CALC_DATA["v_realloc"]` (formulas + the gated/directional caveat) and `READ_DATA["v_realloc"]`; wire `cardSec(byId('vipReallocCard'))` into `buildPanel('panel-vip')` in the answers block right after `vipCostWrongCard` (cost of being wrong → what the reinvestment is worth → decision register).
- Tool: `Edit`

**Verify:** build; DOM assert `#v_realloc` has the funnel + marginal table + a visible "directional"/"holdout" label on the cost-per-whale block; ordering places it after cost-of-wrong and before the register.

---

→ CHECKPOINT A (reallocation-return): build, browser-verify (DOM + no console errors), publish, commit template + output + `reallocation_return.py`. Show the user the reinvestment-return card and the directional labelling; confirm before the trend/operating work.

---

### Task 4: `trend_decompose.py` — monthly VIP decomposition + counterfactual

- [ ] **Task 4**

**Files:**
- Create: `bin/vip_report/trend_decompose.py`

**Step 1:** From `claim-rows-MY.json`, bucket by month(`claim_date`) and compute per month: total spend, NGR-lift/RM (net), no-deposit share of spend (deposit-required vs not, via code/`t1_dep`), and by-tier mix. Restrict to matured claims where a window is needed (use `mature_7`/`mature_30` flags consistently with the report basis).
- Tool: `Write`

**Step 2:** Decompose the 8-month decline into components (mix-shift to no-deposit at −0.12/RM vs tier-softening vs at-risk-whale drag) and a simple **do-nothing projection** (extrapolate the recent slope N months). Emit `trend_decomp` = `{monthly[], decomposition{mix,tier,whale,resid}, projection{do_nothing[], basis}}`. Merge + write. Print summary.
- Tool: `Write` + `Bash` run.

**Verify:** `python bin/vip_report/trend_decompose.py` prints ~8 monthly rows and a decomposition; the monthly NGR-lift/RM trend direction matches the report's "VIP-perf degrading" signal.

---

### Task 5: Trend-decomposition card (render + CALC/READ + wire)

- [ ] **Task 5**
- Depends: Task 4

**Files:**
- Modify: `templates/acq-dashboard.html`

**Step 1:** Add `vipTrendDecompCard` (`#v_trendDecomp`) in `#panel-vip`; render a small monthly trend (reuse an existing bar/line helper if present, else a compact table) + the decomposition ("what's dragging the decline") + the do-nothing projection line ("cost of inaction"). Place in the "need-to-know" block near the existing `s_trendCard`/trend context, OR just before `vipGgrCard`.
- Tool: `Edit`

**Step 2:** `CALC_DATA`/`READ_DATA` for `v_trendDecomp` (monthly basis + the decomposition method + projection caveat: extrapolation, not a forecast). Wire `cardSec(byId('vipTrendDecompCard'))` into the spec.
- Tool: `Edit`

**Verify:** build; DOM assert the card shows monthly rows + a decomposition + a projection; console clean.

---

### Task 6: `operating_baseline.py` — locked baseline + whale-slip watchlist + indicators

- [ ] **Task 6**

**Files:**
- Create: `bin/vip_report/operating_baseline.py`

**Step 1:** Emit an `operating` block: (a) `baseline` = key metrics snapshot stamped with `data_as_of` (subsidy, lane per-RM, funding_index by tier, no-deposit share) to lock the before-picture; (b) `leading_indicators` = the metrics to watch monthly (current values; deltas populate next run); (c) `whale_slip_watch` = from `whale_ledger.members` — the slipping whales (drop_pct ≥ threshold) as `{ref, tier, ytd_ngr, drop_pct, signal}` (OPAQUE refs only), plus the count vs `whale.value_at_risk_members` and total at-risk NGR; (d) `move_tracker` = one row per decision-register action with `baseline_locked` = data_as_of, `target` placeholder, `owner`:"TBC".
- Tool: `Write`

**Step 2:** Merge + write. Print summary (whale-slip count reconciles with `value_at_risk_members` = 262).
- Tool: `Write` + `Bash` run.

**Verify:** JSON `operating` has baseline/leading_indicators/whale_slip_watch/move_tracker; watchlist uses opaque refs only; count ties to 262.

---

### Task 7: Monthly operating card (render + CALC/READ + wire)

- [ ] **Task 7**
- Depends: Task 6

**Files:**
- Modify: `templates/acq-dashboard.html`

**Step 1:** Add `vipOperatingCard` (`#v_operating`) in `#panel-vip` (need-to-know block); render: the whale-slip watchlist (opaque ref · tier · YTD NGR · deposit drop · signal), the leading-indicator strip (value + "delta next month" placeholder), and the move-tracker rows (baseline locked as of data_as_of, owner TBC). Reuse `.dreg` table styles.
- Tool: `Edit`

**Step 2:** `CALC_DATA`/`READ_DATA` for `v_operating` (what each indicator is; that deltas need next period; that the watchlist is the alert cohort). Wire `cardSec(byId('vipOperatingCard'))` into the spec (near `vipFarmCard`).
- Tool: `Edit`

**Verify:** build; DOM assert watchlist rows render with opaque refs (no numeric member ids), indicator strip present, tracker present; console clean.

---

→ CHECKPOINT B (trend + operating): build, browser-verify, publish, commit template + output + `trend_decompose.py` + `operating_baseline.py`. Show the user; confirm before scope/compliance notes.

---

### Task 8: Scope & compliance notes

- [ ] **Task 8**

**Files:**
- Modify: `templates/acq-dashboard.html`

**Step 1:** Add a scope/compliance notes block (append to the VIP `v_notes`, or a small `vipScopeCard`): (a) **Scope** — this report is MY-only; state whether SG VIP is out by design or pending (OPEN ITEM below), and that program-wide policy off one market carries risk; (b) **Responsible gaming** — a plain read on rebating losses (98% of Rescue claimers were losing) and post-deposit bonuses being the loss-chasing mechanisms regulators scrutinise; (c) **Incentive root cause** — the data (81% VM-assigned, 0% self-claim, −0.71/RM) points at VM compensation rewarding bonus volume over net player value; flag as a question for the business, not a settled finding.
- Tool: `Edit`

**Step 2:** If rendered as a card, add CALC/READ + wire; if appended to notes, ensure it reads plainly. Keep it clearly a "notes/flags" block, not a scored analysis.
- Tool: `Edit`

**Verify:** build; the scope/RG/incentive notes render in the VIP notes/soon area; console clean.

---

### Task 9: Full P2 build & consolidated browser verify

- [ ] **Task 9**
- Depends: Tasks 3,5,7,8

**Files:**
- Modify: `templates/acq-dashboard.html` (only if fixes needed)

**Step 1:** Run all P2 builders (`reallocation_return.py`, `trend_decompose.py`, `operating_baseline.py`) then `node bin/build_acq_dashboard.mjs`. Extract script → `node --check`.
- Tool: `Bash`

**Step 2:** Navigate `?v=` bumped; one consolidated `javascript_tool` assert: all four surfaces present and ordered (realloc after cost-of-wrong; trend-decomp + operating in need-to-know; scope notes present); every causal figure carries a visible directional/holdout or YTD-proxy label; watchlist uses opaque refs only. `read_console_messages onlyErrors:true` clean.
- Tool: `Bash` + Browser-pane.

**Verify:** consolidated assert all-true; zero console errors; build summary prints.

---

→ FINAL (P2 ships): publish `outputs/acq-dashboard-MY.html`; commit template + output + the three builders. **Never commit scratchpad.** Update Status to COMPLETED. Report to the user where each surface appears and re-flag the open items. Update memory `project_vip_report_ceo_decision_layer_design` to P0+P1+P2 shipped.

## Open items to raise (need user input; do NOT block the build — use sensible defaults)
1. **SG scope** — is SG VIP out by design, or should it be a follow-on data effort? Default: state MY-only + flag SG as a separate plan. (Affects Task 8 wording only.)
2. **Cost-per-retained-whale framing** — default is a directional observational estimate, clearly labelled and holdout-gated (Task 2). If you'd rather it ship as a pure framework-with-blanks (no number until the holdout), say so.
3. **Do-nothing projection horizon** — default extrapolate 3 months; confirm or change (Task 4).

## Out of scope (P3)
- Running the actual Lane A / retention matched holdout (`bin/vip_report/frequency-cap-holdout-spec.md` exists) — the proof step that turns the directional P2 figures into authorised ones. Competitor benchmark data. Any SG data pull (separate plan if scope is confirmed in).
