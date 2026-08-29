# Plan: Whale decision-metrics — P1 (coarse metrics + save-list + reframe)

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** COMPLETED
**Created:** 2026-08-29
**Goal:** Turn the Big-player detection tab from "here are the whales, 44 are cooling" into a decision tool: a ranked **weekly save-list** (who to act on first), a **coarse churn-risk score + recoverability** on every whale, a **bonus-efficiency placeholder** (real 30/60/90 comes with the pull), and a **Main-findings reframe** that leads with the non-obvious instead of Pareto. No new pull.
**Architecture:** `bin/vip_report/whale_detection.py` gains a per-whale risk/recoverability/save-value computation (deposit decline from member-ledger `dep_h1/dep_h2` + dormancy = days since last claim from `claim-rows`), emitting `whale_pillar.roster[]` enriched fields + `whale_pillar.save_list` + `whale_pillar.efficiency`. The whale tab (`templates/acq-dashboard.html`) gets a Save-list card (leads the analysis), risk bands on the roster, a bonus-efficiency placeholder card, and a rewritten `w_meta` Main-findings. All from existing scratchpad data; opaque refs only.
**Tech/Tools:** Python 3 (`bin/vip_report/`), Node build, Browser-pane verify, Artifact publish. Reuse whale-tab render helpers + `.dreg`/`.fbadge`/`.varbox`/`.ngrstrip`/`vM`/`fmt`/`VSYM`.
**Design:** `projects/promo-value-creation/plans/2026-08-29-whale-decision-metrics-design.md` (APPROVED). P2 (the deposit-series + forward-NGR pull → real leading signal + real 30/60/90 efficiency) is a separate plan.

## Key facts the executor MUST know
- **Data (no pull):** `<SCR>/vip/member-ledger-MY.json` (7,410 rows: `member`, `vip_bonus`, `ytd_ngr`, `ytd_ggr`, `dep_h1`, `dep_h2`, `tier_end`, …); `<SCR>/vip/claim-rows-MY.json` (64,574 rows: `member`, `claim_date`, `recency_days`, …). `<SCR>` = the session scratchpad (resolve via `VIP_SCR` env with the baked default, as in `whale_detection.py`). `data_as_of` = **2026-08-26** (from `vip-metrics-MY.json`).
- **whale_detection.py already** builds `whale_pillar` (definition/roster/roster_stats/cooling/rising/downside/reinvest/decision) from `member-ledger` + `vip-metrics`; `ref = SHA1(memberId)[:6].upper()`; roster = top-74 by `ytd_ngr`. Extend it — don't rewrite.
- **Coarse formulas (from the design):**
  - `drop_norm = clamp((dep_h1 − dep_h2)/dep_h1, 0, 1)` (0 if dep_h1 ≤ 0)
  - `dormancy_days = (2026-08-26 − latest claim_date for that member)`; `dormancy_norm = clamp(dormancy_days/60, 0, 1)` (no claims → 1.0)
  - `risk = round(100 × (0.65·drop_norm + 0.35·dormancy_norm))`; bands **High ≥60 · Med 35–59 · Low <35**
  - `reachable = band≠Low AND (dormancy_days < 45 OR dep_h2 > 0)`; else "likely gone"
  - `save_value = round(ytd_ngr × risk/100)`
  - `eff_coarse = round(ytd_ngr / max(vip_bonus,1), 1)` — single-ratio PLACEHOLDER, labelled "30/60/90 pending pull"
  - `why` string, e.g. `deposits −48% H1→H2 · last active 22d ago`
- **Privacy:** opaque `ref` only in any surfaced/committed view; raw `member` stays in scratchpad; assert roster/save_list carry no `member`.
- **Honesty labels:** the coarse risk is "directional, only slightly ahead of the cooling flag; a genuine early warning once the deposit pull lands." Bonus efficiency is a placeholder until the pull. Retention *proof* stays with the holdout (P3) — don't imply it here.
- **Whale buildPanel spec** (`buildPanel('panel-whale',[…])`): currently whale-call → concentration → roster → at-risk ledger → rising → does-the-bonus-keep-them → why-protect → Notes. The **Save-list leads the analysis**: insert right after the whale call.
- **Verify/publish** as prior phases (node --check → build → click `[data-tab="whale"]` → DOM assert → console clean; Artifact URL b5e60fe2…, title "Promo Report", favicon 📊). Run `whale_detection.py` before building.

