# Promo Value Creation — Executive Status

- **Reporting date:** 30 July 2026 (corrected 28 July; SG confirmed 29 July;
  D-008 added 30 July)
- **Overall status:** Amber-Green — data readiness essentially complete;
  6 evidence-backed decisions are ready for HOD approval.

## Correction notice (28 July, extended 29 July)

Cross-checking the CSIR deposit-lift prototype against the company's
official Bonus Performance Dashboard (NGR Lift + ROI% + Confidence%,
already in production) surfaced a material correction: `10PERCENTUNLIMITEDBONUS`
was wrongly flagged as the top waste candidate in the 27 July version of
this pack. The official metric shows it is actually a strong performer
(+259.3% ROI). The real driver of WS1's negative program-level ROI is the
**FreeCredit bonus type** (−91.9% ROI, −RM 6.27M NGR lift YTD), led by the
**Weekly Rescue Bonus** family (4 tiers, ≈−RM 5.2M combined) and a smaller
VM FreeCredit code family. The attribution-tool adoption proposal and the
Weekly Rescue Bonus investigation below reflect the corrected position. Both
pilot proposals are unaffected — their underlying codes remain strong
performers under the official metric.

**29 July — Singapore confirmed to have the identical problem.** WS1 SG
overall is −SGD 229,202 NGR lift (−36.1% ROI). FreeCredit is again the sole
cause: −SGD 377,228 (−111.2% ROI), while DepositBonus (+41.4%) and
FreeSpinBonus (+125.0%) are both healthy — same shape as Malaysia. Every
one of the 39 SG FreeCredit codes checked is NGR-negative; none are
profitable. The same two families are responsible: the Weekly Rescue Bonus
SG tiers (7 tiers, all negative) and Kevin's VM FreeCredit SG codes (9
codes, all negative). The single largest SG loss is `FT_VM_FC_VARIABLE_8X_V2`
at −SGD 106,331 (−184.2% ROI). **Correction, 30 July:** an earlier version of
this notice flagged five 2026-dated LuckyWheel codes as an extreme-negative
pattern. Pulling the full official YTD export (rather than a manually
scrolled sample) shows the LuckyWheel family is actually net positive in
both markets — +SGD 61,809 across 147 SG codes, +RM852,262 across 318 MY
codes. LuckyWheel is not part of the FreeCredit problem and should not be
cited as one. One methodology caution from this
pass: the dashboard's per-code figures do not sum linearly to its own
type-level totals (confirmed a ~1.5x gap when the 39 SG FreeCredit codes
were added up by hand) — so family subtotals should be read as directional,
not as an exact share of the type total. Full detail:
`outputs/pvc-csir-probe/sg-official-dashboard-crosscheck.json`.

## Executive summary

The project has moved from evidence baseline to evidence-based decisions. All
three WS1 source teams (CRM, Sales–TSM, VM/AM) have provided their 2026 code
lists, which are ingested into the Campaign Discovery workbook. A read-only
CSIR ClickHouse connection is in place. Cap utilisation, per-code claim rates,
and a deposit-lift attribution prototype have been produced on live data.

The next step is not more data collection. It is an HOD sitting to endorse
the six decisions listed below so cost governance can begin and controlled
pilots can launch.

## Completed since last reporting cycle

- Management framework presentation delivered; project mandate confirmed
- WS1 team-managed campaign inventory: **334 rows** (26 VM + 60 TSM + 248 CRM)
- Kevin's cross-brand codes probed against QPRO 1–17 + QP2 A/B/C/D + WS1 MY/SG;
  non-WS1 rows archived to a separate tab
- CSIR read-only connection QC passed 2026-07-23; extended usage 2026-07-27
- Per-code performance (300 codes, WS1 MYR) analysis: claim rate, cost, FTD
- Cap-audit sample: 40+ codes with actual bonus paid vs cap
- Deposit-lift attribution prototype: 30 codes with n≥20 claimants each
- Segment audience sizing from CSIR: WS1 MY = 1.16M members segmented
- Campaign brief field completeness across the 334 rows: 100% category,
  100% objective (inferred), ~99% segment, 100% success measure defaults

## Decisions ready for HOD approval

