# Plan: Promo Report — "load in seconds" (nightly pre-aggregation)

**Status:** IN_PROGRESS
**Created:** 2026-10-06
**Owner request:** "company dashboard loads instantly, i can't have report loads for 3 mins." Owner chose the **full engine** (any date range fast), after hearing the review's lean-vs-full tradeoff.
**Goal:** Any date window the picker produces loads in seconds, not ~3 minutes — matching the company dashboard — while reproducing today's numbers exactly.

## Why it's slow today
A window rebuild makes ~40 **remote** ClickHouse scans, each cross-joining a 180–270-day daily snapshot over the whole member base. The arithmetic is fast; the remote round-trips are the wall-clock. Fix: run the heavy scans **once nightly on the VDI into a LOCAL store**, then every window reads local. Pre-render the common windows to static files (truly instant).

## Architecture
- **Engine:** DuckDB over month-partitioned Parquet (zero-ops, columnar, reads Parquet natively, caches in RAM). Not SQLite (row-store, slow re-aggregation), not local ClickHouse (a server = ops drag).
- **Nightly job** piggybacks the existing 10 AM BO auto-pull on the VDI (the only host the warehouse firewall admits).
- **Serve:** standard window → pre-rendered static `report.<window>.live.json` (instant). Custom window → VDI worker recomputes against local DuckDB (seconds), cached by window hash. Lifetime-ROI + per-player drill-down → on-demand leg (stay slower, by design).
- **Size:** ~0.3–1 GB/yr. Fits VDI disk.

### Stores (nightly materializations)
- **A — daily money rollup** (date, SITE_edit, Currency): 7 local sums + 4 USD sums → Brands-overview, whole-book deposit. *Purely additive.*
- **B — member active-day** (member, date, currency; rows where dep>0 OR ngr≠0): dep, NGR, GGR → segment_map, trial_band, migration.
- **C — enriched per-claim fact** (one row per claim): bonus; pre/fwd NGR+DEP 7/30/60/90; decayed ROI lift; came-back flags; trigger bucket; qualifying qtime/qdep → ROI/forward tabs, deposit behaviour.
- **D — deposit-day adjacency** (member, deposit-day + preceding in-scope claims/codes per W) → distinct/equal-split/time-decay/money-back.
- **E — member dimension** (member → tier, trial, SITE, as-of-now).
- **F — control cohort (MY)** (sampled member × month-anchor) → matched DiD.
- **G — config cache** (per-code: deposit_required, min_deposit, pillar/mechanic) — window-independent.
- **(+) lifetime** (member → all-history NGR-to-date).

## Per-tab verdict (honest)
- **Instant for ANY window (pure daily re-sum):** Brands-overview money tab (the "company dashboard" one), whole-book deposit, per-code counts.
- **Seconds for any window (local filter + re-aggregate):** forward-ROI tabs, segmentation grids, cross-code deposit splits, migration, who-targeted, verify-action, repeat-claimers, DiD.
- **Cannot be truly instant (on-demand leg):** lifetime-ROI column (horizon = window length), per-player drill-down (member-grain, already behind sign-in gate).
- **Custom-window fallback:** brief "computing… ~N s" from local store, then cache by window hash.

## Correctness — these MUST recompute from stores, NEVER pre-sum (naive window-sum drifts)
1. Distinct-deposit dedup (per-code sum = the "overlapping" ~1.06× number, not distinct) → Store D.
2. Equal-split denominator N (= in-scope codes claimed within W) — changes with the window's code set; `sum(byCode)+unattributed == distinct` must foot.
3. Non-additive aggregates: median (timing/med_dep/speed), uniqExact (depositors/claimants), topK (dom_tier) — keep per-entity rows, never average stored percents.
4. Per-member band = multiIf over full-window cumulative deposit — derive AFTER the window sum.
5. Min-claim-in-window re-anchor — key each claim; pick min-in-window at query.
6. Maturity at the window EDGE (AS_OF = END_EXCL) — re-mature trailing 90d nightly, then filter.
7. ROI concurrency denominator over the member's FULL bonus calendar, not the report-code subset.
8. Grain-B member-first-claim never summed from per-code grain-A (double-counts).
9. A + _BC unioned BEFORE per-member GROUP BY (disjoint brand partitions).
10. Existence flags (redep_60/90, cb7–90) are not additive — store per-claim-per-window.

