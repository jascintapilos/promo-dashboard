# VIP Pillar — Decision Report Design (LOCKED)

- **Date:** 2026-08-26
- **Status:** Design locked — proceeding to implementation plan
- **Reuses:** the Retention engine (attribution, tier×mechanic comparator, concentration guard, rollups) + the Promo Report template shell (drops into the existing **VIP** tab).
- **Design siblings:** `2026-08-18-acquisition-decision-report-design.md`, `2026-08-26-retention-decision-report-design.md`
- **Pressure-tested:** 6-lens CEO metric fan-out (P&L · churn · LTV · incrementality · risk · program) → 33 proposals → curated to a 7-addition v1 + phase-2 + coming-soon.

## 1. Mission
For the RM8.46M VIP loyalty program, say — per promo AND per player AND per tier — whether the spend keeps high-value players **profitable and loyal**, so we concentrate the budget on players and tiers that add money and stop subsidising the ones that don't. VIP is a *program*, not a code list, so the report gets a **program-wide portfolio view above the per-code grading.**

## 2. Objective & universe
VIP = high-value player retention, recovery, and reward. Universe = **TL-approved Pillar='VIP', MY** (383 codes, RM8.46M redeemed, 132,555 claims). Pulled from the live All Codes tab → `scratchpad/vip/tl-vip-codes-MY.json` (`pull_tl_vip_codes.mjs`, done).

## 3. Four judging lanes (LOCKED — confirmed by user)
A reload, a rescue, a daily check-in, and a birthday gift do different jobs and cannot share one metric. Each lane = one job = one fair test:

| Lane | Sub-types | Spend | Headline metric |
|---|---|--:|---|
| **A — Performance** | vip-free-credit, vip-reload, vip-free-spins | RM4.60M (54%) | **NGR Lift per RM** (money is the judge — reuse the Retention engine + tier×mechanic comparator) |
| **B — Cashback** | optimove Weekly Rescue (tiered loss-cashback, confirmed by WY) | RM2.14M (25%) | **Retention-after-loss + forward net-margin + cashback-rate** (NGR-per-RM ring-fenced — a give-back after a loss tanks the 7-day window; NOT win-back: 98% of claimers were losing that week, median recency 1 day) |
| **D — Engagement** | World Cup daily check-in | RM871K (10%) | **Habit + break-even** — does the daily giveaway build a login habit AND at least cover its cost; NOT scaled/stopped on pure NGR-per-RM (its job is engagement, not profit). Report habitual-collector share + does-it-pay-for-itself. |
| **C — Entitlement** | VIP Birthday, VIP Welcome | RM845K (10%) | **NOT graded scale/stop** — reported for leakage + downstream NGR + reach |

Lane assignment comes from the sub-type taxonomy (regex on code+name; win-back detected on the CODE, per the retention lesson). Rationale for D: check-in is mostly no-deposit free credit to already-active players to drive daily login — grading it on money alone would falsely brand it a loss; its own lane asks the right question (engagement + break-even) instead of the convenient one.

## 4. The program-wide layer (VIP's big addition over Retention)
Rendered ABOVE the three lanes. The report is code-centric everywhere else; the money is spent on **people and tiers**. Seven v1 additions (all buildable now unless noted):

