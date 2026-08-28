# Design: Discoveries — Wave 2

**Status:** APPROVED — ready for implementation plan
**Created:** 2026-08-28
**Goal:** Add four new grounded discoveries to the report, each verified to compute against data on hand. Spend/behaviour reads stay directional (own-baseline), never causal; member data stays in scratchpad.
**Audience:** HOD / CEO. Plain language.

## The four discoveries (with verified teasers)

### D1 — Tier-migration engine (VIP tab)
- **Reveals:** who climbs vs. slides a tier, and whether promo spend tracks the climb.
- **Teaser (verified):** 1,082 climbed / 30 slid / 4,954 held; climbers get ~2× the bonus (median RM797 vs RM396) and higher YTD NGR.
- **Data:** `member-ledger` tier_start→tier_end, vip_bonus, ytd_ngr, dep_h1/h2. **Honest framing:** correlation — bigger players both climb and get more bonus; not proof the bonus caused the climb.

### D2 — Minimum effective bonus / sizing (the brief's Goal 2)
- **Reveals:** extra deposit per RM of bonus by bonus-size band → the smallest bonus that still moves behaviour; flags oversized bonuses.
- **Teaser (verified):** deposit-lift per RM — <RM50 = +10.7, 50–150 = +2.9, 150–400 = +0.8, 400–1000 = +0.5, **1000+ = −0.8**. Small bonuses far more efficient; the biggest are counterproductive.
- **Data:** `claim-rows` bonus_cost (banded) + dep_lift (deposit lift vs baseline) + ngr_lift, tier. Directional (own-baseline).

### D3 — GGR-vs-NGR efficiency (VIP tab)
- **Reveals:** players/campaigns with strong house-winnings but thin net because the bonus ate the margin → where to trim without losing play.
- **Teaser (verified):** 1,717 of 6,393 GGR-positive VIPs are "over-bonused" (bonus > 50% of house winnings) = RM1.6M of bonus.
- **Data:** `member-ledger` ytd_ggr / ytd_ngr / vip_bonus; `claim-rows` ggr_lift / ngr_lift for the code view.

### D4 — Value survival to 60/90 days (Acquisition + Retention)
- **Reveals:** do won/retained players keep depositing, or fade after the first return — durable wins vs. flashes; cut by mechanic/lifecycle.
- **Teaser (verified):** VIP claimers 96% still depositing at 90d (very durable — reinforces "they'd stay anyway"); the acquisition/retention cut is where the differentiation should show.
- **Data:** `claim-rows` dep_days_30/60/90 + mature_60/90 (ret/vip); acquisition has 30-day only, shown as the near-term read.

## Architecture (compute → emit → render; member data stays in scratchpad)
- One Python builder per discovery in `bin/{vip,ret,acq}_report/` (or `bin/discovery/`), reading member/claim rows, emitting an aggregated block into the relevant pillar metrics.
- Render a card per discovery on the fitting tab, wired into that tab's render + spec, with axis labels and plain captions.
- Verify per item: cross-foot to raw; sanity ranges; correlation-not-causation labels; 0-jargon; no member rows in committed JSON.

## Guardrails
- D1 especially: label as **association**, not "the bonus caused the climb."
- D2/D4: directional own-baseline; a controlled test is the proof step.
- No member identifiers anywhere; keep to aggregates + tiers/bands.

## Success criteria
- Each discovery renders a clear, plain-language card with a verified headline and an honest caveat.
- D2 explicitly states a "minimum effective bonus" band and flags the oversized codes (feeds the brief's Goal 2 / promo-cap audit).
- All figures cross-foot; console clean; light+dark OK.
