# Design: Pillar Enhancements — Wave 1 (Acquisition / Retention / VIP)

**Status:** DESIGN — awaiting approval to write the implementation plan
**Created:** 2026-08-27
**Goal:** Add the approved first-wave analyses to the three live pillar tabs so each verdict is (a) shown to be robust, not noise/one-whale, and (b) framed as *incremental* impact, plus the pillar-specific flagship views and anti-abuse leakage reads.
**Audience:** CEO / stakeholders. Plain language, decision-first. Every number stays consistent with existing conventions (NGR net of bonus, break-even 0; reads directional own-baseline unless a holdout is named).
**Report:** single self-contained `templates/acq-dashboard.html`; metrics injected by `bin/build_acq_dashboard.mjs` from `scratchpad/{acq,ret,vip}/*-metrics-MY.json`. Member-level data stays in scratchpad, never committed.

## Architecture (every item follows the same 3 steps)
1. **Compute** in the pillar's Python pipeline (`bin/{acq,ret,vip}_report/`), reading aggregated metrics + member-level rows already in scratchpad. Reuse fields that already exist (several do).
2. **Emit** a new block/fields into that pillar's `*-metrics-MY.json` (aggregated only — no member rows).
3. **Render** a view in the template (a section via the existing numbered-TOC builder, a chart via the existing SVG helpers + `axTitle`, or a column on an existing decision table). Plain-language caption + "how to read".

Verify-first per item: recompute cross-foots to raw, sanity ranges, no PII in committed JSON.

## Scope — the four approved bundles

### Bundle A — Trust & fragility layer (cross-cutting, all 3 decision tables)
The shared robustness infrastructure. For every graded code, compute and show:
- **n behind the verdict** — depositors/claimers the call rests on, + matured-window share.
- **One-member fragility** — top member's share of the code's NGR-lift (or FTD), and a flag: *does the verdict still hold with the single biggest member removed?*
- Render as compact columns/badges on the Acquisition, Retention, and VIP (Lane A/D) decision tables, + a one-line "how to read confidence" note. Provisional/low-n or one-whale-carried verdicts get a muted "provisional" tag.
- Data: acq `claim-outcomes-MY.json`, ret/vip `claim-rows-MY.json`; counts already partly present (`ftd_mature`, `claimers`). **Buildable now.**

### Bundle B — One flagship per pillar
- **Acquisition — Spend-vs-FTD Pareto + leave-one-out headline.** Codes sorted by spend; spend-share vs FTD-share (Lorenz/Gini); a strip re-blending cost-per-FTD dropping each top-5 spender (does the RM72 headline flip?). Names codes to CAP/CUT, protects lean ones. Data: `codes[].spend/spend_new/ftd`. **Now / M.**
- **Retention — Lifecycle allocation** by recent-deposit-gap bucket. Spend-share + NGR-per-RM1 + redeposit rate across active/cooling/dormant/lapsed/120d+. Answers: is budget reaching at-risk players or subsidising the already-active? Data: `by_recency` (**already computed, shown nowhere**). **Now / M.**
- **VIP — At-risk whale ledger.** The cooling top players and the NGR walking out with each; turns the whale-concentration finding into a named action list. Data: `member-ledger-MY.json` + `program.whale`. Aggregated/ranked output only, no identifiers beyond an opaque player ref. **Now / M.**

### Bundle C — Incrementality sharpening (Retention + VIP)
- **Retention — extra-vs-baseline.** Redeposit/NGR uplift over the tier×mechanic normal (`tier_normal_mech`/`tier_normal_cell`), and **cost per INCREMENTAL retained player** (subtract players who'd have redeposited at baseline). Labelled directional, not causal. **Now / M.**
- **VIP — trust the cashback read.** Placebo (date-shifted) + common-support + 60/90-day durability on the Lane B "pays for itself" verdict, from `cashback-incrementality`/`rescue-forward`. Says plainly when the data can/can't settle it. **Now / M.**

### Bundle D — Anti-abuse / leakage
- **Acquisition — claim→deposit funnel with freebie-hunter RM leakage.** Claimers → depositors → stuck, with RM attached to the drop-off (spend on claimers with zero FTD), per code + blended → a concrete guardrail number. Data: `claim-outcomes-MY.json`. **Now / S.**
- **VIP — bonus-farming watchlist.** Codes/members with abuse fingerprints (one player eating a code; many accounts hitting code after code). Aggregated counts + opaque refs. Data: `claim-rows` + `member-ledger`. **Now / S.**

## Gated (NOT in this wave — need data we don't have)
True-new vs long-lapsed split (registration dates), cash-and-dash (withdrawal amounts), LTV payback (registration dates). Buildable only as labelled sensitivity bands later; parked in each tab's "Coming soon".

## Phasing (FLAGSHIP-FIRST — each phase ends at a CHECKPOINT for approval)
- **P1 Acquisition** — Pareto + leave-one-out headline flagship; claim→deposit funnel leakage.
- **P2 Retention** — lifecycle allocation flagship (`by_recency`); incrementality proxy + cost-per-incremental.
- **P3 VIP** — at-risk whale ledger; cashback trust (placebo + durability); bonus-farming watchlist.
- **P4 Trust & fragility layer** — per-code coverage + one-member fragility in all 3 pipelines → metrics, rendered as an **expandable confidence sub-row** per code on the Acquisition / Retention / VIP decision tables (tables stay clean; n, matured %, one-whale test on expand).
Each phase: compute → emit → render → `--verify` build → DOM/console check → screenshot-equivalent evidence.

## Success criteria
- Every graded code on all 3 tabs shows its n + a one-whale-fragility signal; provisional verdicts visibly flagged.
- Each pillar gains its flagship view; Ret/VIP show incremental (not just raw) impact; Acq/VIP surface leakage/abuse RM.
- All figures cross-foot to raw; plain language (0 jargon scan); console clean; light+dark OK.
- No member-level data in any committed file. Existing views unbroken (numbered TOC, sticky tabs, axis labels, definition cards intact).

## Open choices for the user
1. **Scale/scope of the trust layer render** — compact inline columns (denser tables) vs. an expandable "confidence" sub-row per code. Default: compact columns + a muted "provisional" tag.
2. **Whale/farming identifiers** — show an opaque player ref (e.g. hashed/short id) or rank-only ("Whale #1"). Default: rank-only + tier, no identifier, to keep it shareable.
3. **Build order** — as phased above (infra-first) vs. flagship-first (visible wins sooner). Default: infra-first so the trust layer is consistent before layering views.
