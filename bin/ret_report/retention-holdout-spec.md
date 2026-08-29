# Retention-Bonus Holdout — Test Protocol

**Status:** design deliverable (not executed). WS1 Malaysia, Retention tab.
**Owner to run:** CRM / Retention with data-team support. **No launch without sign-off + BO/ops execution.**
**Revision:** v2 — hardened after an adversarial statistical review (3 lenses). The v1 backbone survived; the fixes below correct a contaminated counterfactual, design-side spillover, an offer-vs-bonus conflation, an outcome-dependent release, a mislabelled decision, and a calibration that was biased toward its own failure verdict. **Do not soften any of §2–§8 back toward v1.**
**Companion to** `bin/vip_report/cashback-holdout-spec.md` and `bin/vip_report/frequency-cap-holdout-spec.md` — same randomized-withhold, wallet-level, RTM-immune spine; this is the **third lever**: the deposit-linked retention bonus (reload / free-credit / free-spins).

---

## 1. Why

The observational retention read (`bin/ret_report/incrementality.py`) says retention players produce **+RM25.4M more net revenue in the 90 days after claiming than the 90 days before — ~+RM10.18 per RM1 of bonus, 110 of 155 codes net-positive.** It is an **own before/after** read, inflated by two non-causal forces: **regression to the mean** (players claim around a dip and rebound anyway) and **would-deposit-anyway** habit. A randomized withhold is the only thing that separates caused revenue from rebound + habit. And because **you cannot hold out 155 codes**, the study is also built to test whether the cheap observational metric can be *trusted to grade the codes we never test.*

## 2. What the experiment actually estimates (read this before the design)

Three v1 assumptions were wrong; the honest estimand is narrower:

1. **It is the effect of the OFFER, not of the bonus.** Randomizing offer-vs-withheld with self-claim-on-deposit bundles the bonus economics with the *salience* of being offered (inbox/banner/nudge). A 2-arm study cannot separate them. **Every conclusion and the calibration axis is stated as the effect of *offering the code*** — never "the bonus paid for itself" — **unless the optional 3rd arm (§4) is run.**
2. **The comparison is "this code vs next-best retention offer," not "vs nothing," unless you suppress the class.** The eligibility dip is a *recurring* trigger and all other retention promos stay live, so a withheld control dipper is caught within the window by a re-fire or a same-mechanic substitute. Either **suppress the whole same-mechanic retention-offer class for control across the full window** (default), or explicitly declare the estimand *incremental-vs-substitute* and calibrate against a vs-substitute observational analogue — never against the own-baseline number.
3. **Suppression scope is single-dose, cleanly attributed.** Withhold the anchor instance (+ same-mechanic substitutes) for one cycle; later *natural* re-offers are censored/attributed, not counted as continued deprivation. State this so the "dose" is defined.

## 3. Population, unit of randomization, and the ladder

**Unit = the host-book / linked-identity cluster, not the member.** Member-level assignment is smaller than the interference unit and biases ITT (not just its variance): a host managing a mixed book comps a withheld control member; linked wallets/households cross-fund; a player eligible for several tested codes is Control for one and Treatment for another. **Cluster-randomize so each host's entire book and each linked-wallet/household group is in a single arm, and partition the population so each player is eligible for at most one tested code** (mutually exclusive; or run an explicit factorial analysed at player level).

**Only eligibility-gated codes are testable.** Open-enrollment promo-page codes cannot be withheld — control members would just claim them, nulling the contrast invisibly. Restrict the ladder to codes gated at the entitlement layer (per-member flag), verify control members cannot see/redeem the code, and **instrument control-arm redemptions as a leak monitor** (any is a suppression failure, not substitution).

