# HOD Decision Proposals — 2026-07-27 (corrected 2026-07-28, SG added 2026-07-29, D-008 added 2026-07-30)

Six one-page proposals for the next HOD sitting. Each is decision-ready
with numeric evidence attached from `outputs/pvc-csir-probe/`.

| # | Proposal | Ask | Evidence |
|---|---|---|---|
| **D-003** | [Cap governance + 4 cap cuts + sunset-governance rule](D-003_cap_governance.md) | Cut caps on 4 codes, adopt monthly cap-review rule, adopt a sunset-governance rule | `cap-audit-my.json` |
| **D-004a** | [Pilot #1 — Reactivation](D-004a_pilot_reactivation.md) | Scale FT_CHURN14DAYS_20_PCT design with holdout | `deposit-lift-attribution-my.json` |
| **D-004b** | [Pilot #2 — Retention](D-004b_pilot_retention.md) | Test FT_PAYDAY_100FS_GOO_MD250 with holdout | `deposit-lift-attribution-my.json` |
| **D-006** | [Attribution methodology](D-006_attribution_methodology.md) | Adopt the existing official Bonus Performance Dashboard as the standard attribution source (no new interim rule) | Company Performance Dashboard, live |
| **D-007** | [Weekly Rescue Bonus + VM FreeCredit investigation](D-007_10PCT_investigation.md) | Assign owner, 14-day deadline — now scoped to both MY and SG | Company Performance Dashboard, live; `outputs/pvc-csir-probe/sg-official-dashboard-crosscheck.json` |
| **D-008** | [Four underperforming code families investigation](D-008_underperforming_families_investigation.md) | Assign owner(s), 14-day deadline, per the D-003 sunset-governance rule | Company Performance Dashboard, full YTD export; `outputs/pvc-csir-probe/official-dashboard-exports/` |

**2026-07-28 correction:** D-006 and D-007 were both revised after the CSIR
deposit-lift prototype was cross-checked against the company's official
Bonus Performance Dashboard. `10PERCENTUNLIMITEDBONUS` (D-007's original
subject) was a false positive — it is actually a top performer. D-006 no
longer proposes a new interim rule; it proposes adopting the tool that
caught the error. **2026-07-29:** D-007's scope extended to Singapore,
which shows the identical FreeCredit pattern as Malaysia. **2026-07-30:**
D-003's sunset-governance rule found its first two candidates were also
wrong on the same kind of unverified read — retracted, see that proposal's
own correction note — which led to pulling the full official export instead
of relying on samples. That full pass produced D-008.

## Not in this pack (still to draft)

- **D-002** — Standard campaign brief template (still pending — a 30-minute
  desk task as of 2026-07-27; hasn't moved in 2 days)
- **D-005** — Formal reactivation definition

## Candidate for a future proposal (currently logged as an issue, not yet a decision ask)

- SG gamification-campaign ownership (LuckyWheel/ScratchMania/2018XMAS) — see
  `ISSUES_AND_FOLLOW_UPS.md` F-013. Performance is resolved (the family is
  net positive — see F-017, corrected); ownership is still unconfirmed.
  Currently an open issue rather than a formal ask because ownership isn't
  confirmed yet — once it is, this is a natural D-009.