## Guardrails (from the independent design review — PROCEED-WITH-CHANGES)
- **Reconciliation gate (HARD release gate):** each night rebuild ONE canonical window from the local store AND run the old remote pipeline for it; diff every cell. If any drifts beyond existing tolerances (±RM50 alloc, ±RM300 trend), alarm and keep serving the previous good store.
- **Staleness explicit:** stamp every view "as of <last-complete-day>"; default landing window always pre-rendered (first paint never waits); on nightly failure serve last-good with a visible stale badge + alarm — never silent.
- **Build MY-first**, then parameterize the `-MY`-hardcoded stages for SG; keep both markets in sync.

## Tasks

### Phase 0 — hardcoded-window bug fix (independent of pre-agg)
- [x] **Fix `phase2_fatigue.py`** — START/CLAIM_END/SNAP_LO/SNAP_HI/as_of were hardcoded Jan–Jul/Aug 2026; now derived from the csir_config date seam. Verified: default reproduces old values exactly (CLAIM_END 2026-07-27, Jan–Aug anchors); custom Jan–May shifts correctly.
- [x] **Fix `phase1_control_pull.py`** — ANCHORS hardcoded Jan–Aug; now generated from START..END_INCL months. Verified same way.
  - Result: ✅ both compile; default byte-identical to old hardcodes (zero regression); custom windows now correct. Live on next build (worker builds from OUTER working tree). NOT yet backed up to github.

