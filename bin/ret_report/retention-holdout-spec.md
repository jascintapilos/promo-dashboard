# Retention-Bonus Holdout — Test Protocol

**Status:** design deliverable (not executed). WS1 Malaysia, Retention tab.
**Owner to run:** CRM / Retention with data-team support. **No launch without sign-off + BO/ops execution.**
**Revision:** v4 — narrowed after a third pass confirmed the v3 skeleton is sound (per-code estimand, substitutes-live, net-of-cost KEEP/STOP, calibration-as-the-prize) but flagged two load-bearing corrections and a pre-launch checklist. v4 makes those corrections: **randomize at MEMBER level** (the household unit v3 assumed does not exist in the data — everything keys on MEMBER_ID, and both sibling specs randomize at member level), and **net the bonus exactly once** (this codebase's NGR is already net of bonus — "do NOT subtract bonus again"; `01b_ledger.py`). The §11 gates are the honest hand-off to the data team.
**Companion to** `bin/vip_report/cashback-holdout-spec.md` and `bin/vip_report/frequency-cap-holdout-spec.md` — same member-level, wallet-level, break-even-0 spine.

---

## 1. Why

The observational read (`bin/ret_report/incrementality.py`) says retention players earn **+RM25.4M more net revenue in the 90 days after claiming than the 90 days before — ~+RM10.18 per RM1, 110 of 155 codes net-positive.** It is an **own before/after** read, inflated by **regression to the mean** (players claim around a dip and rebound anyway), **secular/seasonal trend**, and **would-deposit-anyway** habit. A randomized withhold is the only clean separator — and because you cannot hold out 155 codes, the study also tests whether the cheap observational number can be **trusted to grade the codes we never test.**

## 2. The three decisions this design makes (read first)

**Decision 1 — withhold THIS CODE ONLY, not its whole class.** Control has *this one code's* offer suppressed; **every other promo, including same-mechanic substitutes, stays live in both arms.** The estimand is the realistic one: *"offer this code vs don't, in the world as it is (substitutes exist)."* Clean **per-code** effect, small ethical single-instance withhold. Later natural re-offers to control after the outcome window are permitted; within-window they are hard-blocked (§8).

**Decision 2 — prove the OFFER is worth running, not "the bonus itself pays."** A 2-arm withhold cannot separate the bonus money from the salience of being offered it, and you can't run the reminder without the bonus. So the verdict is **KEEP-vs-STOP the promo as a package**, phrased that way throughout. Isolating bonus-from-reminder is a **separate dose experiment** (§10), out of scope here.

**Decision 3 — randomize at MEMBER level** (v3's household/linked-wallet cluster is not constructible — no linkage table exists in BO/ClickHouse; every pull keys on `MEMBER_ID`, and both sibling specs randomize per member). The account-manager-contamination threat that motivated clustering is handled instead by the **§8 entitlement-layer hard block + host fixed-effect + a linked-wallet robustness check** (flag members sharing KYC/bank/device where that data exists; exclude or model them), exactly as the cashback and frequency-cap specs do. Member level maximizes independent units and power.

## 3. Population & the ladder

**Only offer-suppressible, eligibility-gated codes are testable** — a code any member can self-claim off the promo page cannot be withheld. Verify control genuinely cannot see/redeem the tested code; instrument any control-arm redemption as a **leak** (suppression failure, not substitution).

**The calibration ladder — up to 12–15 codes, but sized to what the data supports (§11 gate).** Span the observational range **including the moderate middle** where most of the untested 150 live; balance across mechanics (reload / free-credit / free-spins). **Choose rungs on a period disjoint from the experiment window**, and **freeze the observational x on strictly pre-experiment data** (no player-period overlap). Only ~33 codes have ≥160 mature-90 members and ~58 have ≥80 (median cohort is tiny) — **and because those cohorts overlap heavily (~94% shared) while each member joins at most one tested code (§4), the standalone counts overstate the realizable in-experiment N: the concurrent ladder must partition one shared ~8.5K-member pool, shrinking the big rungs ~35–50%.** So **publish realized member counts and slope-power on the JOINT disjoint ladder assignment (§11), not per-code standalone, before committing the ladder size** — drop any rung under its MDE to a *directional-only* contributor. (A simulated disjoint 13-rung allocation still clears ≥40/arm on 12 rungs, so a workable ladder survives the partition.) Stratify coarsely (tier × 3–4 deposit bands); carry the decile as a covariate.

## 4. Design

Randomized, **member level**, intent-to-treat, two arms:

| Arm | This code's offer | Same-mechanic substitutes + all other promos |
|---|---|---|
| **Control** (~50%) | **withheld** this instance | **unchanged — stay live** |
| **Full offer** (~50%) | offered as normal (self-claim on deposit) | unchanged |

The only systematic difference is this code's offer → a clean per-code, RTM-immune contrast (mean-reversion cancels because it pulls both arms equally).

**Cross-rung independence:** a member must not be Control for one tested code and Treatment for another (it breaks "substitutes stay live" for the tested substitutes). At this codebase's ~94% cohort overlap, **disjoint assignment — each member in at most one tested code — is effectively mandatory**: the "model the overlap" alternative reintroduces exactly this substitute-contamination and is a false escape hatch. Report the overlap rate; the joint feasibility of a disjoint ladder is the §11(a) gate.

## 5. Endpoints & analysis

**Anchor = the eligibility-trigger timestamp**, computed identically in both arms from **pre-randomization** signals (never a host-fired or imputed "date they'd have been offered"). The window **starts at the trigger**, not at an offer instance (control has no offer instance) — so only codes with a genuine per-member behavioural gate are eligible; calendar/segment "blast" codes with no arm-invariant trigger are excluded (§11). Log one real timestamp per member before assignment; **falsification-check that anchor-time distributions balance across arms.** Window = trigger **+ 60–90 days**.

- **Primary — forward wallet NGR, break-even 0.** This codebase's NGR is **already net of the bonus** (`01b_ledger.py`, `incrementality.py`) — so **do not subtract the bonus again**; a positive (Full − Control) means the promo added house margin after its own bonus cost, on the same break-even-0 scale as the two sibling specs. Define "wallet NGR" as the member's total forward NGR across all products.
- **Symmetric-cost variant (report alongside):** withholding pushes Control onto substitutes whose cost the raw contrast never credits back, so the raw primary is slightly biased toward STOP. Report a variant that **credits the arm-difference in substitute bonus cost** (the §5 displacement secondary) into the contrast — package-net vs substitute-package-net — as a bound.
- **Confirmatory — total deposits** (lower variance; mechanism check, never an independent keep-reason).
- **Secondary — churn/inactive** and **displacement** (control's substitute claims — identified now that substitutes stay live).
- **Analysis:** ANCOVA on a multi-quarter pre-baseline anchored to the trigger; winsorize/log; a **linked-wallet robustness check** + host fixed-effect; **cycle fixed-effect and cycle×arm test before pooling.** **ITT is the headline** ("the effect of offering"); any per-claimer number is bounded by sensitivity, not asserted.

## 6. Decision rule — KEEP vs STOP the promo (package), ONE code at a time

- **KEEP** if the **lower 95% CI of (Full − Control) forward NGR > 0**, deposits corroborating, churn not worse.
- **STOP** if the **upper 95% CI < 0** (proven not to cover its own bonus cost), churn permitting.
- **INCONCLUSIVE** → keep only with a genuine churn-risk reason; else wind down if it can't clear a small **opportunity-cost band** (parameterised, §11 — the alternative use, acquisition, is itself still being established, so report sensitivity across the band, not a hard point).
- **Composability — do NOT batch-cut.** Each (Full − Control) is a **marginal** effect measured with all other codes live; marginal contrasts don't sum, so cutting many at once removes the substitutes that rescued control in each single test and aggregate loss exceeds the sum. **The licensed action is one-code-at-a-time STOP on the tested population** — never a portfolio prune of the 45 from stacked per-code verdicts. A real portfolio cut needs a multi-withhold arm or staged, re-measured cuts.
- **Scope:** KEEP vs STOP only, tested population only — **never SCALE** (weaker marginal responder in a broader audience) or **REDUCE** (bonus size never varied).
- **Multiplicity:** treat per-code reads as **directional** and let the calibration slope (§7) carry the weight, or add family-wise control across the simultaneous tests; pre-register a group-sequential / fixed-two-cycle plan analysed once.

## 7. The calibration — the real prize (now with matched axes)

Under Decisions 1–3 and single-netting, the axes are commensurable: **both** the observational x and the causal y are **bonus-net NGR per RM of granted bonus** — differing **only** in the baseline (own-past for x, the control group for y). Calibration asks: **is a code's own-past baseline as good a predictor as a real control group, and if not, by how much do RTM + trend + habit inflate it?**

- Validate the observational metric as a **predictor**, not an unbiased estimator: fit causal y on observational x with a **Bayesian errors-in-variables / hierarchical** model that **propagates each code's causal CI** (wide, skewed — use the full posterior, not a plug-in "known variance"). Deliverable = a **fitted map + predictive interval**, not "slope = 1".
- **One correction, not two** — EIV **or** shrinkage of x, not both. Estimate the x-side error as the **construct-to-causal gap** via **held-out-period replication of x**, not the sampling SE (RTM is not classical measurement error). Label the gap **RTM + secular/seasonal trend + would-deposit-anyway**, not "RTM inflation".
- **The metric §7 validates must be byte-for-byte the metric §1/§10 act on** — same netting, same granted-bonus denominator, same maturity. Recompute the +RM10.18 headline and the 110/45 split on that one consistent metric.
- **Rung selection on a held-out period, pre-registered**, with post-selection inference on the map (extremes regress to the mean and fake a shallow slope otherwise).
- **Test mechanic-specific relationship and curvature** only if the ladder supports it; else one pooled monotone map, **flagging untested codes outside the tested range as extrapolation.**
- **Pre-commit the verdict language:** a wide predictive interval is **"underpowered — can only rule out gross miscalibration,"** never "ranks nothing." Publish the slope-power on realized member counts **before** committing the ladder size.

## 8. Guardrails (non-negotiable)

- **Prevent compensating offers, don't just audit them:** a **hard block at the entitlement/BO layer** stops any grant of the tested code to a control member for the **full outcome window (§11)**; a VM can't clear it without experiment-owner sign-off; **all** grant attempts route to the owner. Any slip is a logged protocol deviation → per-protocol sensitivity (slips bias to null — conservative). Substitute offers to control are **never** blocked (they are the estimand).
- **Safety release only on genuine non-outcome welfare signals** (explicit distress contact) — **exclude login-inactivity and churn**, which are the very outcomes and fire asymmetrically in control. Define what "release" delivers; if it delivers the offer it is a compensating offer → logged deviation, bounded.
- **At-risk / high-value protection is a PRE-randomization eligibility screen** (report on the scoped-down population, and re-check that segment before any estate-wide cut), never a mid-window pull.

## 9. Sample size & power — honestly

Member-level randomization maximizes independent units (far more than v3's would-be clustering), but the primary is skewed and the powered unit is the **ladder (the slope), not each code** — so the deliverable is **a validated (or not) observational metric + directional per-code reads**, not 15 per-code certificates. Publish the slope-power up front; drop under-MDE rungs to directional; run two cycles under one pre-registered combined analysis.

## 10. What is safe to act on today

The **+RM10.18/RM1 is directional, not banked** — don't scale on it, don't call it promo-attributed (that waits on the attribution model + this test). The **45 net-negative codes are review candidates**, but cut only **after** §7 validates the metric, **one at a time**, and with a **churn check** (a net-negative code may still reduce churn and be worth keeping as a perk). The honest limit: this proves the **promo is worth running**; whether the **bonus money specifically** (vs the reminder) works needs a **separate dose experiment** — scope that only if KEEP/STOP isn't enough.

## 11. Pre-launch gates & things to pin (the data-team hand-off)

Symmetric hard gates — **publish before committing the ladder:** (a) realized **member counts and slope-power computed on the actual JOINT disjoint assignment** across the whole concurrent ladder (a partition/matching feasibility calc — ~94% of cohorts overlap and each member joins one rung, so per-code standalone counts overstate power); final ladder length = whatever clears MDE **after** the partition; (b) which candidate codes have a genuine **per-member pre-randomization eligibility gate** (vs calendar/segment blasts — excluded), **broken out by mechanic** so §3's mechanic balance and §7's mechanic-specific test are checkable (deposit-triggered reloads are gate-able; free-spins/free-credit are more often blasts, so the surviving ladder can skew to reload — §7 pre-registered to fall back to one pooled monotone map if a mechanic falls below viable rungs); (c) the **linked-wallet robustness** coverage (which linkage fields exist; contamination bound). To pin with ops/data: the exact **eligibility-trigger** definition and its timestamp; the **wallet-NGR** field and confirmation it already nets bonus (it does — verify no second subtraction); the **calibration** link/form + priors + held-out variance estimator + post-selection method (default: directional per-code + calibration carries the weight); the **at-risk screen** (churn-score / LTV percentile, cf. frequency-cap's top-10-by-LTV); the **opportunity-cost band** (collect from the business); and the **entitlement-block duration = the outcome window.**

---

*Third companion in the holdout program. Shared spine: member-level, randomize the offer, whole-wallet, break-even-0, compare arms not before/after, burden of proof on the action, underpowered → INCONCLUSIVE never a default cut/scale. v4's contribution: a **runnable** calibration ladder — code-only suppression + member-level randomization + an offer-level, package-honest, single-netted estimand make the observational and causal axes commensurable, so a handful of tests can govern 155 codes — with an explicit feasibility gate so the ladder is sized to the data, not to hope.*
