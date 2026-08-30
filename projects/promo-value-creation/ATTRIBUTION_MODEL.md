# Promo NGR Attribution Model

**Status:** DRAFT (validation layer 2). Not yet validated or approved.
**Scope:** WS1 Malaysia. The rules for crediting net revenue (NGR) to a promotion, the confidence tier each method earns, and the gate that licenses the words "promo-attributed."
**Owner to approve:** Sales HOD · Promotions · CRM.
**Why this exists:** the standing project rule — *"Never describe NGR as promo-attributed until the attribution model is documented, validated, and approved."* This document is the **"documented"** step and defines the **validation** and **approval** path. Companion to the three holdout specs (`bin/*/*-holdout-spec.md`), which are the **causal** proof (layer 3); this is the **observational accounting** layer between "NGR near a promo" and "NGR caused by a promo."

---

## 1. What "attributed" means — and does not

Three distinct claims, from weakest to strongest. The report must never let one masquerade as another:

| Claim | Basis | Who licenses it |
|---|---|---|
| **"NGR observed near the promo"** | raw revenue in a window around the claim; no counterfactual | always available; not a finding |
| **"NGR attributed to the promo"** | a **documented, validated accounting rule** credits it, with the confounders disclosed | **this document (once approved)** |
| **"NGR caused by the promo"** | a randomized holdout rules out would-happen-anyway | the holdout (layer 3) only |

**This document licenses the middle claim, and only at Tier 2+ (see §5).** "Attributed" is an accounting statement — *"under rule X, this revenue is booked to this promo"* — not a causal one. Every attributed figure carries its tier and its unremoved confounders. No figure is called "promo-attributed" while it sits at Tier 0–1 or while this document is unapproved.

## 2. The attribution methods in use (inventory)

Documented exactly as coded (source survey across `bin/{acq,ret,vip}_report`). **NGR is net of the bonus in every method** (break-even 0; empirically checked in retention: corr(bonus, GGR−NGR)=0.79) — stated once here, not repeated per row. **Maturity gates by metric, not pillar:** money/NGR-lift → `mature_7`; redeposit/stick → `mature_30`; durability & forward-NGR → `mature_60/90`.

| Method (pillar · lane · card) | Metric | Window | Baseline / counterfactual | Dedup across concurrent codes | Proposed tier |
|---|---|---|---|---|---|
| ACQ · cost per FTD / deposit-lift | new-depositor spend efficiency | 7-day | **none** (new-player baseline treated ≈0) | **none — whole window deposit booked to the claimed code** (time-decay/concurrency *deferred*) | **1 (directional)** — assumes ≈0 baseline; low-purity codes 4×-overstate cost |
| ACQ · 30-day stick | share redepositing ≤30d | 30-day | none | inherits whole-deposit | 0–1 (descriptive) |
| RET · NGR-lift per RM | Σ ngr_lift ÷ Σ bonus | 7-day vs **14-day own pre-baseline**, time-decayed | own 14-day pre-average | **yes — all-bonus concurrency denominator** (a code gets only its fair share of a member-day) | **1 (directional)** — own-baseline |
| RET · redeposit-uplift | actual − expected redeposit | 30-day | **tier×mechanic look-alike** (n≥30 ladder) | comparator-stratified | **1→2 candidate** — look-alike can reach Tier 2 with §6 checks |
| RET · forward-NGR incrementality | fwd_ngr_90 − pre_ngr_90 | **90-day fwd vs 90-day pre** | own prior-90 | per code×member (win-back excluded) | **1 (directional)** — "NOT causal … the holdout is the proof" |
| VIP · Lane A · NGR-lift per RM | Σ ngr_lift ÷ Σ bonus | 7-day vs 14-day own pre | own 14-day pre | yes — concurrency denominator | **1 (directional)** |
| VIP · Lane A · redeposit-uplift | actual − expected | 30-day | tier×mechanic look-alike | Lane-A-scoped comparator | **1→2 candidate** |
| VIP · Lane B · cashback forward-margin | retention-after-loss + fwd 30/60/90 margin | pre-loss 7d + fwd 30/60/90 | own (prior-7d loss returned; own fwd) | per code×member, ring-fenced | **1 (directional)** — 7-day NGR/RM deliberately *not* used |
| VIP · Lane D · pays-for-itself | GGR-coverage; NGR/RM | 7-day | none (break-even test) | per code×member | 0–1 (descriptive) |
| VIP · Lane C · entitlement | downstream NGR; leakage | 7-day + recency | **none — "not graded"** | per code×member | 0 (descriptive) |
| VIP · program ledger (YTD) | per-member NGR/GGR, whale concentration | YTD | none (portfolio census) | **member summed across all 383 codes** (program grain) | 0 (descriptive) |
| VIP · forward grain A/B | fwd NGR/dep 30/60/90 | 30/60/90 fwd vs matched pre | own pre-window | **grain B anchors at first claim, counts each day once**; grain A **must not be summed to member** | **1 (directional)** |

