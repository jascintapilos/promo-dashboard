# D-007 — Weekly Rescue Bonus & VM FreeCredit Family Investigation Directive

**Decision owner:** HOD
**Prepared by:** Promotion
**Date:** 2026-07-27 (superseding the 2026-07-27 draft that named 10PERCENTUNLIMITEDBONUS); scope extended to Singapore 2026-07-29
**Evidence:** Company Performance Dashboard — Bonus Performance Report,
`company-dashboard.enigmagames.cc/bonus-performance-report`, WS1 MY + SG, YTD 2026-01-01–2026-07-27.
Full SG detail: `outputs/pvc-csir-probe/sg-official-dashboard-crosscheck.json`

## Correction notice

An earlier draft of this proposal identified `10PERCENTUNLIMITEDBONUS` as the
top waste candidate, based on a CSIR deposit-lift proxy (+0.85% deposit lift
on RM 1.3M spend). Cross-checked against the company's official Bonus
Performance Dashboard — which computes **NGR Lift** and **ROI%** against a
player-level baseline, not just deposits — that code is in fact one of the
**best-performing codes on WS1** (+259.3% ROI, 98.6% confidence). Deposit
lift and NGR lift are different things: a member can deposit a similar
amount but generate materially different net revenue. This proposal is
corrected below using the official metric.

## What we are asking HOD to approve

**Assign an owner and a 14-day deadline** to investigate the **Weekly Rescue
Bonus family** (`optimove_my_weekly_rescue_bonus_tier_*` in MY,
`optimove_sg_weekly_rescue_bonus_tier_*` in SG — 4 tiers and 7 tiers
respectively) and the **VM FreeCredit family** (`FT_VM_FC_VARIABLE_8X_V2`,
`FT_VM_FC_VARIABLE_5X_V2`, `FT_VM_FC_388_8X`, `FC_VIP_BDAY_SILVER` in MY;
9 further `FT_VM_FC_*` codes in SG), across **both MY and SG**, and
return a recommendation: continue, cap, sunset, or migrate.

## Why this is urgent

WS1's overall bonus program is running at **−14.6% ROI** YTD (NGR Lift
−RM 1,599,231, 98.1% confidence) — but that headline number hides a split:

| Bonus type | NGR Lift | ROI% | Confidence |
|---|---|---|---|
| DepositBonus | +RM 3,737,614 | **+109.6%** | 98.6% |
| FreeSpinBonus | +RM 936,839 | **+124.3%** | 95.6% |
| **FreeCredit** | **−RM 6,273,506** | **−91.9%** | 99.0% |

DepositBonus and FreeSpinBonus are healthy. **FreeCredit alone is dragging
the entire WS1 program negative**, and it is dominated by two families:

| Code | NGR Lift | ROI% |
|---|---|---|
| Weekly Rescue Bonus — tier A | −RM 2,889,538 | −242.5% |
| Weekly Rescue Bonus — tier B | −RM 1,196,823 | −758.1% |
| Weekly Rescue Bonus — tier C | −RM 584,361 | −461.0% |
| Weekly Rescue Bonus — tier D | −RM 489,050 | −292.2% |
| FT_VM_FC_VARIABLE_8X_V2 | −RM 1,012,039 | −108.6% |
| FT_VM_FC_VARIABLE_5X_V2 | −RM 509,858 | −148.6% |
| FT_VM_FC_388_8X | −RM 179,743 | −64.0% |
| FC_VIP_BDAY_SILVER | −RM 131,807 | −61.7% |

The Weekly Rescue Bonus tiers alone account for roughly **RM 5.2M** of
negative NGR lift — more than 3x the size of the code originally (and
incorrectly) flagged in the prior draft. All four tiers are negative; this
is not a one-off, it is systemic to the mechanic.

### Singapore confirmed 2026-07-29 — identical pattern, not a separate problem

WS1 SG's overall program is running at **−36.1% ROI** (NGR Lift −SGD 229,202,
97.7% confidence), the same split as MY:

| Bonus type | NGR Lift | ROI% |
|---|---|---|
| DepositBonus | +SGD 109,592 | **+41.4%** |
| FreeSpinBonus | +SGD 38,434 | **+125.0%** |
| **FreeCredit** | **−SGD 377,228** | **−111.2%** |

Every one of the **39 SG FreeCredit codes checked is NGR-negative** — none
are profitable. Worst offenders, same two families as MY:

| Code | NGR Lift | ROI% |
|---|---|---|
| FT_VM_FC_VARIABLE_8X_V2 (Kevin/VM) | −SGD 106,331 | −184.2% |
| Weekly Rescue Bonus — S$118 | −SGD 60,069 | −737.8% |
| Weekly Rescue Bonus — S$68 | −SGD 46,589 | −806.0% |
| Weekly Rescue Bonus — Diamond | −SGD 46,098 | −267.5% |
| Weekly Rescue Bonus — Silver | −SGD 44,666 | −313.3% |
| Weekly Rescue Bonus — Platinum | −SGD 32,071 | −247.3% |
| Weekly Rescue Bonus — Gold | −SGD 20,811 | −116.2% |
| FT_VM_FC_288_8X (Kevin/VM) | −SGD 16,310 | −202.3% |
| FT_VM_FC_388_8X (Kevin/VM) | −SGD 15,471 | −81.4% |