| # | Decision | Evidence |
|---|---|---|
| D-003 | Approve 4 cap cuts (FT_CHURN14DAYS 500→100, FT_BR_RET_40PCT_12X_100 2000→300, FT_WC26_DEP_30PCT_2K_PLTDMD 2000→500, WC_CHECKIN_15PCT 300→100) | Avg utilisation <15% on all four; zero deposit-risk projection |
| D-004a | Approve Pilot #1 — scale FT_CHURN14DAYS_20_PCT design | +96% deposit lift on 660 members; RM 33k spend for RM 118k incremental deposit YTD |
| D-004b | Approve Pilot #2 — retention family (FT_PAYDAY / FT_RET_88FS) | +2,000+ RM avg lift per member across the family |
| D-006 | Adopt the existing Bonus Performance Dashboard as the standard attribution source (no new interim rule needed) | Already computes NGR Lift + ROI% + Confidence% in production; validated across 200+ WS1 codes |
| D-007 | Assign owner to investigate the Weekly Rescue Bonus family + VM FreeCredit family, MY and SG | MY: FreeCredit type at −RM 6.27M NGR lift / −91.9% ROI YTD — sole driver of WS1's overall −14.6% program ROI. SG: confirmed 29 July to be the identical shape — FreeCredit at −SGD 377,228 / −111.2% ROI, sole driver of SG's overall −36.1% program ROI. All 39 SG FreeCredit codes checked are NGR-negative. |
| D-008 | Assign owner(s) to investigate 4 newly-found underperforming code families (VM Deposit-Match, VIP Birthday Bonus, Special Free Credit Day-sequence onboarding, Reload Bonus variants) | Found 30 July by pulling the complete official YTD export and applying the D-003 sunset-governance rule properly — ~60 codes across 4 families, worst single code −405.8% ROI on 819 members. First real test of the D-003 rule after its original 2 candidates were both retracted. |

## Decisions still requiring formal proposal (not blocking the meeting)

| # | Decision | Missing |
|---|---|---|
| D-002 | Standard campaign brief template | Template not drafted — 30-min desk task |
| D-005 | Formal reactivation definition | Prototype validates 30/90/180-day windows; formal proposal pending |

## Guard-rails

- NGR-attributed reporting for PVC now draws from the official Bonus
  Performance Dashboard (pending HOD approval to formally adopt it), not a
  custom interim rule.
- Negative-lift codes are flagged but NOT recommended for immediate
  sunset without a deep-dive — this now includes the Weekly Rescue Bonus
  tiers and VM FreeCredit family (D-007) and the 4 families found 30 July
  (D-008). `FT_VM_DEP1000_GET500_5X`, previously named here, is retracted —
  the full official export shows it's actually a top-5 program performer
  (+64.3% ROI), not a negative-lift code. Don't cite it as a concern again.
- SG FreeCredit (the Weekly Rescue Bonus and VM FreeCredit families) is now
  cross-checked against the official dashboard and confirmed — no longer
  provisional. Still provisional: SG DepositBonus/FreeSpinBonus at the
  per-code level. LuckyWheel/ScratchMania performance is no longer an open
  question — the full YTD export confirms the family is net positive in
  both markets (F-017, corrected 30 July). The SG gamification-*ownership*
  question (F-013) remains open independent of that — nobody owns the
  family, regardless of how well it performs.
- The official dashboard's per-code figures do NOT sum linearly to its own
  type-level or site-level totals (time-decay, overlapping-window
  attribution). Cite a code's own row or the platform's own rollup —
  never a manual sum of codes presented as a share of a rollup (F-018).
- CSIR ClickHouse remains useful for segment sizing, audience counts, and
  campaign inventory — the correction applies specifically to using deposit
  lift as a stand-in for revenue impact, not to CSIR access generally.

## Next reporting cycle

- Hold HOD sitting for the 6 decisions above
- Complete the standard campaign brief template and the formal reactivation
  definition (both still pending)
- Assign a real owner for the Weekly Rescue Bonus + VM FreeCredit
  investigation, now confirmed in both MY and SG
- Assign owner(s) for the 4 newly-found underperforming families (D-008)
- Find an owner for the SG gamification family (LuckyWheel/ScratchMania/
  2018XMAS) — an ownership question only now; performance is resolved
- Begin pilot design once the two pilot proposals are approved

## Executive message

The project has delivered the evidence base needed to move from planning to
controlled action. Approvals now, not more data collection, are what convert
this into avoidable cost and measurable incremental deposit.
