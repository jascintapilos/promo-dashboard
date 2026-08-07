# D-006 — Attribution Methodology: Adopt the Existing Official Tool

**Decision owner:** HOD + Data-BI
**Prepared by:** Promotion
**Date:** 2026-07-27 (superseding the 2026-07-27 draft, which proposed a new
interim deposit-lift rule)
**Evidence:** Company Performance Dashboard — Bonus Performance Report,
`company-dashboard.enigmagames.cc/bonus-performance-report`

## Correction notice

An earlier draft of this proposal asked HOD to endorse a new, interim
deposit-lift attribution rule built from CSIR ClickHouse, on the basis that
no NGR-based attribution existed yet. That premise was wrong. **The company
already operates a production attribution tool** — the Bonus Performance
Report on the Company Performance Dashboard — which computes NGR-based
lift and ROI against a player-level baseline, with a stated confidence
metric, and is already used elsewhere in the business. Proposing a new
interim rule would have duplicated an existing, more rigorous tool.

## What we are asking HOD to approve

**Adopt the existing Bonus Performance Report as the standard attribution
source for Promo Value Creation reporting**, filtered to WS1, in place of
building or endorsing a separate interim methodology.

## Why this is the right call

The dashboard's methodology (see its built-in Metrics Guide) is more
rigorous than the interim rule previously proposed:

| Metric | Definition |
|---|---|
| Deposit Lift | Extra deposits above what the member normally deposits, time-decay and bonus-amount weighted |
| NGR Lift | Extra NGR above what the member normally generates, same weighting |
| ROI % | NGR Lift / Bonus Cost. >100% profitable; <0% = over-giving |
| Confidence % | Data completeness — 100% means all claims have completed their 7-day observation window |

This is a genuine NGR-based measure (not a deposit proxy), already carries
its own confidence/completeness signal, and has been validated against 200+
live WS1 bonus codes across three bonus types with results ranging from
+259% ROI to −758% ROI — it clearly discriminates strong performers from
value-destroying ones.

## What this replaces

- The CSIR-based deposit-lift prototype (`post_30d − pre_30d` deposits) that
  was going to be proposed as an interim rule. That prototype is retired —
  it produced at least one materially wrong read (see D-007 correction
  notice) because deposit change is not the same as revenue change.
- Any future PVC reporting should pull from the Bonus Performance Report
  rather than re-deriving lift metrics from raw ClickHouse tables.

## Limitations HOD should still accept

- **7-day window.** The dashboard measures impact over 7 days post-claim,
  not 30. This is a deliberate design choice by whoever built the tool, and
  is different from the pilot designs in D-004a/D-004b (which use 30-day
  windows to match a longer behavioural signal). The two are not directly
  comparable without adjustment.
- **Confidence % matters.** Some codes (e.g. FT_PAYDAY_100FS_GOO_MD150 at
  78.4% confidence) have not yet had all claims complete their observation
  window — their ROI figures may still shift.
- **Correlation, not causation**, same as any baseline-comparison method.
  The two pilots (D-004a, D-004b) remain the only causal evidence sources,
  since they use a randomised holdout.

## What we are NOT proposing

- We are not asking HOD to approve NGR-attributed revenue reporting company
  -wide. This decision is scoped to Promo Value Creation adopting an
  existing tool for its own reporting.
- We are not proposing changes to the dashboard itself or its methodology.
- We are not deprecating CSIR ClickHouse access — it remains useful for
  segment sizing, audience counts, and campaign inventory work that the
  dashboard does not cover.

## What happens on approval

- Promotion uses the Bonus Performance Report (WS1 filter, relevant date
  range) as the source for all future PVC cost/ROI reporting.
- The two pilots (D-004a, D-004b) are evaluated using both the dashboard's
  7-day NGR Lift/ROI and their own 30-day randomised-holdout design, since
  the pilots need causal proof that the dashboard's baseline-comparison
  method cannot provide alone.
- Data-BI is invited to review whether the dashboard's existing methodology
  is suitable as the company-wide standard (a separate, larger decision
  outside this project's scope).

## What happens on rejection

- Promotion would need to justify building a parallel, less rigorous
  interim metric instead of using what already exists — not recommended.
