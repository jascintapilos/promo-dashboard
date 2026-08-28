# Plan: VIP report — decision layer, Phases 0 & 1

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** COMPLETED
**Created:** 2026-08-28
**Goal:** Ship the floor/band relabel (P0) and the arithmetic-only decision surfaces (P1 — Decision Box, Decision register, Cost-of-being-wrong) into the VIP panel, so a CEO can approve the decide-now floor immediately and see the priced downside of every cut — with no new data pulls.
**Architecture:** One new Python builder (`bin/vip_report/decision_layer.py`) reads the existing `scratchpad/vip/vip-metrics-MY.json` (+ member-level scratchpad source) and merges a `decision` block (floor/band figures + per-tier per-member NGR + whale break-even counts) back into that JSON. The template `templates/acq-dashboard.html` gains a Decision Box `leadSec`, upgrades `v_moves` into a decision register, and adds a cost-of-being-wrong card — all reading `VIP.decision`. Every new card gets a `CALC_DATA` "how this is calculated" note and a `READ_DATA` "how to read this" note (house rule). No ClickHouse pulls; all numbers come from existing scratchpad data.
**Tech/Tools:** Node build (`bin/build_acq_dashboard.mjs`), Python 3 (existing `bin/vip_report/` pattern), Browser-pane verify against `http://127.0.0.1:8899/acq-dashboard-MY.html`, Artifact publish to the existing URL.
**Design:** `projects/promo-value-creation/plans/2026-08-28-vip-report-ceo-decision-layer-design.md` (PROPOSED → this plan implements Phases 0 & 1 only).

## Key facts the executor MUST know (verified 2026-08-28)
- Report is a single self-contained theme-aware HTML. Build: `node bin/build_acq_dashboard.mjs` reads `scratchpad/vip/vip-metrics-MY.json` wholesale and injects it at the `/*__VIP_PAYLOAD__*/ null` marker → `const VIP`. **Because the whole JSON is passed through, adding a `decision` key to that JSON needs NO build-script change** — the template can read `VIP.decision` directly.
- Scratchpad root (member-level data lives here, NEVER commit to git): `C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad`. VIP metrics: `<SCR>/vip/vip-metrics-MY.json`.
- **Real payload fields available now:** `program.subsidy_rm` = 1957745 (the −RM1.96M hero number); `money_to_move.laneA_stop_reduce` = 3293448 (the RM3.29M band); `money_to_move.cashback_trim` = 464575; `money_to_move.cashback_review` = 1470405; `program.by_tier[]` each has `{tier, members, bonus, ytd_ngr, spend_share_pct, ngr_share_pct, funding_index, ...}`; `whale` = `{value_at_risk_members:262, value_at_risk_ngr:15335222, top1pct_ngr_share:33.9, top10pct_ngr_share:74.8}`.
- **The RM228k "certain" / RM375k "best-case" frequency-cap savings are HARDCODED literals** in the Lane A narrative (`templates/acq-dashboard.html` ~line 1486) — they are NOT in the payload. Task 4 makes them sourced payload fields so the break-even divides by real numbers. Their upstream derivation (member-level assignment log) already exists as scratch analysis; a Lane A cap holdout spec already exists at `bin/vip_report/frequency-cap-holdout-spec.md`.
- Per-tier per-member NGR (used for break-even) = `by_tier.ytd_ngr / by_tier.members`. Diamond ≈ 22631975/271 ≈ RM83.5k. This is **YTD realized NGR as a proxy for value-at-risk**, not forward LTV — every label MUST say so (forward LTV is a P2/P3 refinement).
- Template render helpers exist: `vM()`/`fmt` money format, `CV()` CSS var, `el()` SVG, `annotateCalc()` walker applies `CALC_DATA`/`READ_DATA` (JSON literals) to `closest('.card')` BEFORE `buildPanel`. Delegated `.calc-h`→`.calc-b` toggle. `buildPanel('panel-vip',[…])` spec array order = display order; `leadSec`/`cardSec`/`cardById`/`byId`/`htmlSec` helpers.
- **CALC_DATA/READ_DATA re-injection** (if editing them as whole blocks) uses CRLF-aware regex: `/const CALC_DATA=[\s\S]*?;\r?\nconst CALC_KPI=/` and `/const READ_DATA=[\s\S]*?;\r?\n/`. Prefer targeted `Edit` on individual entries over whole-block rewrite.
- Verify loop: extract `<script>` → `node --check`; `node bin/build_acq_dashboard.mjs`; navigate `http://127.0.0.1:8899/acq-dashboard-MY.html?v=N` (bump N); `javascript_tool` DOM asserts; `read_console_messages onlyErrors:true` must be clean. Artifact URL: `https://claude.ai/code/artifact/b5e60fe2-bef0-4c29-ab19-1261c25fd619`, title "Promo Report", favicon 📊.