## File Map
- Modify: `bin/vip_report/whale_detection.py` — per-whale risk/recoverable/save_value/why/eff on `roster`; emit `save_list` + `efficiency`.
- Modify: `templates/acq-dashboard.html` — Save-list card + render + wire; risk band on the roster table; bonus-efficiency placeholder card; `w_meta` reframe; CALC/READ.
- Modify (regenerated): `outputs/acq-dashboard-MY.html`.

---

## Task 1: `whale_detection.py` — coarse risk, recoverability, save-value per whale

- [x] **Task 1**
  - Result: ✅ Per-whale coarse risk (65% decline + 35% dormancy-from-claim-recency), band, reachable, save_value, eff_coarse, why. Bands: High 11 / Med 18 / Low 45.

**Files:** Modify `bin/vip_report/whale_detection.py`

**Step 1:** Load `claim-rows-MY.json`; build `last_claim[member] = max(claim_date)`. Parse `data_as_of` (2026-08-26) once; `dormancy_days = (as_of − last_claim).days` (large cap, e.g. 999, if the member has no claims). Tool: `Edit`.

**Step 2:** In the roster loop (the top-74), for each whale compute `drop_norm`, `dormancy_norm`, `risk`, `band`, `reachable`, `save_value`, `eff_coarse`, and a `why` string, and add them to each roster row. Assert still no `member` key on roster rows. Tool: `Edit`.

**Verify:** `python bin/vip_report/whale_detection.py` prints, for the top few whales, risk/band/reachable/save_value; Diamond top whales that are cooling show High/Med bands; opaque refs only.

---

## Task 2: `whale_detection.py` — `save_list` + `efficiency` blocks

- [x] **Task 2**
  - Result: ✅ save_list (top-10 reachable by save_value; 29 reachable, RM3.37M pool) + efficiency placeholder (median 11.4/RM, 19 over-fed, 12 under-attended). Asserted no raw member ids. — Depends: Task 1

**Files:** Modify `bin/vip_report/whale_detection.py`

**Step 1:** `save_list` = roster filtered to `reachable`, sorted by `save_value` desc, top 10 → `[{ref,tier,ytd_ngr,save_value,risk,band,why}]` + a `total_reachable` count and `total_save_value`. Tool: `Edit`.

**Step 2:** `efficiency` = summary for the placeholder card: counts of `over_fed_steady` (band=Low & eff_coarse high) vs `under_attended_cooling` (band≠Low & below-median eff_coarse), the median `eff_coarse`, and a `pending: "real 30/60/90 forward efficiency lands with the pull"` note. Merge both into `whale_pillar`; print a summary. Tool: `Edit` + `Bash`.

**Verify:** JSON `whale_pillar.save_list` has ≤10 reachable whales ranked by save_value (opaque refs); `efficiency` has the two flag counts + median + pending note.

---

→ CHECKPOINT A: build + browser-verify Task 3's card too, then show the user the **Save-list** (the headline deliverable) before the rest.

---

## Task 3: Save-list card — the weekly "call these" (leads the analysis)

- [x] **Task 3**
  - Result: ✅ Save-list card renders right after the whale call: 10 rows, opaque refs, risk chips, 'why' flags (e.g. C5D995 Diamond High RM644,908 'deposits −59% · last claim 80d ago'). CALC/READ added, console clean. — Depends: Task 2

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** Add `<div class="card col12" id="w_saveListCard">…<div id="w_saveList"></div></div>` in `#panel-whale`; render (guarded on `VIP.whale_pillar.save_list`) a table **Rank · Player · Tier · RM at risk · Risk · Why** (risk band as a coloured chip; reuse `.dreg`), a lead line ("Act on these N this week — reachable whales ranked by what's at stake"), and a footnote that the score is coarse/directional until the deposit pull. Tool: `Edit`.

