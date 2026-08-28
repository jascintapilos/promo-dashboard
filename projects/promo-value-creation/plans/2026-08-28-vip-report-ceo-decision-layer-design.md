# Design: VIP report — the CEO decision layer

**Status:** PROPOSED (awaiting approval → superpower-planning)
**Created:** 2026-08-28
**Author context:** WS1 Promo Value Creation, VIP pillar. Report = `templates/acq-dashboard.html` (VIP panel), built by `bin/build_acq_dashboard.mjs` from `scratchpad/vip/vip-metrics-MY.json`.
**Audience of the report:** HOD and CEO (decision-makers), not analysts.

## Goal (one sentence)
Turn the VIP report from a **diagnosis** ("where the money bleeds and why") into a **priced, executable, board-defensible decision tool** — so a CEO can approve the low-regret moves *this week* and see exactly what the rest is worth and when it will be proven.

## Why (the problem this solves)
An 8-lens CEO panel reviewed the current report. Verdict: it is the best VIP *diagnosis* they've seen — the four-lane split, the concentrated kill list (~2 codes = half the Lane A loss), the funding-index tier dial, the whale-at-risk figure, and its honesty about causal limits are all genuine strengths and must be preserved. But it stops one layer short of a decision:

1. The (correct) rigor-caveats **blanket every move equally**, so the whole thing reads "come back when proven" — the *safe* RM228k action is poisoned along with the risky RM3.29M one.
2. It sizes the **cut** but never the cut's **downside** (no whale-defection break-even) or the reinvestment's **return** (no cost-per-retained-whale).
3. The biggest-dollar move (RM3.29M) rests on a matched holdout the report **admits it hasn't run**.
4. It names **no owners, no enforcement, no sequencing** — the free-credit cap is a control on *staff behaviour* (81% VM-assigned, 0% self-claimed), not a BO toggle, so without a mechanism it is fictional.
5. There is **no top-of-page verdict / hero number**, so it can't be defended in a five-minute board slot.

## Core architectural decision — the FLOOR vs BAND spine
Every recommendation in the report is tagged one of two ways, and this tag drives all rendering:

- **DECIDE-NOW FLOOR** — reversible spend levers grounded in census arithmetic, needing **no holdout**: defund the ~2 flagship RM400+ no-deposit codes (~RM228k certain), trim Bronze's 2.16 over-funding, Weekly-Rescue eligibility hygiene. *Approvable Monday.*
- **PROVE-FIRST BAND** — magnitudes that need the **matched holdout** before authorising: the full RM3.29M stop/reduce, the +0.48/RM sweet-spot sizing, "feed Diamond." *Gated, with a read-out date.*

This single split is the highest-leverage change (six of eight lenses converged on it): it converts the report's honesty from a reason to **defer** into a reason to **approve**, and it is the precondition that makes the break-even, the reinvestment P&L, and the decision register actionable rather than academic.

## The eight components (what gets built)

Grouped by the four new **decision surfaces** + supporting analytics. Each references where it slots into the existing `buildPanel('panel-vip', …)` "answers" block.

### A. Decision surfaces (new/upgraded cards, top of the VIP "answers" block)

1. **Decision Box** *(new `leadSec`, very top of VIP panel — before "Main findings")*
   - One-line **verdict** + a single **hero number**: the **−RM1,957,745 subsidy** (today buried among RM8.46M spend / RM40M NGR).
   - A **Cut / Hold / Test** table for Lane A: CUT now = RM228k certain / RM375k best (risk: unproven magnitude); HOLD = keep bleeding −0.71/RM on a worsening trend; TEST = run the holdout, decision delayed N weeks, cost-of-waiting = Lane-A loss over that window.
   - A **decide-now vs prove-first** band that visibly separates the Monday actions from the gated ones.

2. **Decision register** *(upgrade of the current `v_moves` "three big moves" card)*
   - One row per action: **owner · enforcement mechanism · go/no-go gate · RM at stake · date · floor/band tag · risk-of-acting note**.
   - Load-bearing detail: the cap row's enforcement is a **hard BO eligibility guardrail + approval above a size threshold**, explicitly *not* VM discretion.

