# TLEO popup + MT subject drift — root causes & QC pattern

Three compounding failure modes that surfaced on QPRO3/4/10 (and partly QPRO2)
during the TLEO rollout. Document for future cross-brand QC.

## Root causes

1. **Narrow popup-create filter.** Original `bin/_add-dialog-popup-tleo.mjs`
   used API filter `code=FT_REL_TLEO`, which silently missed any TLEO code
   without the `FT_` prefix (e.g. `REL_TLEO_SL_20PCT_10MX`). One-time runs
   leave such codes permanently popup-less.

2. **Out-of-order rollout.** Popup-create scripts are one-shot loops over
   *existing* TLEO codes. When new codes are replicated to a brand AFTER the
   popup script ran (very common when adding codes brand-by-brand), nobody
   re-runs the script. QPRO3/4/10 had 10 of 11 affected codes created later.

3. **Generic MT subject placeholders.** When inbox MTs were cloned/created on
   older brands, the Subject field was filled with a generic
   `"Exclusive Offer"` / `"独家优惠"` instead of the descriptive
   `"Time Limited Exclusive Offer - X% Reload Bonus (Live Casino Only)"`. The
   popup-create script *copies the MT subject into popup label and title at
   create time*, so any popup that was created on these brands inherited the
   bare title — cascading the issue into popup display.

## Brand-by-brand state (post-fix 2026-05-29)

| Brand          | TLEO codes | Popup linked | MT subjects | Notes                                  |
|----------------|------------|--------------|-------------|----------------------------------------|
| qpro2 (source) | 54         | 54/54        | clean       | Popups added 2026-05-29 after operator request. |
| qpro3          | 54 (subset)| 11/11 fixed  | descriptive | Fixed in session.                      |
| qpro4          | 54 (subset)| 11/11 fixed  | descriptive | Fixed in session.                      |
| qpro5          | 54         | 54/54        | descriptive | Created from scratch end-to-end.       |
| qpro7          | 54         | 54/54        | descriptive | Created from scratch end-to-end.       |
| qpro10         | 54 (subset)| 11/11 fixed  | descriptive | Fixed in session.                      |
| qpro15         | 54         | 54/54        | descriptive | Created from scratch end-to-end.       |
| qpro16         | 54         | 54/54        | descriptive | Created from scratch end-to-end.       |

## Forward fixes (already applied)

- **Broader popup-create filter** in `bin/_create-popups-qpro3-4-10.mjs` —
  filters `code=TLEO` (catches all variants).
- **Idempotent.** Skips codes that already have a linked popup. Safe to re-run
  any time new codes are added.
- **Cross-brand subject drift QC.** `bin/_diff-mt-titles.mjs` compares any
  brand's MT subjects to a canonical brand (qpro5). Re-run before any cross-
  brand release.
- **Title-fix script.** `bin/_fix-bare-titles-qpro3-4-10.mjs` updates MT
  subjects + popup label + per-locale popup title + popup content references
  in one pass. Idempotent (only acts on `subject==="Exclusive Offer"` or
  `subject==="独家优惠"`).

## Permanent prevention

When rolling out TLEO (or any code family) to a new brand, run in this order:

1. Create promos (with descriptive MT subjects from the start).
2. Create popups via the `code=TLEO`-filter script (`_create-popups-...`).
3. Run `_diff-mt-titles.mjs` against qpro5 canonical — fix any drift.
4. Run `_check-tleo-popups-Nbrands.mjs` — confirm all codes linked.
5. Final QC via `_qc-tleo-final.mjs` (covers categories, MT, SMS, popup, BL,
   GP, brand vars, SGD-clean).

Steps 2-5 are now idempotent and safe to re-run after any later code addition.

## QPRO2 source gap (resolved 2026-05-29)

qpro2 originally had *zero* TLEO popups (54/54 missing). Operator confirmed
qpro2 should have popups too; ran `bin/_create-popups-qpro2.mjs` (54 saves,
0 errors, popup IDs 215-268). qpro2's popups emit 4 locales (MY_EN/MY_ZH/
SG_EN/SG_ZH) since qpro2 supports MYR+SGD, vs the 4 other brands which are
MYR-only. Same script pattern works on any future brand — just adapt the
`BRAND` constant.