**Three governance facts fall out of this table:**
1. **Two attribution engines coexist for the "same" NGR question** — a *7-day-vs-14-day time-decayed windowed lift* (retention & VIP Lane-A grading) and a *30/60/90 forward-vs-matched-pre pull* (retention incrementality, all VIP forward reads). Different windows, different baselines. They must be **reconciled or explicitly assigned to different jobs** (fast grade vs durability), never quietly compared (§9.6).
2. **Dedup is inconsistent by pillar** — retention/VIP-A **split** a member-day across concurrent codes; acquisition books the **whole** deposit to one code (dedup deferred); the ledger **sums** a member across all 383 codes; forward grain-B **anchors at first claim**. The canonical rule (§3.4) has to pick one basis and reconcile the rest to the member total.
3. **Nothing in the report is above Tier 1 today.** Every graded figure is own-baseline or a thin look-alike, and *every* pipeline self-labels it "directional … a matched control is the proof step." So under §5, **no current figure may be called "promo-attributed"** — the report is honest, but the label is unearned until §6 lifts specific look-alike methods to Tier 2 and the holdouts lift them to Tier 3.

## 3. The canonical rules (what should hold across every method)

1. **Net of bonus, break-even 0.** NGR is already net of the bonus everywhere in this codebase (`01b_ledger.py`: *"NET of bonus — do NOT subtract bonus again"*) — so a positive attributed NGR means margin *after* the giveaway. Never subtract the bonus a second time; never mix a net figure with a gross one in the same comparison.
2. **A stated window, maturity-gated.** Every method credits NGR over a defined post-claim window (a fast 7-day read; the 30/60/90 forward reads). A figure counts a member only once its window has fully elapsed (`mature_7/30/60/90`); immature figures are faded/excluded and labelled still-forming, never presented as settled.
3. **A stated baseline (the counterfactual is the attribution).** What a method subtracts *is* its attribution rule. Three baselines appear, in increasing strength: **own pre-window** (the player's own recent history — cheap, but regression-to-mean- and habit-confounded), **look-alike** (a tier×mechanic peer rate), and **control group** (only in a holdout). A method's tier (§5) follows its baseline.
4. **Credit assignment & dedup — the load-bearing rule.** When a member holds several promos in overlapping windows, the same calendar-day NGR must not be booked to more than one. Canonical rule: **per-member (wallet) attribution counts each day once** (the forward pull's grain B, anchored at first claim); **per-code attribution splits a member-day by an all-bonus concurrency denominator** (retention & VIP Lane-A already do this — a code gets only its fair share), and **per-code figures are never summed up to a member** (that double-counts overlapping windows). Cross-code and cross-pillar figures reconcile to the member-level total, never exceed it. **Known gap:** acquisition currently books the *whole* window deposit to the claimed code (concurrency-split deferred) — acceptable only while welcome bonuses are genuinely the sole bonus at signup; revisit if that stops holding (§9.2).
5. **Organic-baseline honesty.** The share of credited NGR that the baseline could not remove (would-deposit-anyway) stays visible as the method's confound, not silently booked as promo value.

## 4. Confounders, and which baseline removes them

| Confounder | Own-baseline | Look-alike | Holdout |
|---|---|---|---|
| Regression to the mean (claim around a dip) | ✗ (inflates) | partial | ✓ (cancels across arms) |
| Would-deposit-anyway habit | ✗ | partial | ✓ |
| Seasonality / secular trend | ✗ (own before/after spans time) | ✓ if contemporaneous | ✓ |
| Selection (who claims) | ✗ | ✗ | ✓ (randomize the offer) |
| Multi-bonus overlap / double-count | handled by the §3.4 dedup rule, independent of baseline | | |

Read across: **own-baseline methods are Tier 1 (directional); look-alike methods can reach Tier 2 with the checks in §6; only a holdout is Tier 3.**

## 5. Confidence tiers (the governance output — every report figure gets one)

- **Tier 0 — Descriptive.** NGR in the window, no counterfactual. *Not attributed.* Wording: "NGR observed near…".
- **Tier 1 — Directional.** Own-baseline or thin look-alike; RTM/habit unremoved. Wording: *"directional — a read, not proof."* **Most of the report today.**
- **Tier 2 — Attributed (validated observational).** The rule is documented (this doc), reconciled, passes negative controls, and is sensitivity-checked on its load-bearing choices (§6). Wording: *"attributed (observational), net of bonus, confounders X disclosed."* **This is the level the label "promo-attributed" requires.**
- **Tier 3 — Causal.** Holdout-proven. Wording: *"caused (holdout-validated)."*

A figure may be **promo-attributed in the report only at Tier 2+**, only after §7 approval, and always with its tier shown.

## 6. Validation — what upgrades a method from Tier 1 to Tier 2

1. **Documented rule** — window, baseline, netting, maturity, credit-assignment, all in §2/§3.
2. **Reconciliation** — the method's totals tie out and never exceed the member-level wallet total (the forward-pull Lane-B reconcile — *0 diffs vs a freshly regenerated baseline* — is the template; watch the nightly-refresh stale-file trap).
3. **Negative controls** — the method must credit ≈0 where no effect should exist (the acquisition leave-one-out / Pareto check; a holdout dry-run on observational pseudo-arms that must NOT return a false positive).
4. **Sensitivity** — the attributed number is stable under the load-bearing choices (window length, baseline definition, maturity cut, winsorization); if a figure flips when the window changes, it isn't Tier 2.
5. **The Tier-3 upgrade** — the holdout (layer 3) is the only route to "caused"; a method whose Tier-2 attribution the holdout contradicts is demoted, not defended.

## 7. Approval gate

Sign-off by **Sales HOD · Promotions · CRM** on: the §3 canonical rules, the §5 tier of each in-use method, and the §6 validation evidence. Approval licenses the report to use "attributed (observational)" language for the Tier-2 methods only, with tiers shown. **Re-review** when a method's window/baseline changes, when a holdout reads out (a method moves to Tier 3 or is demoted), or quarterly.

## 8. Privacy & governance

Member-level attribution data stays in scratchpad and is never committed; every shared/committed view carries opaque SHA1[:6] refs or aggregates only. NGR is never called promo-attributed while this document is unapproved or a figure is below Tier 2. The attribution rule is auditable and re-derivable (fixed windows, documented baselines, no wall-clock randomness).

## 9. Open decisions (need stakeholder input before validation)

1. **The organic-baseline standard** — how much would-deposit-anyway is acceptable to leave in a Tier-2 figure, and how it's disclosed.
2. **The credit-assignment rule for overlapping promos** — confirm the §3.4 wallet-once / per-code-never-summed rule as policy (it resolves the forward-pull double-count).
3. **Tier thresholds** — the sensitivity/negative-control bars that separate Tier 1 from Tier 2.
4. **Approval owner & cadence** — who signs, and the re-review trigger list.
5. **What "attributed" is allowed to appear on** — internal report only, or stakeholder-facing decks too.
6. **The two attribution engines** (§2 finding 1) — reconcile the 7-day-vs-14-day windowed lift and the 30/60/90 forward pull into one rule, or formally assign them different jobs (fast grade vs durability read) so a figure from one is never compared to a figure from the other.

---

*Layer 2 of the validation program. Layer 1 (measure) is live (the forward pulls); layer 3 (cause) is the three holdout designs. This layer is what lets the report move specific figures from "directional" to "attributed (observational)" — the middle, honest claim — without ever overstating them as caused.*