### Phase 1 — Brands-overview instant (lowest risk, highest visible win)
- [x] Build **Store A** builder (`bin/preagg/build_store_a.py`) — (date×SITE_edit×Currency) raw daily sums of 7 local + 4 USD cols, UNFILTERED. Ran: 8,545 rows, 2026-01-01..2026-10-06, atomic JSON (no DuckDB needed — Store A is tiny; DuckDB is for Phase-3 stores).
- [x] Window-summer (`bin/preagg/macro_from_store_a.py`) — re-sum range → round 7 locals → HAVING round(d)>100000 AFTER → company USD over survivors → ratios from summed components. Mirrors macro_pull exactly.
- [x] Reconciliation gate (`bin/preagg/reconcile_store_a.py`) — LIVE macro_pull SQL vs STORE re-sum, 3 windows (Jan-May / March / Jan-Aug): **ALL PASS** within ±RM1 (= the live warehouse's own float-rounding wobble; Store A itself is deterministic). Speed: load 42ms + re-sum 16ms ≈ **58ms** vs the warehouse path.
  - Result: ✅ CORE PROVEN — Store A reproduces Brands-overview for any window in ~60ms, reconciled exact. Files uncommitted; not yet wired to serve path.
- [x] **JS summer** (`bin/preagg/store_a_macro.mjs`) — the dashboard server is Node, so the window-summer is ported to JS for a per-request macro endpoint. Verified byte-identical to the Python summer (hence the warehouse) across 3 windows × all fields. Gotcha fixed: JS `Math.round` rounds half-up; the warehouse/python use banker's (round-half-to-even) — a sum landing on exactly .5 differed by 1 until `rhe()` matched it.
- [x] Server endpoint `/api/promo/:brand/macro?start=&end=` in `promo.js` — gated like refresh, reuses parseRefreshWindow bounds, reads `<brandDir>/store_a.json`, `macroServe` → `{ok,macro,builtAt,window}` or `{ok:false,reason}` (fallback). TZ bug fixed (UTC-safe date math).
- [x] Template: overridable `MACRO` global; macro-tab reads repointed; `loadMacro()` fetches the endpoint and re-renders JUST the Brands-overview on a window change (full Refresh still rebuilds all tabs). "⚡ overview updated instantly" indicator.
- [x] **LOCAL DEMO PASSED** (`scratchpad/demo-server.mjs`, real template + real macroServe + real report.json over HTTP): picked "Last month" → Brands-overview switched to Sep 2026 in ~3–14ms, numbers IDENTICAL to the full 3-min September build (US$28.8m, WS1 RM41.05m, 17.8% margin). Endpoint verified for Jan-May/Q1/Last-90d/default.
- [x] **Relay publish** — `/api/relay/promo/ws1/store-build` (qc-dashboard.mjs) HMAC-validates + atomic-swaps a pushed `store_a.json`; `bin/publish-store-a.mjs` ships it (mirrors the report-build worker auth). `store_a.json` gitignored. Verified: local round-trip 200 + prod round-trip 200.
- [x] **Nightly** — `~/.qc-relay/promo-store-a-nightly.bat` (build_store_a.py → publish-store-a.mjs) + hidden `.vbs` launcher + Windows scheduled task "Promo Store A nightly" DAILY 10:15 (no black window). Tested: build+publish in ~2s, exit 0.
- [x] **DEPLOYED 2026-10-06** — `9c86a15` → bitbucket/main (Ansible + Node restart confirmed by the prod store-build 200). Verified LIVE on https://qc-dashboard.zoom66.xyz/promo/ws1: /macro ok:true (Sep matches full build exactly — US$28.8m, WS1 RM41.05m), button "↻ Generate", instant picker switch Jan–May→Sep with NO caption (silent). **Phase 1 COMPLETE + LIVE.**

### Phase 2 — pre-render standard-window full reports nightly — DEPLOYED + LIVE 2026-10-06 (`8781570`+`99615cc`)
- [x] report-build relay: `x-refresh-window` header → `report.<key>.live.json` (no jobId = pre-build); serveReport `?w=<key>` serves it (fallback report.live.json/report.json); injects `window.__PREBUILT__`.
- [x] Template: pre-built preset navigates to `?w=<key>` (WHOLE report instant); picker reflects the loaded window; non-pre-built presets keep the Phase-1 money switch.
- [x] `bin/prebuild-standard-windows.mjs` builds+publishes each window; folded into the nightly `.bat` (store-a + prebuild). Fixed `phase2_fatigue` thin-window crash (empty repeat-claim list on a 1-month window → empty result).
- [x] **Activated + verified LIVE**: `__PREBUILT__=[ytd,lastmonth,last90]`; `?w=lastmonth` serves the whole Sep report instantly (period 2026-09-01..2026-10-01, all tabs). **Phase 2 COMPLETE.**
- [x] **Default landing → YTD (deployed `7478dd4`)**: no `?w=` now serves `report.ytd.live.json` (the nightly YTD pre-build) instead of the last custom report; the last custom Generate is preserved at `?w=latest` (report.live.json), the Generate flow navigates there on completion, and the picker reflects it as "Custom" + the loaded dates. Verified locally (default→YTD, ?w=latest→custom with picker dates filled).
- **Minor/deferred:** `code_players_pull` (gated per-player drill-down) hits a ClickHouse `IN` error on a thin recent window — OPTIONAL stage, build publishes anyway, drill-down just lacks data for recent windows.

### Phase 3 — Stores B, C, D → custom windows recompute locally in seconds
- [ ] Materialize B/C/D nightly (re-mature trailing 90d).
- [ ] Port the window-recompute SQL to DuckDB (honor all 10 traps); reconcile each tab.
- [ ] Retire the 3-min remote path for custom windows.

### Phase 4 — long tail
- [ ] Store F + attribution DiD; lifetime-ROI on-demand leg; per-player lazy drill-down.
- [ ] SG parameterization of the `-MY`-hardcoded stages.

## Notes
- Each phase is independently shippable; unmigrated parts stay on the existing remote path → no big-bang risk.
- Nothing is committed/pushed/deployed without the owner's explicit go.