**The calibration ladder — 12–15 codes** (v1's 6–9 cannot power the slope; see §7). Choose rungs to span the observational range **including the moderate middle** where most of the untested 150 live (a barbell of extremes is driven by leverage points and misses curvature), balanced across the three mechanics (reload / free-credit / free-spins). **Select rungs on a period disjoint from the experiment window** (see §7) so the ladder isn't chosen on the same noise it will be graded against. Stratify coarsely (tier × 3–4 deposit bins) and carry the finer decile as an ANCOVA covariate; over-stratifying yields <5-member cells that break balance.

## 4. Design

Randomized, cluster-level, intent-to-treat. **Two arms core; a third optional but recommended to isolate the bonus:**

| Arm | This code + same-mechanic class | Every OTHER promo |
|---|---|---|
| **Control** (~45%) | **offer suppressed**, full forward window | unchanged |
| **Full offer** (~45%) | offered as normal (self-claim) | unchanged |
| **Sham/low-dose** (optional, ~10%) | offer-shaped comms, negligible/reduced bonus | unchanged |

The optional third arm nets out pure salience: *Full − Sham* isolates the **bonus** economics; *Full − Control* is the **offer** effect. Without it, only the offer effect is identified — say so, and never issue a cost-of-bonus verdict from a 2-arm run.

## 5. Endpoints & analysis (forward window)

Anchor = the **would-offer timestamp** logged for *every* cluster at randomization (control has no natural offer date; anchoring both arms to the eligibility-trigger timestamp keeps RTM from re-entering via the calendar). Window = the offer instance **+ 60–90 days**.

- **Primary — total forward wallet NGR, netting ONLY this code's *realized* bonus cost** (granted − forfeited/locked − turned-over-to-house; state pre/post-bonus explicitly to avoid double-charging bonus that returns as GGR). Netting *all* bonus cost lets displacement of other promos' liability masquerade as this code's lift — so **carry other-promo bonus cost as a covariate and report the displacement decomposition as a secondary.**
- **Co-primary — total deposits** (does not net bonus; lower variance; the mechanism check).
- **Secondary — churn/inactive** (binary, robust) and **substitution** (control's claims of other promos; also the leak check).
- **Analysis:** ANCOVA on a multi-quarter pre-baseline anchored to the would-offer timestamp; winsorize/log; cluster-robust inference at the randomization unit; **model cycle as a fixed effect and test cycle×arm before pooling two cycles** (a reload is worth more in CNY/tournament windows). Report **ITT and CACE** (CACE = complier effect among claimers).

## 6. Decision rules

**Scope: the holdout supports KEEP vs STOP for the tested population only.** It does **not** license SCALE (a broader audience has a different marginal responder) or REDUCE (bonus *size* was never varied) — those are separate audience/dose experiments, never triggered from an offer-vs-withhold result.

Reference is **not 0**: nominal break-even is value-negative because the bonus budget has an **opportunity cost** (it could fund acquisition). Set a KEEP hurdle **Δ = per-RM opportunity cost of the budget**, above 0. Primary metric = forward NGR net-of-this-code; deposits are **confirmatory, never an independent basis to keep a code that fails on NGR**.

- **KEEP** only if the **lower 95% CI of (Full − Control) forward NGR > Δ**, deposits corroborating, churn not worse.
- **STOP** if the **upper 95% CI < 0** (proven not to cover even nominal cost), or it clears 0 but cannot clear Δ after the planned cycles (**stop-for-futility**), churn permitting.
- **INCONCLUSIVE → keep running only if there is a genuine churn-risk sign-off; otherwise wind down.** Never fund a perpetually-ambiguous code indefinitely.
- **Multiplicity:** pre-register a **group-sequential design (alpha-spending, e.g. O'Brien–Fleming)** or a fixed two-cycle plan analysed once — "keep re-measuring until it clears 0" is optional stopping and inflates type-I.
- **Drop under-powered rungs:** pre-compute each code's MDE on the **cluster-effective n**; a code that cannot clear its MDE yields a *directional* read only, pooled into calibration — not a per-code KEEP/STOP certificate. Frame the deliverable as **pooled calibration + directional per-code reads**, not per-code certificates.

## 7. The calibration — the real prize, and where v1 was weakest

Goal: does a code's **observational** incr/RM predict its **causal** effect, so the untested 150 can be graded on the cheap metric? v1's OLS-on-6-points was biased toward declaring failure. Hardened:

- **Errors-in-variables / Deming (or Bayesian EIV) regression**, ingesting each code's causal CI as known y-variance and the observational SE as x-variance. "Calibrated" = the **attenuation-corrected slope = 1**, not the raw (regression-dilution-attenuated) slope.
- **Calibrate like-for-like: CACE-on-claimers vs the claimer-based observational metric.** The observational x is a claimer-level quantity; regressing it on the all-offered ITT y folds per-code take-up into the slope. CACE already exists for the guardrails.
- **Freeze x on strictly pre-experiment, disjoint data.** If x overlaps the treatment arm's forward NGR, a code-level shock lifts both x and y and manufactures a fake-calibrated slope. Verify no player-period overlap.
- **De-bias the predictor for RTM:** empirical-Bayes-shrink the observational x, or read x from a held-out period, so rungs aren't extreme purely from noise (which regresses to the mean and fakes slope < 1).
- **Model at player level with code as a random slope/intercept** to borrow strength; **test nonlinearity** (quadratic/monotone spline) before applying one slope; **flag any untested code outside the tested x-range as extrapolation.**
- **Test slope heterogeneity by mechanic** (auto-issued free-spins vs self-claim reloads differ in take-up and RTM structure); if present, calibrate each mechanic on its own rungs or refuse to grade a mechanic the ladder can't separately support.
- **Pre-commit the verdict language:** an indeterminate slope CI is **"underpowered — rules out only gross miscalibration,"** NEVER "biased" or "the metric ranks nothing." Pre-register the slope-CI width needed to separate trust / discount-level / discard, and size the ladder (12–15, more if per-mechanic) to hit it.

## 8. Guardrails (non-negotiable)

- **Suppress in a way a VM cannot casually override**, and **audit every manual bonus grant to a control cluster** during the window as a protocol deviation → report per-protocol/CACE with and without them. Route host escalations about a "missing" bonus to the **experiment owner (sealed-envelope)**, not an ad-hoc grant — masking a VM without this turns an unknowing "fix" into an invisible compensating offer.
- **No compensating offers** to control; instrument and log host actions so contamination is detectable, not assumed away.
- **Safety release only on criteria that exclude deposit/NGR** (login inactivity, explicit distress contact) — host-judgment release keyed on an activity drop is the banned outcome-dependent censoring, and fires asymmetrically (control dippers are exactly whom a host rescues). If release is operationally required, **keep released clusters in their assigned arm under ITT, log trigger+timestamp, and bound the effect with a pre-registered sensitivity analysis.**
- **At-risk / high-value protection is a PRE-randomization eligibility screen**, never a post-hoc pull from control (which depletes the arm of exactly whom retention helps and biases ITT toward null). Report on the scoped-down population.

## 9. Sample size & power — read honestly

Retention players are less extreme-variance than whales, so this is **better powered than the two VIP holdouts** — but the primary (skewed forward NGR, collapsed further by cluster-randomization) is still likely underpowered **per code**; that is why the deliverable is **pooled calibration + directional per-code reads**, and why the ladder (not individual codes) is the unit that must be powered — power the **slope**, drop rungs below their MDE, run two cycles under a pre-registered combined/group-sequential test.

## 10. What is safe to act on today, before the trial

The **+RM10.18/RM1 is directional, not banked** — do **not** scale retention spend on it, and do **not** relabel it promo-attributed (that waits on the attribution model + this test). Safe now: the **45 net-negative codes are the first stop-candidates** (worst case they never added money), and building this ladder is how you both prove the winners and earn the right to grade the rest on the cheap metric. Judge by §6, then act — winners kept, boundary codes re-tested, and never a SCALE/REDUCE call the offer-vs-withhold contrast cannot support.

---

*Third companion in the holdout program: `cashback-holdout-spec.md` (Weekly Rescue rate), `frequency-cap-holdout-spec.md` (whale-FC frequency), this (retention-bonus offer). Shared spine: randomize the offer, measure the whole wallet, compare arms not before/after, burden of proof on the action, underpowered → INCONCLUSIVE never a default cut/scale. This spec's own contribution is the **calibration ladder** (§7) — the only tractable way to govern 155 codes with a handful of tests — and v2's job was to make that ladder powered and unbiased rather than decorative.*
