# D-008 — Four Underperforming Code Families: Investigation Directive

**Decision owner:** HOD
**Prepared by:** Promotion
**Date:** 2026-07-30
**Evidence:** Company Performance Dashboard, full YTD export (both markets, not a
sample) — `outputs/pvc-csir-probe/official-dashboard-exports/`

## Where this comes from

The sunset-governance rule adopted in D-003 needed a first real test. The two
codes originally proposed as watch-list candidates both turned out to be
wrong on closer inspection (see `ISSUES_AND_FOLLOW_UPS.md` F-010) — one was
actually a strong performer, the other has no 2026 activity at all. Rather
than leave the rule with nothing to do, we pulled the complete official
export for both markets (919 MY rows, 556 SG rows — every code, not a
manually-scrolled sample) and applied the rule properly: NGR-negative,
confidence ≥95% (claim windows closed, not still-settling), members ≥10 (not
statistical noise). That produced 154 individual negative codes, which is too
broad to be a usable list on its own — so they were grouped into families.
Four are large enough to warrant an actual decision.

**Note on the numbers below:** per `ISSUES_AND_FOLLOW_UPS.md` F-018, the
platform's per-code NGR Lift figures do not sum linearly to a type-level
total. The "combined" figures below are magnitude sums across codes in each
family — useful for judging relative scale, not a precise, platform-validated
total. Treat them as directional.

## What we are asking HOD to approve

**Assign an owner (or owners) and a 14-day deadline**, per the sunset-governance
rule already adopted in D-003, to investigate the four families below. Each
owner returns exactly one of three recommendations per family — keep, cap, or
sunset — with evidence attached. Ownership is not obvious from naming alone
for all four (unlike the Weekly Rescue Bonus / VM FreeCredit investigation,
where `FT_VM_FC_*` clearly pointed to VM) — the first step for whichever
owner is assigned should be confirming who actually created and manages each
family, the same way BO-creator records answered that question for the
Weekly Rescue Bonus.

## The four families

### 1. VM Deposit-Match (`FT_VM_DEP*_GET*`) — 18 codes, combined ≈ −RM695,814

| Code | NGR Lift | ROI % | Members |
|---|---|---|---|
| FT_VM_DEP1000_GET1000_1X | −RM150,900 | −255.8% | 29 |
| FT_VM_DEP700_GET300_2X | −RM123,470 | −155.9% | 145 |
| FT_VM_DEP1000_GET500_1X | −RM63,625 | −106.0% | 104 |
| FT_VM_DEP1000_GET700_2X | −RM61,970 | −82.7% | 61 |
| FT_VM_DEP800_GET400_1X | −RM44,316 | −87.2% | 91 |

`FT_VM_*` naming suggests VM territory, same as the already-known VM
FreeCredit family — but this is a different mechanic (deposit-match, not
free credit) and has not been raised anywhere in this project before now.

### 2. VIP Birthday Bonus (`FC_VIP_BDAY_*`) — 5 codes, combined ≈ −RM457,927

| Code | NGR Lift | ROI % | Members |
|---|---|---|---|
| FC_VIP_BDAY_GOLD | −RM154,380 | −89.8% | 443 |
| FC_VIP_BDAY_SILVER (MY) | −RM133,313 | −62.4% | 1,135 |
| FC_VIP_BDAY_DIAMOND | −RM133,287 | −66.6% | 106 |
| FC_VIP_BDAY_PLATINUM | −RM34,613 | −42.4% | 92 |
| FC_VIP_BDAY_SILVER (SG) | −SGD2,334 | −32.7% | 38 |

Every tier is negative. Only 5 codes but large volume (1,135 members on the
MY Silver tier alone) — this looks like a standing, always-on birthday
mechanic rather than a one-off, similar in shape to the Weekly Rescue Bonus.

### 3. Special Free Credit "Day-sequence" onboarding (`FT_*FC_5X_[tier]_DY*`) — 19 codes, combined ≈ −RM431,577

| Code | NGR Lift | ROI % | Members |
|---|---|---|---|
| FT_58FC_5X_GL_DY1 | −RM192,772 | −405.8% | 819 |
| FT_58FC_5X_SIL_DY4 | −RM68,459 | −72.6% | 1,625 |
| FT_108FC_5X_GL_DY4 | −RM65,388 | −67.3% | 900 |
| FT_38FC_5X_SIL_DY1 | −RM64,784 | −111.0% | 1,536 |
| FT_28FC_5X_BR_DY4 | −RM15,500 | −49.8% | 1,111 |

A tier-segmented, multi-day (Day 1–4) sequence — reads like an automated
onboarding drip. `FT_58FC_5X_GL_DY1` is the single worst individual code
found in this entire pass: −405.8% ROI on 819 members.

### 4. Reload Bonus variants (`FT_REL_*`, assorted `*PCT` reload codes) — 18 codes, combined ≈ −RM207,797

| Code | NGR Lift | ROI % | Members |
|---|---|---|---|
| FT_REL_28PCT_5X_GL_DY3 | −RM53,256 | −289.2% | 116 |
| FT_REL_28PCT_MAX800_D3 | −RM35,374 | −221.4% | 119 |
| FT_REL_TLEO_45PCT_228MX | −RM31,261 | −47.7% | 166 |
| FT_REL_18PCT_MAX200_D2 | −RM15,211 | −609.3% | 102 |
| FT_LC_20PCT_7X | −RM12,789 | −126.1% | 188 |

A grab-bag of differently-configured % reload bonuses — smaller individually
than the other three families, but numerous and consistently negative.

## One overlap and one loose end, flagged separately (not part of a family ask)

- **`FT_BR_RET_40PCT_12X_100`** is one of the 4 codes already getting a cap
  cut in D-003. It shows **−601% ROI** here — worse than a cap reduction
  alone is likely to fix. Worth the deep-dive owner's attention even though
  it's already getting a partial fix.
- **`optimove_my_ss_waterfall_increase_bet_b`** is small (−RM4,371) but is a
  **second Optimove-created code** outside the Weekly Rescue Bonus family —
  same naming pattern, same lack of BO ownership. On its own it doesn't
  justify a fifth family, but it's a signal the Optimove-ownership question
  (F-019) may be broader than one bonus.

## What we are NOT asking for

- We are not sunsetting any code today. This is an investigation directive,
  same shape as D-007.
- We are not asking HOD to action the `FT_BR_RET_40PCT_12X_100` overlap
  separately from D-003's cap cut — it's flagged for the same investigation,
  not a parallel process.
- We are not treating the ~90 smaller, scattered one-off negative codes found
  in the same pass as worth individual attention — they're real but small,
  and chasing every one of them is not a good use of a deep-dive owner's time.

## What happens on approval

- Owner(s) assigned within the timeframe the sunset-governance rule already
  sets: 14 days.
- First step for each family: confirm who created/manages it in the BO
  record, the same check that identified the Weekly Rescue Bonus's ownership
  gap.
- Owner returns keep/cap/sunset per family, with evidence, inside the 14-day
  window.

## What happens on rejection

- The sunset-governance rule stays adopted but idle a second time — worth
  naming explicitly if that's the outcome, since the rule was written
  specifically to give candidates like these a real process.
