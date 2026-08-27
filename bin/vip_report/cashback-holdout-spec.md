# Weekly Rescue Cashback — Holdout Experiment Spec (the definitive test)

**Status:** Protocol — for the business to run. Analysis code (`bin/vip_report/cashback_*`) sizes the prior; this experiment is the proof.
**Date:** 2026-08-27 · **Market:** WS1 Malaysia (MYR)

## Why
The observational validation (base-rate + intensive-margin + within-member + break-even) shows the cashback is **small and sign-ambiguous** on Diamond (cross-section −RM22K/wk vs within-member +RM5.4K/wk) and **dead-weight on Gold/Silver** — but no observational method can prove causation, because **98% of eligible losers claim**, leaving no clean untreated group. Only a randomized holdout manufactures the "what would they have done with no cashback" comparison.

## The question
Per tier: does giving a losing VIP the cashback **cause** more forward net revenue than the identical player with no (or less) cashback — and does the caused revenue clear the payout cost?

## Design (randomize the OFFER at eligibility, never the claim)
- **Gold, Silver, and the flat RM138/RM228 tiers** — **80/20 offer-withhold.** Each weekly eligibility cohort (members with a qualifying prior-7d loss in that tier), block-randomize within tier × week: 80% get the cashback offer as normal, 20% have it suppressed that week. These tiers already read dead-weight, so a full-ish withhold is low-risk and well-powered.
- **Diamond** — **NEVER zero them.** Within-subject **rate crossover**: each Diamond cycles through 29% / 22% / 15% of weekly loss across their claiming weeks in randomized order (member fixed effect absorbs whale-to-whale variance). This asks the real budget question — is the *generous top slice* buying anything — without anyone feeling punished.
- **Platinum** — keep as-is (it already clears break-even); optionally include a small confirmatory 90/10 withhold.

## Endpoints
- **Primary: forward 60–90d NGR, net of the bonus** (continuous; winsorize/log to tame whales) — this is the exact hole the base-rate's binary redeposit missed.
- **Also primary: forward 60–90d deposit amount** (do they deposit more, not just "come back").
- **Secondary:** 90-day churn (no deposit in 90 days).

## Duration & power (rough)
- ~6–10 weekly enrollment cohorts + 60–90d follow-up ≈ **4–5 months**.
- Low/mid tiers: continuous winsorized NGR detects a business-real effect at a few hundred per arm — reached in ~4–8 weeks at current losing-VIP volume.
- Diamond: the within-subject crossover is the only viable route (dozens of members); it detects whether 29% beats 15%, not tiny between-player differences — pre-register the minimum detectable effect and accept that a null = "no evidence the top slice earns its cost."

## Guardrails (non-negotiable)
- Cap Diamond exposure; **VIP-host sign-off** per Diamond in any lower-rate cell; **auto-release** (restore full cashback) on any distress signal.
- **Mask holdout status from front-line VMs** (else they comp the withheld and break the test); monitor VM touches — a manual save of a withheld whale is itself evidence the cashback isn't the lever.
- No member in a withhold/lower-rate cell for **>1 week consecutively**; rotate.
- Analyze **intention-to-treat**; report a complier-average effect (CACE) as secondary if there's non-compliance.

## Decision rule (per tier)
- **Keep at current rate** iff the 95% lower bound of incremental forward NGR (net of bonus) per enrolled member **> RM0** (equivalently ROI CI lower bound > 1.0).
- **Cut / redesign** iff the CI straddles or sits below RM0. **Gold & Silver are the prime suspects** (already fail observationally).
- **Diamond:** if the 15% arm retains and earns as well as 29%, **cut the rate to 15%** — the difference is dead-weight, and it reclaims ~half the RM1.33M at no measured revenue loss. If the top slice proves it pays, keep it.

## What this proves that observation cannot
Randomizing the *offer* removes the three biases observation can't: selection (who claims), the player's own stickiness, and mean-reversion after a bad week. It is the only design where "kept playing" in the control arm is exactly "what they'd have done anyway." **This is the single highest-value experiment in the VIP program** — it puts the RM1.33M Diamond line on proof, not inference.
