# Design: Campaign Attribution for the Promo Report

**Status:** APPROVED — ready for implementation plan
**Created:** 2026-08-28
**Goal:** Attribute promo **spend** (exact) and **directional outcomes** (labelled, not causal) to **named campaigns**, per code, and surface the codes that can't be attributed as a **gap register** for the source teams.
**Audience:** HOD / CEO accountability + the project's Goal-1 discovery. Plain language.
**Authority boundary (from the project brief):** Promotion executes; it does not originate campaign objective/segment — CRM, Sales, Marketing own those. A code alone does not prove its objective/segment/attribution. **Never** describe NGR as promo-attributed until the model is validated. No member-level data in Git; identifiers limited to approved workbooks.

## Taxonomy — three tags per code (+ confidence)
- **Owner** (who ran it): CRM · VM · AM · Marketing · Cross-sell · Referral · Unknown
- **Campaign** (theme/event): World Cup · Weekly Rescue · Welcome · Birthday · Daily Check-in · Mini-games · Payday · Reload / VIP-deposit · Referral · Free-spins-by-game · Membership/Entitlement · …
- **Objective**: Acquisition · Retention · VIP · Reactivation · Entitlement (seeded from the existing TL pillar, refined by campaign)
- **Confidence**: rule-high · rule-low · override · unattributed

## Tagging — hybrid (rules → override → gap)
1. **Rules**: name-pattern + config signals (mechanic, deposit_required, promo_type, prefix) assign owner/campaign/objective for the confident majority. Grounding scan: ~58% of codes/spend fall into clear buckets; the ruleset will be extended to capture Referral / Payday / generic Reload / game-specific free-spins to lift coverage.
2. **Manual override** (`campaign-map.overrides.json`, in-repo, no member data): corrections + ambiguous codes once a source team confirms. Override always wins over a rule.
3. **Gap**: anything unresolved → `owner=Unknown, campaign=Unattributed, confidence=unattributed` — quantified, never hidden.

## Attribution rigor — honest by construction
- **Spend: exact.** code → campaign → Σ bonus cost. Even unattributed spend is reported as its own bucket.
- **Outcomes (FTD, NGR-lift, deposits): directional** own-baseline, rolled up by campaign, explicitly labelled *"association, not causal attribution."*
- **Causal:** requires the validated holdout model — named as the next step, never claimed here.

## Architecture (spend + config only; no member rows)
1. `bin/campaign_tag.py` — reads the three pillar metrics' code lists + `promo-config-MY.json` (+ DefineBonus promo_type) + `campaign-map.overrides.json`; emits `scratchpad/campaign-map-MY.json = {code: {owner, campaign, objective, confidence}}`.
2. `bin/campaign_rollup.py` — joins the map to each pillar's codes, emits a `by_campaign` block (per campaign: spend, codes, share-of-spend, + the pillar-appropriate directional outcome) into the metrics, plus a program-level `campaign_coverage` (attributed vs unattributed spend) and a `campaign_gaps` list.
3. Report render — a **"By campaign"** view (new section, likely on Summary): spend-by-campaign bars + a coverage bar (% attributed) + directional-outcome column (labelled), and a compact **gap register** (top unattributed codes by RM).
4. Gap register export — the unattributed codes + RM as a table the user can hand to CRM/Sales/Marketing (report panel now; a Sheet later if wanted).

## Deliverables
- A `campaign` tag on every graded code (owner / campaign / objective / confidence).
- A **"By campaign"** report view: spend + directional outcomes + coverage bar.
- A **gap register**: unattributed codes + RM, for the source teams.

## Success criteria
- Σ campaign spend = Σ pillar spend (every RM lands in a campaign or in Unattributed).
- Coverage bar shows the real attributed-vs-unmapped split; unmapped is actionable, not fake.
- Outcome figures carry the "directional, not causal" label everywhere.
- Overrides win over rules; adding an override re-tags on next run.
- No member data committed; plain language; 0-jargon; console clean.

## Open items / guardrails
- Owner inference from prefix is a *hypothesis* until a source team confirms — mark confidence honestly.
- "Campaign" boundaries (e.g. is "World Cup free-spins" one campaign or split by game) — start coarse, refine via overrides.
- Keep the override file free of any member identifiers.
