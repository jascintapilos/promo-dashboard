# D-004b — Pilot #2: Retention (FT_PAYDAY / FT_RET_88FS Family)

**Decision owner:** HOD + source-team leads
**Prepared by:** Promotion
**Date:** 2026-07-27
**Evidence:** `outputs/pvc-csir-probe/deposit-lift-attribution-my.json`

## What we are asking HOD to approve

Approve a **controlled retention test** using the FT_PAYDAY_100FS_GOO_MD250
design (or an equivalent from the same family) over the next 30 days.

## Why this family

Top-quartile retention performance for active depositors:

| Code | Members | Pre-30d dep | Post-30d dep | Lift |
|---|---|---|---|---|
| FT_PAYDAY_100FS_GOO_MD250 | 280 | RM 23,134 | RM 25,757 | **+RM 2,624 (+11%)** |
| FT_DOUDLEDATE_JUNE_100FS_GOO | 545 | RM 16,565 | RM 18,747 | **+RM 2,182 (+13%)** |
| FT_RET_88FS | 311 | RM 7,798 | RM 9,822 | **+RM 2,024 (+26%)** |
| FT_CNY_88FS_GOO_5X_DY2 | 484 | RM 6,300 | RM 8,171 | **+RM 1,870 (+30%)** |

The family averages +11% to +30% deposit uplift on already-active members.
This is exactly the "retention" behaviour Goal A defines.

## Pilot design

**Segment:** WS1 MY members classified as "Active depositor" (deposited within
prior 30 days) at Silver, Gold, or Bronze/Classic tier with monthly deposit
frequency ≥ 2.

**Exclusions:**
- Members already targeted by an active CRM Journey in the prior 14 days.
- VM handler-assigned members (they receive VM treatment).

**Audience size (CSIR estimate):** 8,187 active depositors in the prior 30
days on WS1 MY. Filter to defined tier/frequency: expected ~3,500. Pilot
will randomise 1,500 treatment + 1,500 holdout.

**Mechanic:** FT_PAYDAY_100FS_GOO_MD250 as-is: 100 free spins on Gates of
Olympus, min deposit RM 250, existing TO.

**Success measure:** deposit lift in 30 days post-claim vs holdout baseline,
per D-006 attribution rule.

**Exit criteria:**
- Positive: sustained treatment lift ≥ +15% relative over holdout → scale to
  monthly Payday cadence
- Negative: lift ≤ 0 or matches holdout → stop, redesign
- Ambiguous: 0 < lift < 15% → extend one cycle before decision

## Budget

Estimated 300 claims across 1,500 treatment cell at RM 100 avg bonus per
claim = **~RM 30,000 gross bonus cost**. Existing cap keeps ceiling
reasonable at RM 50k worst-case.

## What we are NOT proposing

- We are not testing multiple family members simultaneously — that would
  confound results. If HOD wants a broader family test, it becomes a
  separate multi-cell design.
- We are not scaling to WS1 SG yet — one market at a time.

## What happens on approval

- CRM configures the treatment / holdout split.
- Analytics baselines the pre-treatment 30-day deposits per member.
- Result review at day 30 (Gate 4).

## What happens on rejection

- Recommend an alternative: FT_RET_88FS is the cleanest per-member effect
  (+26% relative on smaller cell).