3. **Cost-of-being-wrong panel** *(new card, in the answers block near the whale ledger)*
   - **Whale-defection break-even** under each cut: `RM saving / per-tier per-member NGR = # defections that wipe it`. From printed data: Diamond ≈ RM83k NGR each → **~3 defections erase the RM228k, ~40 (14% of Diamonds) erase the RM3.29M.**
   - A **savings × incremental-churn-rate sensitivity grid** with the net-zero frontier marked.
   - A **phased-rollout stop-loss**: cap a random subset first, hold the rest as control, define the deposit-frequency drop that auto-reverses, release in halt-able tranches.
   - A **competitor benchmark**: is RM400+ no-deposit credit market-matching (whales defect to a rival still offering it) or genuine waste?

4. **Reallocation-return panel** *(new card, answers block, after the whale ledger)*
   - Per move: `capital delta → expected NGR delta (with confidence band) → net P&L`, every band gated on the holdout.
   - **Cost-per-retained-whale** (retention spend / whales retained) and an **expected recoverable fraction of the RM15.3M** per RM of small deposit-tied bonus.
   - A **marginal-return-by-tier curve** (return on the *next* RM) replacing "Diamond starved" as the basis for "feed Diamond" — funding_index is a share ratio, not a marginal curve.
   - A **reclaimable-amount estimate against the RM2.14M Rescue** given the ≤2.7pp lift over a 96% base rate (kept as a perk, but the number is shown, not framed away).
   - A **tier-migration funnel** (Silver→Diamond promotion rates) so the CEO funds the whale *pipeline*, not only defends the top.
   - A single **"total VIP NGR upside at stake if all three moves execute"** figure, carrying the directional caveat.

### B. Supporting analytics (deeper cards / notes)

5. **Trend decomposition + do-nothing counterfactual** *(upgrade the existing trend view)* — split the degrading 8-month line into mix (rising no-deposit share at −0.12/RM) vs tier-softening vs the at-risk whales already dragging vs seasonality; name the 1–2 monthly watch-metrics; project act-vs-do-nothing so "it's getting worse" becomes a priced **cost-of-inaction**.

6. **Monthly operating system** *(new scaffolding + notes)* — per-move tracker rows with **baseline locked as of 2026-08-26**; a **leading-indicator strip** (days-since-deposit, deposit frequency, no-deposit share, funding_index by tier) with prior-period deltas; a **whale-slip alert** (any top-1%/top-10% member whose trailing-4wk deposits drop >X% vs trailing-8wk auto-flags to the owning VM, tracked against the RM15.3M pool).

7. **Scope & compliance notes** *(new notes block)* — state explicitly whether **SG VIP** exists and is out of scope by design or simply missing, and whether the policy is meant to generalise across markets; a **responsible-gaming read** on rebating losses (98% of Rescue claimers were losing) and post-deposit-bonus mechanisms; a line on **VM compensation** — does comp reward bonus *volume* or *net player value* (the data — 81% VM-assigned, 0% self-claim, −0.71/RM — points at the incentive, not just the tool).

### C. The experiment that resolves the BAND

8. **Matched holdout on the flagship codes** — extend the existing cashback-holdout discipline to Lane A: randomly hold out ~half of eligible claimants on the two RM400+ no-deposit flagship codes for 2–4 weeks; measure 30/60/90-day NGR **and** deposit-frequency/defection delta (treated vs held-out); report as a confidence band, not a point. Give it a start date, sample/power, read-out date, go/no-go gate, and the interim policy until read-out. Apply the same base-rate/upper-bound discipline to Lane A (including a check that the headline ~RM40M NGR is not already net of bonus — avoid double-counting the loss).

## Sequencing (mapped to the holdout timeline)