Full 39-code detail: `outputs/pvc-csir-probe/sg-official-dashboard-crosscheck.json`.
**Correction, 2026-07-30:** an earlier version of this proposal flagged five
2026-dated LuckyWheel codes as an extreme-negative-ROI pattern. Those five
codes are real, but pulling the full official YTD export (not a manual scroll
of the results grid) shows the LuckyWheel family is actually net positive in
both markets — +SGD 61,809 across 147 SG codes, +RM852,262 across 318 MY
codes. LuckyWheel is not part of this investigation and should not be cited
as a problem. See `ISSUES_AND_FOLLOW_UPS.md` F-017 for the full correction.

**Note on the numbers above:** per-code NGR Lift figures do not sum linearly
to the type-level total shown (the platform's own attribution uses
overlapping-window, time-decay baselines). Treat each code's own row, and
the type-level total, as the two trustworthy numbers — do not add codes
together and present that sum as a share of the total.

### Lead: promo is meant to be player-visible, but the BO record says otherwise (flagged 2026-07-29)

Promotion confirmed the Weekly Rescue Bonus is meant to be visible to players
and self-claimable — not purely a CRM-pushed, individually-targeted offer.
That was checked directly against the BO (`GetPromotionInfoByCode`, all 14
tier codes, 7 MY + 7 SG) and found to conflict with the persisted record:

- **`IsPublished: false` on all 14 tier codes**, in both markets. This is the
  field that normally controls whether a promo is listed on the
  customer-facing promotions page. By this field, none of them are public.
- **`CreatedBy` and `ModifiedBy` are both `null` on all 14 codes** — there is
  no human BO account attributed as the creator or last editor of any tier,
  consistent with these having been created by an automated integration
  (Optimove-side) rather than through the normal BO UI by a named person.
- **Start dates are 07/05/2022 or 16/05/2022, end dates 01/01/2030**, on
  every tier in both markets — confirms this has been running essentially
  untouched for 4+ years.

This is not just a data-hygiene footnote. If the bonus is genuinely open to
self-claim rather than narrowly reaching players who are actually at risk of
churning, that is a strong candidate explanation for why every tier, in both
markets, over 4+ years, shows deeply negative ROI — an openly-claimable
"rescue" bonus is exactly the shape of offer that draws repeat, low-value
claims rather than reaching the genuinely lapsing high-value players it may
have been designed for. Full raw data:
`outputs/pvc-csir-probe/weekly-rescue-bonus-bo-config.json`.

**This should be the investigation owner's first line of inquiry**: confirm
the actual channel through which players encounter this promo (a page, an
app listing, an email, an SMS?), and who controls that channel — which may
be a different person or team than whoever has BO edit access to the
promotion record itself.

## Scope of the investigation

The owner should return answers to these five questions:

1. **What is the Weekly Rescue Bonus mechanic?** What tier structure, trigger
   condition, and reward size does each tier use? Who created it and when?
2. **Who owns it today?** Confirm whether the "Weekly Rescue Bonus" and the
   VM FreeCredit codes share an owner (VM lead is the likely candidate given
   `FT_VM_FC_*` naming) or are separately managed.
3. **What is the intended objective?** Is this meant as a save/retention
   mechanic for at-risk VIPs? If so, why is NGR lift negative across every
   tier rather than just low?
4. **Is the mechanic itself flawed, or is targeting the issue?** Compare cap
   size, trigger condition, and eligible segment across tiers. Determine
   whether the bonus is too generous for the players it reaches, or whether
   it is reaching the wrong players (e.g. already-declining VIPs who would
   not have returned regardless). **Start with the lead above** — if this is
   genuinely self-claimable rather than narrowly targeted, that alone could
   explain the universal negative result better than reward size does.
5. **What are the options?** Cap the reward, tighten eligibility, pause
   specific tiers (the worst tier is −758.1% ROI), or discontinue entirely.

## Deliverable

A 1-page memo to HOD within 14 days:
- Answers to the 5 questions above, covering both the Weekly Rescue Bonus
  family and the VM FreeCredit family
- Per-tier recommendation (not a single blanket call — tiers range from
  −64.0% to −758.1% ROI, so the fix may differ by tier)
- Estimated monthly saving if the worst 1–2 tiers are paused immediately

## What we are NOT proposing

- We are not asking HOD to sunset any of these codes today. This is an
  investigation with a 14-day deadline, not an immediate mechanic change.
- We are no longer treating `10PERCENTUNLIMITEDBONUS` as a waste candidate —
  it should be removed from any future waste-review list; it is a strong
  performer.

## What happens on approval

- Owner assigned, VM FreeCredit family: Kevin (VM lead), given the
  `FT_VM_FC_*` naming pattern across both the MY and SG non-tiered codes.
  Solid — not really in question.
- Owner assigned, Weekly Rescue Bonus family: **candidate is Abigail and
  Cedric's team** (confirmed to run WS1 campaigns through Sales and CRM),
  jointly — not split across two separate functions, since they are the
  same team. **This is provisional, not confirmed** — it is inferred from
  team context, not from any BO or Optimove record, since nothing in the
  BO shows a human owner for these codes at all. Confirm before treating it
  as final, and specifically confirm who administers the Optimove
  integration these codes actually run through — that may or may not be
  the same person.
- 14-day investigation with weekly status updates, covering both markets.
- Owner returns memo to HOD; HOD decides per-tier/per-code action.

## What happens on rejection / deferral

- FreeCredit-type bonuses continue running at approximately −RM 6.3M NGR
  lift YTD pace, with no active management of the worst-performing tiers.
- Cost-governance credibility of the wider project weakens (we identified a
  much larger waste pattern than originally reported and did nothing).
