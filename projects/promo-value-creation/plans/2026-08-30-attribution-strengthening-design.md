# Attribution Strengthening — Design (unified engine + matched-control + fatigue)

**Status:** APPROVED (brainstorming) → building Phase 1. WS1 Malaysia.
**Feeds:** `projects/promo-value-creation/ATTRIBUTION_MODEL.md` (validation layer 2). Moves figures from Tier 1 (directional, own-baseline) toward Tier 2 (attributed, matched-control).

## Decisions (user-approved)
1. **One unified attribution engine** (not two) — window as a parameter (7/30/60/90), concurrency-split dedup, optional time-decay, a **matched-control baseline**, fatigue adjustment, net-of-bonus once, maturity-gated, rolled up per-code AND per-member wallet (reconciled), each figure tier-labelled.
2. **Fatigue: adjust the credit** — fit incremental-per-RM by claim ordinality (1st/2nd/Nth) and credit the Nth claim by its fitted factor (extends the whale "repeats pay less" finding book-wide).

## The core method — matched-control difference-in-differences (DiD)
For each treated claimer of code C, find similar **untreated** members (matched on tier × recency × prior-90-deposit band × pre-claim NGR trajectory) and compute:

`incremental = (treated_fwd − treated_pre) − (control_fwd − control_pre)`

over a horizon window (default 90d), NGR net of bonus. The matched control's own before→after change absorbs **regression-to-the-mean** (both groups selected on similar pre-state) and **seasonality** (controls anchored to the same calendar as their treated match). This is the Tier-1→Tier-2 upgrade. It is NOT a holdout (controls still received *other* promos) — so it is **attributed (observational), not caused**; disclose that.

## Phase 1 (building now) — retention + VIP
- **New pull:** an untreated matched-cohort's pre/forward NGR (the forward pull only covered claimers). Stratified untreated members, anchored to treated claim-dates.
- **Scope:** a representative set of codes per pillar (top-spend + a spread), not all 155+383 — enough to prove the method and quantify the RTM gap.
- **Outputs (scratchpad only, member-level never committed):** per-code matched-control incremental + its CI, next to today's own-baseline number; a **pre-trend placebo check** (treated vs control must be parallel BEFORE the claim — if not, the design is invalid); the RTM gap (how much of +RM10.18/RM1 retention and the VIP forward reads survives a real control).
- **Success:** matched-control incremental is lower than own-baseline (RTM removed), passes the pre-trend placebo, reconciles to the wallet total, earns a Tier-2 label.

## Phases 2–3 (later)
- **P2:** fatigue curve (incremental-per-RM by claim ordinality → the credit-adjustment factor).
- **P3:** wire concurrency-split + time-decay + matched baseline + fatigue into one parameterized module; retire engines A (7d-vs-14d windowed lift) and B (30/60/90 forward pull) across pillars.

## Guardrails
Member-level in scratchpad, never committed; opaque refs/aggregates in shared views. Every emitted number carries its tier and its unremoved confounders (other-promo contamination, match quality). Placebo/pre-trend gate before any figure is called Tier 2.