## File Map
- Create: `bin/vip_report/decision_layer.py` — computes the `decision` payload block from existing scratchpad data; merges it into `vip-metrics-MY.json`. One responsibility: floor/band figures + per-tier break-even inputs.
- Modify: `templates/acq-dashboard.html` — (P0) floor/band badges on `v_moves` + a decide-now/prove-first framing line; (P1) Decision Box `leadSec`, `v_moves`→decision-register table, new cost-of-being-wrong card, spec wiring, CALC/READ notes.
- Modify (regenerated, not hand-edited): `outputs/acq-dashboard-MY.html` — build output; committed at each checkpoint.
- No change needed: `bin/build_acq_dashboard.mjs` (passes the whole VIP JSON through).

---

## Tasks

### Task 1: Floor/Band visual vocabulary (badge CSS + legend)

- [x] **Task 1**
  - Result: ✅ Added `.fbadge`/`.fbadge.floor`/`.fbadge.band` + `.mvtag` styles (theme tokens `--scale`/`--gold`, color-mix). Verified floor badge computes to green rgb(28,156,88).

**Files:**
- Modify: `templates/acq-dashboard.html`

**Step 1:** Add two small badge classes in the `<style>` block near the other chip/label styles (search for `.lchip`): `.fbadge{display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:10px;letter-spacing:.02em}` plus `.fbadge.floor{background:color-mix(in srgb,var(--scale) 18%,transparent);color:var(--scale)}` and `.fbadge.band{background:color-mix(in srgb,var(--gold) 18%,transparent);color:var(--gold)}`. Use existing theme tokens only (`--scale` = act-now green, `--gold` = hold/caution) so it is theme-aware.
- Tool: `Edit`

**Step 2:** Confirm the tokens `--scale` and `--gold` exist in `:root` and the dark block.
- Tool: `Grep` for `--scale:` and `--gold:` in the file.
- Expected: both defined in light `:root` and under the dark media/`[data-theme]` block.

**Verify:** `Grep` shows `.fbadge.floor` and `.fbadge.band` present; no new hardcoded hex colors (tokens only).

---

### Task 2: Tag the three moves with floor/band + rationale (P0 core)

- [x] **Task 2**
  - Result: ✅ Tagged the three moves — Move 1 shows DO NOW + PROVE FIRST, Move 2 DO NOW, Move 3 PROVE FIRST; each with an .mvtag rationale (reused existing ~RM228k / RM3.29M narrative). DOM: 4 badges (2 floor, 2 band), 3 mvtags.
- Depends: Task 1

**Files:**
- Modify: `templates/acq-dashboard.html` (the `v_moves` render, ~line 1444)