- **Phase 0 — the relabel (today, zero data changes).** Classify existing recommendations into FLOOR vs BAND; pure presentation. Ships immediately, resolves the central tension on its own.
- **Phase 1 — arithmetic-only decision surfaces (this week, no new pulls).** Decision Box (#1), Decision register (#2), Cost-of-being-wrong break-even + sensitivity + stop-loss (#3) — all computable from figures already in `vip-metrics-MY.json`.
- **Phase 2 — compute passes (needs new `bin/vip_report/` builders, still no experiment).** Reallocation-return panel (#4, needs a forward-NGR/retention join + marginal-return curve), trend decomposition (#5), monthly-operating scaffolding (#6), scope/compliance notes (#7).
- **Phase 3 — the experiment (#8).** Launch the holdout; 2–4wk run; 30/60/90d read; then the BAND collapses to proven magnitudes and the Decision Box CUT numbers firm up. Competitor benchmark (#3) slots in here.

## File map (anticipated)

- **Modify** `templates/acq-dashboard.html` — new `leadSec` (Decision Box) at top of `buildPanel('panel-vip', …)`; upgrade `v_moves` → decision register; new cards for cost-of-wrong + reallocation-return; upgrade trend card; new notes for operating-system + scope/compliance. Each new card gets a `CALC_DATA` "how this is calculated" note and a `READ_DATA` "how to read this" note (house rule: every card exposes its calc).
- **Modify** `bin/build_acq_dashboard.mjs` — carry any new payload blocks through.
- **New/modify** `bin/vip_report/*.py` — `decision_layer.py` (floor/band tags + break-even + sensitivity from existing metrics), `reallocation_return.py` (cost-per-retained-whale, recoverable fraction, marginal-return-by-tier, tier-migration funnel), `trend_decompose.py`, `operating_baselines.py`. Emit into `vip-metrics-MY.json` as new blocks (`decision_register`, `cost_of_wrong`, `reallocation_return`, `trend_decomp`, `operating`).
- **New** `projects/promo-value-creation/plans/2026-08-2x-laneA-flagship-holdout-spec.md` — the Lane A holdout protocol (mirrors the cashback holdout spec).

## Success criteria
A CEO reading the redesigned report can, without building anything themselves:
1. **Approve the FLOOR Monday** — the ~RM228k + Bronze trim + Rescue hygiene, clearly separated from the gated RM3.29M.
2. **See the priced downside** of every cut (whale break-even + the net-zero frontier).
3. **See the expected return** of the reinvestment (cost-per-retained-whale, recoverable fraction), with honest bands.
4. **Hand each move to a named owner** with a real enforcement mechanism and a date.
5. **Defend it in five minutes** from the Decision Box (verdict + hero number + Cut/Hold/Test).
6. **Know exactly when** the holdout resolves the rest, and the interim policy until then.

## Constraints & guardrails (non-negotiable)
- **Member-level data stays in `scratchpad/`**, never committed to git; shared views carry **opaque player refs only** (no names/ids).
- **NGR is never described as promo-attributed** until the attribution model is validated and approved — new panels label modeled figures "directional, pending the holdout."
- The **matched holdout is the proof step** for every BAND magnitude; nothing in the BAND is presented as authorised.
- Preserve the report's existing strengths (four-lane split, concentration facts, plain language, per-card calc/read notes) — this is an *additive decision layer*, not a rewrite.
- Commit/publish only at checkpoints; each new card is `node --check`'d, built, browser-verified (DOM + no console errors) before publish.

## Open questions (to resolve in planning or with the user)
1. **SG scope** — does an SG VIP book exist to bring in, or is MY-only the intended boundary for this report? (Affects #7 and whether policy is market-specific.)
2. **Cost-per-retained-whale model** — is there a defensible retention/forward-NGR model available now (survival curve already in payload?), or does #4's return side itself wait on the holdout? If the latter, #4 ships as a *framework with blanks* the holdout fills.
3. **Competitor benchmark data** — do we have any source for rival RM400+ VIP offers, or is that a qualitative note?
4. **Holdout authority** — who signs off launching a real holdout on live flagship codes, and what's the acceptable interim bleed during the 2–4wk run?
