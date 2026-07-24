# Promo Value Creation — Claude Continuation Brief

Read this file before changing project material. It is the working context for
the WS1 Promotion Value Creation project, which has HOD and CEO visibility.

## The three goals

1. **Discovery and gap analysis.** Compile campaign objective and segment by
   promo code across WS1 MY and SG. Use this to identify coverage gaps and
   select the reactivation segment with the strongest evidence.
2. **Controlled pilot.** Prepare a reactivation and targeted-campaign pilot
   using source-team objectives and segment criteria. Test effectiveness and
   cost controls, including the minimum effective bonus and promo-cap audit.
3. **Monthly reporting.** Establish a repeatable promotion cost and revenue
   report/dashboard, starting with controlled operational metrics and adding
   NGR only after attribution is validated.

## Authority and data boundaries

- **Promotion executes; it does not originate campaign source, objective, or
  commercial rationale.** CRM, Sales, and Marketing provide those inputs.
- Scope: WS1 MY and SG. Source teams: CRM (Ryan, Claudia); Sales (VM, AM,
  TSM); Marketing stakeholders (KN, CD, JT, YH).
- ClickHouse is the primary analytical source. BO is secondary and is used to
  verify configuration and execution evidence.
- Never describe NGR as promo-attributed until the attribution model is
  documented, validated, and approved.
- Do not place credentials, member-level exports, or other sensitive data in
  Git. Keep identifiers limited to approved, access-controlled workbooks.

## Live project control centre

[Promo Value Creation — WS1 Campaign Discovery & Gap Analysis (Live)](https://docs.google.com/spreadsheets/d/18ngdaD45ni7t0KGuGtLpyRzszpjx9smNVn1LGShZpaE/edit#gid=1812082004)

Use the live Sheet as the operational source of truth:

- **Project Roadmap:** three-goal sequence, team map, decision gates.
- **Campaign Inventory / Gap Summary / Segment Map:** discovery evidence.
- **Action Tracker:** requests, owners, due dates, and resolution evidence.
- **Data Source Map / Team Coverage / AM Code Register:** source coverage and
  data limitations.

The Action Tracker’s explicit goal labels are pending because the connected
Sheets account is temporarily unable to save writes. The Project Roadmap is
already organised by the three goals; do not rebuild or duplicate it.

## Current evidence and guardrails

- Valid WS1 assignment evidence is available for **January–March 2026**.
- Recovered execution evidence covers **1 April–23 July 2026**: 1,439 approved
  executions, 592 unique members, and MYR 657,328 bonus cost.
- April–July assignment denominators are not available; do not present claim
  conversion for this period as complete.
- AM codes may need reconciliation against WS1; AM manages Silver and above,
  while VM manages Gold, Platinum, and Diamond.
- A campaign code alone does not prove its objective, segment, or attribution.
  Obtain these from the source team and record missing evidence as a gap.

## Preferred working sequence

1. Close discovery gaps in code coverage, source objective, segment criteria,
   and campaign period before selecting a pilot audience.
2. Convert agreed source-team inputs into a standard campaign brief and
   calendar entry; pass the quality gate before Promotion setup.
3. Run a small, controlled reactivation or cross-product pilot with a stated
   baseline, exclusions, cap, reward, measurement window, and stop criteria.
4. Review claims, bonus cost, deposits, quality issues, and limitations. Then
   recommend continue, adjust, or stop.
5. Add only validated metrics to the monthly stakeholder report/dashboard.

## Project files

- [Project charter and scope](README.md)
- [Executive status](EXECUTIVE_STATUS.md)
- [Decision log](DECISION_LOG.md)
- [Issues and follow-ups](ISSUES_AND_FOLLOW_UPS.md)
- [Deliverables index](deliverables/README.md)

When updating this repository, preserve existing user changes, keep commits
small and scoped, and do not silently alter the project’s ownership boundary.