**Step 2:** Wire `cardSec(byId('w_saveListCard'))` **immediately after** `cardSec(byId('w_decisionCard'))` in `buildPanel('panel-whale')`. Add `CALC_DATA['w_saveList']` (risk/save_value formulas + coarse caveat) + `READ_DATA['w_saveList']`. Tool: `Edit`.

**Verify:** Whale tab shows the Save-list right after the whale call, ≤10 rows, opaque refs, risk chips; console clean.

---

## Task 4: Risk band on the roster + reachable status

- [x] **Task 4**
  - Result: ✅ Roster status column now shows the risk band chip (High/Med/Low) + 'likely gone' + drop%. — Depends: Task 1

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** In the roster render (`w_roster`), replace the plain "steady/cooling" status with the **risk band chip** (High/Med/Low, coloured) + reachable/gone, using the new roster fields. Keep the NGR-strip and 74 rows. Tool: `Edit`.

**Verify:** Roster shows a risk band per whale; cooling whales carry High/Med; console clean.

---

## Task 5: Bonus-efficiency placeholder card

- [x] **Task 5**
  - Result: ✅ 'Is the bonus spend working?' placeholder card: median 11.4/RM, 19 over-fed / 12 under-attended, prominent '30/60/90 pending pull' note. — Depends: Task 2

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** Add `w_effCard` (`#w_eff`) reading `whale_pillar.efficiency`: a short read — median return per RM, count **over-fed & steady** (trim) vs **under-attended & cooling** (fund) — with a prominent **"30/60/90-day view pending the deposit pull"** note (so it reads as a placeholder, not a finished metric). Wire near `w_reinvestCard`/`vipCostWrongCard` (the spend/decision area). CALC/READ. Tool: `Edit`.

**Verify:** Efficiency card renders the two flag counts + the pending-pull note; console clean.

---

## Task 6: Main-findings reframe (`w_meta`)

- [x] **Task 6**
  - Result: ✅ Main findings reframed — leads with under-funded (22.2% bonus / 33.9% value) + unproven retention + '10 cooling whales worth saving this week' (save-list link); Pareto demoted to a footnote. — Depends: Task 2

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** Rewrite the `w_meta` render to LEAD with the non-obvious and the action, Pareto demoted: e.g. *"The players who carry the book are **under-funded** (22% of bonus for 34% of value), we **can't yet prove our bonuses keep them**, and **{N} cooling whales are worth saving this week** (see the save-list). [footnote] A thin slice runs the book — top 1% = 34% of net revenue."* Keep the "See the 74 →" link. Pull N + the under-funded figures from `whale_pillar` (`save_list.total_reachable`, `definition.ngr_share`/`bonus_share`). Tool: `Edit`.

**Verify:** Main findings leads with under-funded + unproven + save-count; the Pareto line is a trailing footnote, not the headline.

---

## Task 7: Full build & browser verify → FINAL

- [x] **Task 7**
  - Result: ✅ Full build clean, DOM verified (findings reframed, roster bands, save-list leads, efficiency placeholder), zero console errors. — Depends: Tasks 3,4,5,6

**Files:** Modify `templates/acq-dashboard.html` (fixes only)

**Step 1:** Run `whale_detection.py`; build; `node --check`. Tool: `Bash`.

**Step 2:** DOM verify on the whale tab: Save-list leads (after whale call), risk bands on roster + save-list, efficiency placeholder with pending note, Main findings reframed, all refs opaque, console clean. Tool: `Bash` + Browser.

**Verify:** Consolidated assert all-true; zero console errors; build summary prints.

---

→ FINAL: Publish `outputs/acq-dashboard-MY.html`; commit template + output + `whale_detection.py` (**never scratchpad**). Status COMPLETED; update memory. Report the "data → decision" jump and flag P2 (the pull) as what upgrades the coarse signal + lights up real 30/60/90 efficiency.

## Open items (tune later, don't block)
1. Risk weights (65/35), bands (60/35), dormancy cap (60d), reachable cut (45d), save-list length (10) — defaults; tune on real names at Checkpoint A.
2. Whether the efficiency placeholder is its own card or folded into the reinvest/why-protect area.

## Out of scope (P2)
- The deposit-series + forward-NGR pull; the real leading churn signal; the real 30/60/90 bonus efficiency; the retention proof (holdout, P3).