1. **Per-player net-margin ledger** — per VIP: annual NGR − *every* RM of bonus across all 383 codes → **net-negative VIP share + subsidy RM**. THE cut lever (a player looks fine per-code but drains across 20 codes).
2. **Tier funding balance + reach + full-cost margin** — per tier: reward-spend-share vs NGR-value-share (over/under-funded index) · reach (% of the tier's *active* members rewarded) · full-cost contribution margin (does Diamond earn its RM1.33M). The budget-*envelope* reallocation, above per-code.
3. **Lane B rigor** — forward net-margin per reactivated VIP (absolute RM, sidesteps the ~0-baseline trap) · **recidivism** (serial re-lapsers = a subscription, not a save) · organic-return discount (reactivation rate net of natural returners) · value-weighted recovery (zombie saves).
4. **Dead-weight / incrementality proxy + revenue quality** — share of Lane-A spend to already-active players whose post-NGR stays in their own baseline band (would-play-anyway CEILING) · **GGR-coverage** (house GGR ÷ bonus by tier×mechanic — catches NGR-lift sitting on play that never materialised) · **free-credit dead-money** (FC claimed with ~0 GGR & no deposit = leakage on the RM3.25M) · check-in habitual-collector share.
5. **Whale concentration + value-at-risk** — top-1%/10% of *players'* share of program NGR (portfolio dependency) · declining-whale early-warning (active top-decile players with a falling deposit slope → invest upstream *before* they cost full rescue price).
6. **Program ROI & payback + fraud gate** — one program ROI + payback (ranged now, defensible with the control) · bonus-out concentration / collusion fingerprint (payout Gini + top-N share OUT + cross-code claim bursts → freeze-and-investigate watchlist).
7. **Entitlement accountability (Lane C)** — gifts landing on dormant/dead accounts (leakage) · downstream 30/60d NGR vs baseline · tier reach. Turns RM845K of blind spend accountable without grading it.

## 5. Per-lane support metrics (reused from Retention where noted)
- **Lane A:** redeposit-uplift vs tier×mechanic norm · durability 30/60/90 · recency-at-claim buckets · cost per retained · single-member concentration guard · mechanic×tier heatmap. (All reused.)
- **Lane B:** reactivation rate (raw + organic-net) · cost per reactivated · recency-at-lapse buckets · forward net-margin · recidivism · latency (deferred to phase-2).
- **Lane C:** spend · recipients · downstream NGR · dormant-gift leakage flag.

## 6. Windows
NGR Lift: 7-day post-claim vs 14-day baseline (reused, gated on 7-day maturity). Redeposit/retained: 30 days. Durability: 30/60/90. Rescue forward-margin: 30/60/90. Player ledger & tier margin: full YTD (2026-01-01 → 2026-08-25). Deposit slope: trailing-90 vs prior-90 (or H1 vs H2). NGR is **net of the bonus** (verified corr 0.79) → break-even = 0.

## 7. Decision rules
- **Lane A** — the Retention matrix (NGR Lift per RM × redeposit-uplift, break-even 0, give-floor, scale-hi, win-back gate n/a here, single-whale demote, Watch-money) **PLUS quality gates**: a code failing GGR-coverage (<1.0×) or with high FC dead-money is capped/flagged regardless of NGR-lift (catches baseline-inflated low-quality revenue).
- **Lane B (Cashback)** — Keep/Trim/Cap from: retention-after-loss × forward-net-margin per member × cashback-rate (% of loss returned). Chronic-loser recidivism (players cashed-back repeatedly) → "Cap". Ring-fenced from the 7-day money leaderboard (a loss-return can't be judged on 7-day incremental NGR). The honest caveat: cashback recipients are active players, so retention is partly what they'd do anyway — a matched control (losing VIPs who got no cashback) is the proof step.
- **Lane C** — verdict = **Entitlement** (not scale/stop); a **Leakage** flag when gifts hit dormant/dead accounts.
- **Lane D (Engagement)** — verdict = **Habit-building** vs **Leaky-freebie**: judged on (a) does it recur / drive login habit (claim frequency + active-day lift) and (b) break-even (does GGR at least cover the giveaway); a code that neither builds a habit nor covers its cost → **Trim**. Never graded on NGR-per-RM alone.
- **Program-wide** — tier verdicts: over-funded (index >1 + flat marginal lift) → trim envelope; under-reached (low reach on a high-value tier) → open; net-negative subsidy → the cut-line RM.

## 8. Incrementality
Self-baseline proxy now (reused); the **matched control / holdout is the proof step (Coming-soon)** — it converts dead-weight and false-reactivation from directional to defensible. Every proxy is labelled directional so we don't over-cut on inference.

## 9. Layout (reuse the shell → VIP tab)
**Program-wide section** (ROI headline · per-player net-margin + net-negative subsidy · tier funding balance/reach/margin · whale concentration + value-at-risk · fraud watchlist) → **then four lane sections**, each with its own call + KPIs + charts + decision table:
- Lane A: the Retention layout + quality gates (GGR-coverage, dead-money).
- Lane B: reactivation × forward-margin quadrant + recidivism + recency buckets.
- Lane D (Engagement): habitual-collector share + does-it-pay-for-itself + claim-frequency/active-day lift, tagged "engagement, not profit".
- Lane C: entitlement spend + reach + leakage, tagged "not graded".
Exec banner: *"VIP is a program, not a code list — this reads player-and-tier first, then grades each promo in its own lane."* → **"Coming soon"** section at the bottom.

## 10. Data & feasibility
Same ClickHouse tables + attribution machinery. NEW pulls vs Retention: per-member **GGR-in-window** (coverage + dead-money), per-member **annual ledger** (bonus across all codes + NGR + GGR + tier-at-start/end + deposit slope), **rescue-claim counts** (recidivism), **bonus-out concentration** (Gini/top-N from claim amounts). Member-level → scratchpad only.

## 11. Phase-2 (fast-follow, not v1)
Reward-frequency saturation cap · cadence/fatigue throttle · tier-migration matrix (buildable now, deferred for scope) · rescue trigger-timing latency curve · reward-placement timing.

## 12. "Coming soon" (needs new data) — bottom section, tagged **Soon**
- **Matched control / holdout** — the proof that converts every proxy to defensible; the one thing that lets us cut budget on measurement not inference.
- **Withdrawal data** — exact FC cash-out (proxy = ~0 GGR + no deposit now).
- **Registration / DOB** — clean tenure + entitlement reach roster.
- **Promo config** (offer size, min-dep, target list) — exact right-sizing + targeting purity.

## 13. Out of scope (v1)
Phase-2 refinements (§11); the §12 data-gap metrics (shown as Soon); SG.

## 14. Success criteria
The VIP-program owner can read the tab and, per player-tier and per promo, make a defensible budget call: the net-negative subsidy RM is named, Diamond rescue (RM1.33M) is judged on forward margin + recidivism not a vanity reactivation rate, the leaky FC codes are flagged before scaling, and the whale-concentration risk is explicit — with every proxy honestly marked directional pending the control.
