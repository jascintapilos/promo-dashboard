# Retention Pillar — Decision Report Design (LOCKED)

- **Date:** 2026-08-26
- **Status:** Design locked — proceeding to implementation plan
- **Reuses:** the Acquisition engine + template shell (drops into the existing **Retention** tab of the Promo Report).
- **Design sibling:** `2026-08-18-acquisition-decision-report-design.md`

## 1. Mission
For every retention promo, say whether it **kept existing players depositing — profitably** — and give a scale/maintain/optimise/reduce/stop call, so we concentrate the retention budget on what actually adds money (not on players who'd have stayed anyway).

## 2. Objective & universe
Retention = keep **existing** depositors depositing/active, **including win-back/reactivation** of lapsed players. Universe = **TL-approved Pillar = 'Retention', MY** (~325 codes: reloads, cashback, free-credit, win-back). Large → decision table grouped-by-decision, collapsible, top-spend first.

## 3. Headline metric — NGR Lift per RM (decided)
**NGR Lift per RM** = extra net revenue kept above the player's own 14-day baseline, per RM of bonus (7-day window). **Why it leads (opposite of acquisition):** retention players redeposit anyway, so "did they come back" barely discriminates; NGR Lift is the only number that separates *"kept a player who added money"* from *"paid a player who'd have stayed regardless."* It was demoted for acquisition (new players, no baseline); it is the whole point for retention. Break-even = 0; positive = added net revenue after the bonus's own cost. **Directional** (own-baseline, not causal) until the control group lands.

## 4. Support metrics
Redeposit rate (redeposited ≥1 time within 30 days) **shown as uplift vs the tier's normal rate** (70% is not a win if 65% happens anyway — the gap is the signal); NGR Lift total (RM); cost per retained player; players retained (volume); payback restatement ("RM1 of bonus → RMx extra NGR").

## 5. Windows
NGR Lift: 7-day post-claim vs 14-day baseline. Redeposit "retained": 30 days. Durability: **30 / 60 / 90-day survival + days 8–30 persistence** (cohorts compared only at equal maturity; recent codes labelled "too new").

## 6. The 7 additions from the what-else fan-out (all buildable now)
1. **By-bonus-type cut** (reload / cashback / free-credit / win-back) — the single biggest budget lever across 325 codes; roll every metric up to mechanic. (Needs BonusName → clean mechanic taxonomy; cashback books after the loss window — timing note.)
2. **Durability** (30/60/90 survival + days 8–30 persistence) — did the week-1 lift last, or buy one deposit.
3. **Win-back lens** — recency-at-claim buckets (active 0–14d / cooling 15–30 / dormant 31–60 / lapsed 60d+), judged on **reactivation rate + cost per reactivated player**, NOT own-baseline lift.
4. **Directional + win-back guardrail** — keep a "directional · own-baseline" label on every NGR Lift; **ring-fence win-back codes** (near-zero baseline mechanically inflates their lift-per-RM) as "pending control", not acted on at full confidence.
5. **Minimum-volume floor + "monitor / insufficient data" verdict** — thin codes don't get a scale/stop call off a dozen players and one lucky week.
6. **Money-to-move reallocation view** — sum bonus spend on stop/reduce codes as a pool to redeploy into scale codes (in RM), so "+RM4.5M" reads as "concentrate the budget", not "keep everything".
7. **Redeposit-rate-as-uplift** (see §4) — vs a tier-normal comparator.

## 7. Tier / segment lens (retention's big addition over acquisition)
Tier-at-claim (already computed). Delivered as: a **by-membership-tier** view of NGR Lift per RM; a **bonus-type × tier grid** (which type wins for which tier — the budget-steering map WY asked for); an **over-rewarding-by-tier flag**; and a **segment-target purity** check (did a "Gold reload" reach Gold?). Read lift-per-RM per tier — **never rank tiers by total NGR-Lift RM**.

## 8. Decision rule (matrix)
Primary axis = **NGR Lift per RM (makes money / loses money)** × **redeposit-uplift (above / at-or-below tier-normal)**:
- Makes money + redeposit-uplift high → **Scale** · Makes money + low uplift → **Optimise** (profitable but not retaining incrementally → check targeting) · Loses money + high uplift → **Reduce** (retains but over-generous → trim) · Loses money + low uplift → **Stop**.
Plus: **give-to-take stop-floor** (under ~RM1 extra NGR per RM → flag reduce/stop regardless of busy-ness); the **volume floor** → "monitor"; **win-back codes** judged on their own lens + held "pending control". Draft thresholds from the data distribution.

## 9. Incrementality
Own-baseline now (reuse acquisition method). **Matched non-participant control (difference-in-differences) = the fast-follow** — retention is where it's feasible (existing players have history to match on).

## 10. Layout (reuse the shell → Retention tab)
KPIs (retention spend · NGR Lift RM · NGR Lift per RM · redeposit-uplift) → **The call** (with money-to-move) → **Decision rules** (thresholds + verdicts&actions + matrix) → 4 charts (**NGR Lift per RM by code · money×retention quadrant · by-tier · bonus-type×tier grid**) → decision table (grouped, collapsible, tier-context column, win-back tagged) → **Notes** → **"Coming soon" section (see §12).** Exec-framing banner: *"On this tab money IS the judge (opposite of Acquisition) — these players already deposit."*

## 11. Data & feasibility
Same ClickHouse tables + attribution machinery as acquisition (7-day window / 14-day baseline reused). Recency, durability, tier, mechanic all derivable now. Member-level pulls stay in scratchpad.

## 12. "Coming soon" section — at the BOTTOM of the report, each tagged **Soon** (per user)
A visible panel listing what's planned once new data lands (NOT computed in v1) — so viewers see the roadmap:
- **Bonus-abuse / cash-and-dash** — needs withdrawal data.
- **Wagering-completion / revenue quality** — needs turnover + promo config.
- **Tenure & clean lapsed-vs-new split** — needs registration date.
- **Exact right-size levers + true targeting purity** — needs promo config (offer size, min-dep, target list).
- **Proven (not directional) incrementality** — the matched control group.
Each row rendered with a **"Soon"** badge.

## 13. Out of scope (v1)
The §12 data-gap metrics (shown as Soon, not computed); the matched control group (fast-follow); SG. Dropped as low-signal: engagement-only "active days", value-band (≈ tier), tier up-migration, deposit-cadence (snapshot artefact), standalone time-to-next-deposit.

## 14. Success criteria
YG/WY can read the Retention tab and, per code, agree the action; the win-back trap is neutralised (ring-fenced, not top of the leaderboard); the "money to move" line turns a net-positive pillar into a concrete reallocation; the "Coming soon" section shows the credible path to proof.
