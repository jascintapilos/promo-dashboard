# Acquisition Decision Report — Design (LOCKED)

- **Date:** 2026-08-18
- **Status:** Design locked — proceeding to implementation plan
- **Owner:** Jascinta (Promo) · with YG (analytics) + WY sign-off on thresholds/windows
- **Mockup (format approved):** https://claude.ai/code/artifact/ab6513d3-f763-4de9-9316-00cf66144c83

## 1. Mission (one sentence)
Turn the WS1 promo report from a single revenue-lift scoreboard (today's "NGR Lift") into a decision tool that judges every acquisition bonus against its actual objective — on the right measure, at a known cost per result, including what players do after they claim — so we can decide whether to scale, maintain, optimise, reduce, or stop each one.

## 2. Why (the redirect)
WY + YG (17 Aug meeting + WY's checklist) asked the report to move from *describing* performance to *recommending decisions*, judged by objective-appropriate KPIs — **not NGR Lift**, which is negative by design for Free Credit and just re-flags every FC code. This design delivers that for the **acquisition** slice first (YG: start with acquisition, it's the most straightforward).

## 3. Scope
**In scope (v1):** Acquisition objective only, **Malaysia (MYR)**, a decision-first report + dashboard covering the acquisition code universe.
**Out of scope (deferred, same engine extends later):** retention / reactivation / VIP objectives; SG; a matched non-participant control group; formal promotion guardrails; promo-config-dependent metrics.

## 4. Approach
Build **back-to-front**: start from the decision (which bonuses to fund vs cut), define success by objective, then compute. NGR Lift is demoted to a single context column; the decision rests on acquisition-appropriate measures.

## 5. The metric set — acquisition scorecard
Core "funnel" (read in order): **① New-player share (purity) → ② Claim→FTD conversion % → ③ FTD volume → ④ Cost per FTD (headline) → ⑤ Deposit-lift per RM → ⑥ 30-day stick-rate (repeat deposit / stayed active).**
Supporting on the tab: first-deposit size (median), an evidence-strength gate (min claim floor before any verdict), a concurrent-bonus overlap flag. NGR Lift = context column only.
Definitions:
- **Cost per FTD** = code bonus cost ÷ first-time depositors it produced. Lower is better. Headline.
- **Claim→FTD conversion** = of claimers, share who made a first deposit (caveat: ~100% if a deposit is required to claim; low is expected for no-deposit FC).
- **Deposit-lift per RM** = extra deposit brought in ÷ bonus cost (for genuine new players this ≈ their first deposit; label "deposit brought in", not incremental-vs-baseline).
- **30-day stick-rate** = share of the new depositors who deposited again / stayed active within 30 days.

## 6. Attribution basis (aligned to the analyst)
- **FTD & cost-per-FTD ride the analyst-endorsed 7-day-window attribution** (day-0 weighting, split across concurrent bonuses) — the same method the workbook already reproduces. No new attribution rule.
- **Downstream stick-rate uses a longer window (proposed 30 days)** — a per-objective window flagged for YG/WY, sitting alongside the 7-day attribution, not replacing it.
- **No control group in acquisition v1 — deliberate.** The report ranks acquisition bonuses *against each other* (efficiency + stickiness), which needs no counterfactual; own-baseline is meaningless for brand-new players (no history); a retroactive matched control is weakest exactly here. The control group is introduced with the **retention/reactivation** slice (where own-baseline is meaningful and matching works). The clean acquisition answer — a **randomized holdout on a future welcome campaign** — is recommended to leadership as a process change, not something v1 computes.

## 7. Decision rule (DRAFT — pending YG/WY sign-off)
Five actions from cost-per-FTD × 30-day stickiness:
- **Scale** — low cost-per-FTD AND strong stick.
- **Maintain** — mid cost, acceptable stick.
- **Optimise** — good FTD volume but high cost OR weak stick → test smaller bonus / better targeting.
- **Reduce** — high cost AND weak stick, on non-trivial spend.
- **Stop** — very high cost AND poor stick / almost no FTDs.
Cutoffs derived from the actual data distribution, printed on the report labelled **"DRAFT — for YG/WY to approve."**

## 8. Output format (approved)
**HTML dashboard**, decision-first, reader-friendly (Source Sans 3, 16px base, nothing < 12px). Structure: YTD/period meta bar → **"The call"** summary (action tally + money-at-stake) → KPI row → 4 charts (cost-per-FTD bars · cheap-vs-sticky quadrant · by-mechanic · new-depositors-by-month) → the decision table → a "how to read" box carrying the honesty caveats. **Google Sheets stays the data backend.** Published as an Artifact for review now; deploy to the GitHub Pages dashboard host alongside QC/Weekly/Spotlight when finalized.

## 9. Data sources & feasibility
Buildable now from ClickHouse (`GetBonus_ABC` claims + `Daily_GMT8_Snapshot` deposit/GGR/NGR + membership log) + a new post-claim redeposit/active pull. Cost-per-FTD prototyped for MY previously.
**Data gaps (parallel asks, not v1 blockers):** matched control group (BO offered/target lists + non-claimer snapshots); wagering/turnover completion + withdrawals (abuse & take-home); true registration date (real "new"); promo config per code (min-dep, FC face value, deposit-required — for right-sizing and correct conversion reads).

## 10. Honesty caveats that MUST appear on the report
- Ranks bonuses against each other, **not** against running no bonus; true incrementality needs a holdout (recommended).
- **NGR is context, never the decider** (negative by design for acquisition/FC).
- Figures are an **early estimate**; **decision thresholds are DRAFT** pending sign-off.
- Compare **like with like** (within mechanic/tier).

## 11. Success criteria
YG/WY can sit with the acquisition dashboard and, per code, either agree the action or adjust one threshold — and the same template obviously drops onto the next objective (retention).

## 12. Open decisions (to resolve in planning/sign-off, not blockers)
- Confirm KPI + window + threshold values with YG/WY (the one blocking sign-off gate before build finalizes).
- FTD counting: whole to the acquisition code vs fractional split (default: count the depositor once).
- 3 codes classified Retention in MY / VIP in SG (`FT_VMFS_GOO_158`, `FT_VMFS_GOO_178`, `FT_WC26_FB_100_GLD`) — TL to confirm.
- Physical-gift bonuses handled separately (no upfront cash loss).
- Optional: check whether FastTrack/Smartico blast recipient lists exist (would enable an "offered-but-didn't-claim" control later).
