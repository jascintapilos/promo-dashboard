# D-004a — Pilot #1: Reactivation (Scale FT_CHURN14DAYS_20_PCT Design)

**Decision owner:** HOD + source-team leads
**Prepared by:** Promotion
**Date:** 2026-07-27
**Evidence:** `outputs/pvc-csir-probe/deposit-lift-attribution-my.json`

## What we are asking HOD to approve

Approve a **controlled scale test** of the `FT_CHURN14DAYS_20_PCT` design
on WS1 MY over the next 30 days, using the parameters below.

## Why this code

Best-in-class reactivation performance already observed:

- 660 unique members claimed in 2026 YTD
- Pre-30-day deposit average: RM 1,829 per member
- Post-30-day deposit average: RM 3,584 per member
- **Net lift: +RM 1,755 per member (+96% relative)**
- Total incremental deposit YTD: ~RM 118k, on bonus cost of RM 33k
- Bonus-to-deposit ratio: ~1:3.5 — clearly efficient

No other WS1 reactivation code approaches these numbers on a comparable claim
volume.

## Pilot design

**Segment:** WS1 MY members inactive 14 days since last deposit,
prior lifetime deposit ≥ RM 300, and no active promotion assignment.

**Exclusions:**
- Members who have already claimed FT_CHURN14DAYS_20_PCT within the
  prior 60 days.
- Members flagged for abuse/duplicate-claim review.
- VM/AM-tagged high-value members (they receive separate treatment).

**Audience size (CSIR estimate):** 3,032 members in the 30–90d inactivity band + 3,311 in the 90–180d band. Total ~6,300 eligible. Pilot will randomise to 2,000 treatment + 2,000 holdout.

**Mechanic:** existing configuration (20% reload bonus, RM 100 cap after
D-003 approval, TO as configured).

**Success measure:** deposit lift in 30 days post-claim vs 30 days pre-claim,
compared against holdout baseline. Publication threshold n≥50 per cell and
lift>10% (per D-006 attribution rule).

**Exit criteria:**
- Positive: sustained treatment lift ≥ +30% relative over holdout → scale to
  larger inactivity windows next cycle
- Negative: lift ≤ 0 or holdout matches treatment → stop, deep-dive selection
  bias
- Ambiguous: 0 < lift < 10% → extend one more cycle before decision

## Budget

Estimated 400 claims across the 2,000-member treatment cell over 30 days at
avg RM 36 per claim (current observed) = **~RM 14,400 gross bonus cost**.
Actual will depend on cap; with proposed RM 100 cap the ceiling is RM 40k
worst-case even at 100% claim rate.

## What we are NOT proposing

- We are not scaling the code to all of WS1 MY (that would be Gate 5).
- We are not changing the current active version of the code (that continues
  running through Promotion's existing calendar).
- We are not committing to publish NGR for this pilot — that waits on D-006.

## What happens on approval

- Promotion configures the holdout / treatment split in the CRM system.
- Analytics prepares the pre-lift baseline snapshot before day 1.
- Weekly monitoring: cost, claims, deposit lift.
- Results reviewed at day 30 (Gate 4).

## What happens on rejection

- Recommend HOD name an alternative reactivation candidate. Second-best on
  the current evidence is FT_FB_REL_88FS_GOO_5X (+RM 1,543 lift on 1,524
  members).
