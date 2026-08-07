# D-003 — Cap Governance & 4 Cap-Cut Proposal

**Decision owner:** HOD
**Prepared by:** Promotion
**Date:** 2026-07-27
**Evidence:** `outputs/pvc-csir-probe/cap-audit-my.json`

## What we are asking HOD to approve

1. **Cut caps on the 4 codes below** — effective immediately once approved.
2. **Adopt the cap-governance rule** — any code where average utilisation
   over 90+ days remains below 15% shall be flagged for a cap review;
   Promotion may propose a cap reduction with data attached and act on
   HOD's written approval only.
3. **Establish a monthly cap-audit review** — the same query rerun each
   month, with any new candidates surfaced to HOD.
4. **Adopt the sunset-governance rule** (not previously written down, despite
   being named in the decision log since this project started) — any code
   confirmed NGR-negative for 90+ consecutive days on the official dashboard
   is added to a sunset watch-list and assigned a deep-dive owner within 2
   weeks. The owner returns exactly one of three recommendations — keep, cap,
   or sunset — with evidence attached. Promotion may only action a sunset on
   HOD's written approval; this proposal adopts the rule, it does not sunset
   anything today.

## Evidence

CSIR data 2026-01-01 to 2026-07-27, WS1 MYR:

| Code | Current cap | Claims | % at ≥95% cap | % below 50% cap | Avg utilisation | Proposed cap |
|---|---|---|---|---|---|---|
| FT_CHURN14DAYS_20_PCT | 500 | 929 | 2% | 97% | **7.2%** | 100 |
| FT_BR_RET_40PCT_12X_100 | 2,000 | 236 | 2% | 98% | **6.9%** | 300 |
| FT_WC26_DEP_30PCT_2K_PLTDMD | 2,000 | 61 | 0% | 97% | **13.0%** | 500 |
| WC_CHECKIN_15PCT | 300 | 562 | 1% | 98% | **6.0%** | 100 |

## Sunset watch-list (what rule #4 applies to right now)

**Corrected 2026-07-30.** The two codes originally listed here were both
wrong, caught the same day they were written, by pulling the full official
YTD export instead of relying on an old CSIR read:

- `FT_VM_DEP1000_GET500_5X` (MY) is actually a strong performer — +RM159,382
  NGR lift, +64.3% ROI, 99.3% confidence, a top-5 result across the entire
  program. It does not belong on a sunset watch-list at all. Retracted; see
  `ISSUES_AND_FOLLOW_UPS.md` F-010.
- `SCRATCHMANIA_2024SEPT2` (SG) has zero claims anywhere in the 2026 YTD
  export — it appears to already be dormant. Worth one quick BO check to
  confirm it's deactivated, but there's likely nothing active to sunset.

**The watch-list is empty right now.** That's a fine outcome for a first
run of the rule — it means the rule works (it didn't flag two strong or
already-dormant codes), not that the rule has nothing to do. The rule stays
adopted so the next genuine candidate has a real process to go through.

The Weekly Rescue Bonus family and the VM FreeCredit family are **not**
watch-list candidates — they already have their own dedicated investigation
as a separate decision, precisely because of their size (RM 6.3M+ combined).

## Projected impact

- **Deposit-risk:** projected zero. On all four codes, <2% of historical claims
  hit or approach the current cap. New caps are set well above the observed
  distribution of actual bonus paid.
- **Cost impact YTD:** the four codes together spent RM 89k on bonuses. With
  proposed caps, the same distribution would have paid RM ~50k — but this is
  hypothetical, since new claims may vary. The *real* value is preventing an
  outlier from ever paying the current cap.
- **Governance value:** establishes the first evidence-based cap-review rule.

## What we are NOT asking for

- We are not sunsetting any code today.
- We are not proposing changes to codes where cap-utilisation is high
  (e.g. FT_REL_TLEO_45PCT_888MX at 100% cap-hit is a separate design question).
- We are not asking HOD to approve automated cap changes — every change
  requires this evidence pattern and HOD sign-off.

## What happens on approval

- Promotion updates the 4 caps in BO within 3 working days.
- Analytics reruns the cap-audit query monthly; new candidates surface
  in the next HOD sitting.
- Two-cycle review after 60 days: did the cuts hold zero deposit-risk?
- The sunset-governance rule is live; the watch-list is currently empty
  (see correction above) — the next code that's confirmed NGR-negative for
  90+ days gets a deep-dive owner within 2 weeks of being flagged.

## What happens on rejection

- Keep current caps; document the rejection reason.
- Deep-dive request: which caps do you want kept, and why?