**Step 1:** In each of the three `.mv` blocks in `document.getElementById('v_moves').innerHTML=…`, inject a `<span class="fbadge floor|band">` after the `.mva` action title, plus a one-line `.mvtag` rationale. Tagging (from the design, using existing narrative numbers only):
  - Move 1 "Shrink the big free bonuses": show BOTH — a `floor` badge on the concentrated defund ("~RM228k certain: the 2 flagship RM400+ no-deposit codes + Bronze over-funding — reversible, no test needed") and a `band` badge on the full amount ("full RM3.29M magnitude — needs the matched holdout before authorising").
  - Move 2 "Keep the Weekly Rescue clean": `floor` ("eligibility hygiene only — reversible, no test needed").
  - Move 3 "Keep the big players who are slipping": `band` ("reinvestment yield unproven — size it after the holdout").
- Tool: `Edit`
- Constraint: DO NOT invent new RM figures here — reuse the literals already in the block (`MM.laneA_stop_reduce`, `LS['B-cashback'].spend`, `W.value_at_risk_ngr`) and the existing "~RM228k" narrative wording.

**Step 2:** Add `.mvtag{font-size:12px;color:var(--muted);margin-top:4px}` to the style block if not present.
- Tool: `Edit`

**Verify:** After build, the three moves each show a floor or band badge; Move 1 shows both. (DOM check in Task 3's verify.)

---

### Task 3: Decide-now/prove-first framing line in Main findings (P0)

- [x] **Task 3**
  - Result: ✅ Added decide-now/prove-first framing sentence to v_exec Main findings. DOM: framing present. Build clean, node --check OK, zero console errors.
- Depends: Task 2

**Files:**
- Modify: `templates/acq-dashboard.html` (the `v_exec` content, referenced in `leadSec('Main findings',[…byId('v_exec')])`)

**Step 1:** Append one sentence to the end of the `v_exec` narrative establishing the frame BEFORE the moves are read: e.g. *"Read the actions in two buckets: a <b>decide-now floor</b> (reversible spend levers you can approve immediately) and a <b>prove-first band</b> (bigger cuts that wait on a matched test)."* Keep plain-language (house rule).
- Tool: `Edit`

**Step 2:** Run the P0 verify loop: extract `<script>`, `node --check`; `node bin/build_acq_dashboard.mjs`; navigate `?v=` bumped; `javascript_tool` assert `document.querySelectorAll('#v_moves .fbadge').length >= 4` and the framing sentence text is present; `read_console_messages onlyErrors:true`.
- Tool: `Bash` + Browser-pane tools
- Expected: badges present (≥4: Move1 floor+band, Move2 floor, Move3 band), framing sentence found, zero console errors.

**Verify:** Build clean, badges + framing render, no console errors.

---

→ CHECKPOINT (P0 ships standalone): Publish `outputs/acq-dashboard-MY.html` to the Artifact URL; commit `templates/acq-dashboard.html` + `outputs/acq-dashboard-MY.html`. Show the user the floor/band relabel and confirm before starting P1.

---

### Task 4: `decision_layer.py` — emit the `decision` payload block

- [x] **Task 4**
  - Result: ✅ bin/vip_report/decision_layer.py emits the `decision` block into vip-metrics-MY.json. Verified: hero RM1,957,745 (27%/1,964 members), band RM3,293,448, bronze_trim RM134,615, Diamond break-even 2.7 (floor)/39.4 (band). Frequency-cap savings now sourced fields, not literals.
- Depends: (none — data task)

**Files:**
- Create: `bin/vip_report/decision_layer.py`

**Step 1:** Write a Python script that: (a) loads `<SCR>/vip/vip-metrics-MY.json` (resolve `<SCR>` from an env var `VIP_SCR` with the known default path baked in as fallback); (b) builds a `decision` dict with:
  - `hero_subsidy_rm` = `program.subsidy_rm`;
  - `hero_subsidy_why` = a plain-language context string (verified against `bin/vip_report/02b_program.py`: `neg = members with ytd_ngr < 0`, `subsidy = sum of their vip_bonus`; NGR is already net of bonus). Wording: "This is the bonus we're spending on the ~27% of VIP members who cost more than they bring back — after their bonuses, the house nets negative on them. It is NOT the whole VIP program losing money: overall VIP roughly pays for itself and the top players are highly profitable. It's the slice of spend going to players who aren't paying it back yet — the pool worth redirecting." Also emit `hero_subsidy_share_pct` = `program.net_negative_share_pct` (27) and `hero_subsidy_members` = `program.net_negative_members`.
  - `floor` = list of decide-now items: `{key:"defund_flagship", label:"Defund 2 flagship RM400+ no-deposit codes", rm_certain:228000, rm_best:375000, source:"frequency-cap analysis (member-level assignment log); see bin/vip_report/frequency-cap-holdout-spec.md", reversible:true}`, `{key:"trim_bronze", label:"Trim Bronze over-funding (index 2.16)", rm: <Bronze bonus × over-funded fraction>, source:"by_tier funding_index"}`, `{key:"rescue_hygiene", label:"Weekly Rescue eligibility hygiene", rm:null, note:"perk — hygiene not ROI"}`;
  - `band` = `{key:"laneA_full", label:"Full Lane A stop/reduce", rm:money_to_move.laneA_stop_reduce, gated_on:"Lane A matched holdout", spec:"bin/vip_report/frequency-cap-holdout-spec.md"}`;
  - `breakeven` = per tier from `by_tier`: `{tier, ngr_per_member: round(ytd_ngr/members), defections_to_wipe_floor: round(228000 / ngr_per_member,1), defections_to_wipe_band: round(3293448 / ngr_per_member,1)}` for Diamond/Platinum/Gold/Silver/Bronze;
  - `basis` string stating: "per-member figure = YTD realized NGR / members (proxy for value-at-risk; forward LTV is a later refinement). Floor = reversible census-arithmetic levers, no holdout. Band = magnitude pending the matched holdout."
  Hardcode the 228000/375000 as named constants at the top WITH a comment citing the source (they originate from the member-level frequency-cap analysis; this script surfaces them as sourced fields rather than leaving them as narrative literals). Compute the Bronze-trim RM as `bronze.bonus - bronze.bonus/ funding_index` (the excess over a balanced 1.0), rounded.
- Tool: `Write`

**Step 2:** Merge `decision` into the loaded JSON and write it back to the same path (pretty-printed, `ensure_ascii=False`). Print a one-line summary of the block to stdout.
- Tool: `Write` (in same script)

**Step 3:** Run it.
- Tool: `Bash` — `python bin/vip_report/decision_layer.py`
- Expected: prints the summary; `<SCR>/vip/vip-metrics-MY.json` now has a top-level `decision` key.

**Verify:** `node -e` reads the JSON and prints `decision.hero_subsidy_rm` (1957745), `decision.band.rm` (3293448), and the Diamond break-even row (`defections_to_wipe_floor` ≈ 2.7, `defections_to_wipe_band` ≈ 39–40). Numbers reconcile with the narrative.

---

### Task 5: Decision Box `leadSec` at top of the VIP panel

- [x] **Task 5**
  - Result: ✅ Decision Box = VIP section 1, opens by default. DOM: hero RM1.96M with 663-char why-context in plain sight, Cut/Hold/Test rows, calc note. The `why` folds in the sharpened framing (upper bound on problem spend, not wasted lift, not the whole program losing money).
- Depends: Task 4

**Files:**
- Modify: `templates/acq-dashboard.html`

**Step 1:** Add a hidden source card `<div class="card col12" id="vipDecisionBox">…</div>` in the VIP markup with an empty `<div id="v_decisionBox"></div>`, and a render function `vipDecisionBox()` that reads `VIP.decision` and writes: (a) a verdict sentence + the hero number `vM(D.hero_subsidy_rm)` styled as the single big figure, **immediately followed by the `D.hero_subsidy_why` context in plain sight (NOT hidden in a collapsed note)** — the number must never appear bare; render the "27% / N members" and the "not the whole program losing money" clause right next to it; (b) a **Cut / Hold / Test** table for Lane A — CUT now = `vM(floor defund rm_certain)` certain / `vM(rm_best)` best (risk: unproven magnitude); HOLD = keep bleeding −0.71/RM on a worsening trend; TEST = run the holdout, decision delayed, cost-of-waiting = the Lane-A loss over the window; (c) a small floor/band legend. Guard with `if(!VIP.decision) return;`.
- Tool: `Edit`

**Step 2:** Call `vipDecisionBox()` in the VIP render sequence (near the other VIP render calls, before `buildPanel`). Insert `leadSec(null,[byId('vipDecisionBox')])` (or a titled `leadSec('The decision',…)`) as the FIRST entry in `buildPanel('panel-vip',[…])`, above the `htmlSec("What VIP is…")` method line — the Decision Box must be the very first thing.
- Tool: `Edit`

**Step 3:** Add `CALC_DATA['v_decisionBox']` (how the subsidy + cut figures are computed, citing `program.subsidy_rm` and the frequency-cap source) and `READ_DATA['v_decisionBox']` (how to read Cut/Hold/Test + floor vs band).
- Tool: `Edit`

**Verify:** Build; DOM assert `#v_decisionBox` contains the hero number text and a table with rows Cut/Hold/Test; it appears before the method section in `#panel-vip`.

---

### Task 6: Upgrade `v_moves` into the Decision register table

- [x] **Task 6**
  - Result: ✅ v_moves upgraded to Decision register (6 rows, 6 floor/band badges, 13 TBC markers). Columns Action(+risk)/Owner/Enforcement/RM/Gate·when/Type. Header → 'Decision register'. CALC/READ added.
- Depends: Task 4, Task 5

**Files:**
- Modify: `templates/acq-dashboard.html` (the `v_moves` render + its card header)

**Step 1:** Replace the three `.mv` cards with a register table: columns **Action · Owner · Enforcement · Gate · RM at stake · When · Type(floor/band)** and a per-row risk-of-acting sub-line. Rows from `VIP.decision` + design content. Owners/enforcement/dates render as **role placeholders explicitly marked "TBC — confirm"** (e.g. Owner "VM Lead (TBC)", Enforcement "BO eligibility cap + approval above size threshold — not VM discretion", When "TBC"): these are business inputs the user confirms, NOT to be presented as settled. Keep the floor/band badge in the Type column.
- Tool: `Edit`

**Step 2:** Update the card header from "The three big moves" to "Decision register" with hint "who · how · when · RM"; add `CALC_DATA['v_moves']` / `READ_DATA['v_moves']` describing the columns and the TBC convention.
- Tool: `Edit`

**Verify:** Build; DOM assert the register renders as a table with a header row containing "Owner" and "Enforcement", ≥3 action rows, each with a floor or band badge, and visible "TBC" markers on owner/when.

---

### Task 7: Cost-of-being-wrong card (break-even + sensitivity + stop-loss)

- [x] **Task 7**
  - Result: ✅ Cost-of-being-wrong card: 5-tier break-even table (Diamond floor 2.7 red-flagged), headline (~2.7 Diamonds wipe floor / ~39 = ~14% wipe band, 262 slipping), stop-loss note, competitor-benchmark placeholder. CALC note carries the YTD-realized-NGR-proxy caveat.
- Depends: Task 4

**Files:**
- Modify: `templates/acq-dashboard.html`

**Step 1:** Add a `<div class="card col12" id="vipCostWrongCard">` with an empty `<div id="v_costWrong"></div>` and a render `vipCostWrong()` reading `VIP.decision.breakeven`: (a) a break-even table per tier — Tier · NGR/member (YTD) · defections that wipe the floor (~RM228k) · defections that wipe the band (RM3.29M), with Diamond/Platinum highlighted; a headline line "≈{{Diamond floor}} Diamond defections erase the certain saving; ≈{{Diamond band}} (~14% of Diamonds) erase the full RM3.29M — and 262 whales are already slipping"; (b) a small savings×churn sensitivity note/grid marking the net-zero point; (c) a stop-loss note (phased rollout: cap a random subset, hold the rest as control, auto-reverse on a defined deposit-frequency drop, release in halt-able tranches); (d) a one-line "Competitor benchmark — coming with the holdout (P3)" placeholder. Guard `if(!VIP.decision) return;`.
- Tool: `Edit`

**Step 2:** Add `CALC_DATA['v_costWrong']` — MUST state the per-member figure is YTD realized NGR as a proxy, not forward LTV (label-honesty rule) — and `READ_DATA['v_costWrong']`.
- Tool: `Edit`

**Verify:** Build; DOM assert the break-even table has the 5 tier rows and the Diamond headline; CALC note contains the "YTD realized NGR … proxy" wording.

---

### Task 8: Wire cards into the VIP spec, full build & browser verify

- [x] **Task 8**
  - Result: ✅ Spec order verified: Decision Box first (before method); Cost-of-wrong after whale ledger; Decision register closes the answers block. Build clean, node --check OK, consolidated DOM assert all-true, zero console errors.
- Depends: Task 5, Task 6, Task 7

**Files:**
- Modify: `templates/acq-dashboard.html` (`buildPanel('panel-vip',[…])`)

**Step 1:** Ensure spec order in the "answers" block is: Decision Box → method (`htmlSec`) → Main findings → coverage → sweet-by-tier → deposit split → whale concentration → whale ledger → **Cost-of-being-wrong** (`cardSec(byId('vipCostWrongCard'))`, place right after the whale ledger) → **Decision register** (`cardSec(cardById('v_moves'))`, keep as the closing action card). Confirm each new `byId/cardById` matches an existing element id.
- Tool: `Edit`

**Step 2:** Full verify loop: extract `<script>` → `node --check`; `node bin/build_acq_dashboard.mjs`; navigate `?v=` bumped; run a single `javascript_tool` block asserting all P1 elements exist and are ordered (Decision Box before method; cost-wrong before register); `read_console_messages onlyErrors:true`.
- Tool: `Bash` + Browser-pane tools
- Expected: all asserts pass, zero console errors.

**Verify:** One consolidated DOM assertion returns all-true; console clean; `node bin/build_acq_dashboard.mjs` prints the VIP summary line without error.

---

→ FINAL (P1 ships): Publish `outputs/acq-dashboard-MY.html` to the Artifact URL; commit template + output + `bin/vip_report/decision_layer.py`. **Do NOT commit anything under scratchpad** (member-level). Report to the user where each new surface appears (VIP tab: Decision Box at top; Cost-of-being-wrong after the whale ledger; Decision register as the closing action card) and flag the TBC owners/dates + the YTD-NGR-proxy caveat for their confirmation. Update this plan's Status to COMPLETED.

## Out of scope (deferred to P2/P3 per the design)
- Reallocation-return panel (cost-per-retained-whale, marginal-return curve, migration funnel) — needs a compute pass (P2).
- Trend decomposition + do-nothing counterfactual (P2). Monthly operating system / whale-slip alert (P2).
- Scope/compliance notes; competitor benchmark data; running the actual Lane A holdout (P3).

## Open items to raise at the P0 checkpoint (need user input before P1 finalises)
1. **Owners & dates** for the decision register (Task 6) — rendered as "TBC" until confirmed. Who owns: pulling the flagship codes, the size cap, the reinvestment pilot, the holdout?
2. **SG scope** — confirmed out of scope for this report? (Affects later phases, not P0/P1 build.)
3. **Break-even basis** — OK to use YTD realized NGR/member as the value-at-risk proxy for now (clearly labelled), with forward-LTV as a P2 refinement?
