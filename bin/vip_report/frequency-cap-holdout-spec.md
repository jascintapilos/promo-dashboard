# Whale Free-Credit Frequency-Cap Holdout — Test Protocol

**Status:** design deliverable (not executed). WS1 Malaysia, VIP Lane-A.
**Owner to run:** VM / CRM with data-team support. **VIP-host sign-off required before any whale is capped.**
**Revision:** v2 — hardened after an independent verify-first review (fixes an inverted decision rule, outcome-dependent censoring, and regression-to-the-mean disclosure).

---

## 1. What we're testing

A **frequency cap** on the big VIP free-credit: *each member may receive the RM400+ whale free-credit at most **once per quarter**.*

**Why.** On the cached matured claims, a member's **repeat** whale-FC claims lose markedly more than their first — the **2nd claim is roughly a doubling of the loss per RM, and repeats never recover**:

| Claim (per member, cumulative) | NGR per RM | Sample |
|---|---|---|
| 1st | −0.86 | 1,938 claims |
| 2nd | −1.58 | 529 claims |
| 3rd+ | ~−1.55 | **91 claims / 79 members — thin, high-variance** |

Read this as *"the 2nd claim ≈ doubles the loss and repeats stay underwater,"* **not** a precise three-rung ladder — the 3rd+ point is thin and moves to −1.69 under trimming. The direction is robust (survives dropping the largest whale and excluding the top-1% by spend). Every ordinal is deeply loss-making, so **even one whale-FC per member per year still loses −0.86/RM** — capping frequency removes the *worst* dead-weight but does not make the base offer profitable; pair it with repricing (raise wagering / shrink the RM400+ offer).

**What capping is worth — the honest floor, then the upper bound:**

- **Guaranteed floor (near-certain, mechanism-independent):** a 1/quarter cap removes ~264 repeat claims/year and **frees ~RM228K of bonus spend.** This is arithmetic — it does not depend on any behavioural counterfactual.
- **Observational upper bound (soft):** *if* capped whales revert to their own baseline with no substitution, the avoided NGR loss is **~RM375K/quarter** — but this is an upper bound, not an expected value. It is **regression-to-the-mean-inflated** (the capped population is selected on a losing trough) and **order-sensitive**: keeping each member's *first* claim gives RM375K, but the keep-best/keep-worst envelope runs **−RM62K to +RM742K**, and ~31% of "excess" claims were actually profitable (correctly netted out). Lead with the RM228K floor; treat RM375K as a soft ceiling, never as realised savings.

The holdout exists to convert the soft number into a proven one — because two things can make the RM375K wrong: **substitution** (capped whales just claim more cashback/reload, total unchanged → saving is real) or **retention** (the bonus was quietly holding them → they deposit less/churn → saving is an illusion). Observational data can't separate these; a randomized withhold can.

## 2. The question the holdout answers

> **If we stop giving a whale their *repeat* free-credit, does their total deposit/NGR hold up (dead-weight → cap it) or drop by more than the bonus we save (it was retaining them → don't)?**

Measured on the player's **whole wallet**, not per-promo. Randomization makes every *other* promo equally present in both arms, so their effect cancels and the only systematic difference is the cap. This design is also **immune to regression-to-the-mean**: RTM pulls both arms back toward the mean equally, so it differences out of the treatment-vs-control contrast (it only inflates the *observational* priors above, not the trial result) — **provided you compare arms, never before/after.**

## 3. Population

VIPs who claim the **RM400+ whale free-credit more than once per quarter** (~237 members/quarter). Everyone else is unaffected and out of scope.

**Stratify** by **tier** (Diamond / Platinum / Gold) × **prior-quarter deposit decile**, and randomize *within* stratum — this strips out whale-to-whale variance so a real effect isn't drowned out.

**Protect the top whales.** The top handful by LTV carry catastrophic downside (one top Diamond ≈ RM1.99M YTD NGR — losing one wipes years of "savings"). Do **not** hard-cap them: exclude the top ~10 from the treatment arm, or give them a gentler 2/quarter cap. Note the "top-10 = 45% of the recoverable loss" figure is itself computed on a trough-selected group, so it is an RTM-inflated prior — do not treat it as a stable estimate.

## 4. Design

Randomized, member-level, intent-to-treat, two arms:

| Arm | Whale FC RM400+ | Every other promo |
|---|---|---|
| **Control** (~60%) | business as usual (no cap) | unchanged |
| **Treatment** (~40%) | **capped at 1 / quarter** | unchanged |

Treatment is the smaller arm to limit whale exposure. Both arms keep receiving cashback, reload, check-ins, mini-games exactly as normal — that neutralisation is what makes the wallet-level contrast clean and RTM-immune.

## 5. Endpoints & analysis (forward window)

Anchor = start of the capped quarter. Exposure = one cap quarter **+ a 60–90 day forward window** (~5 months/member).

- **Primary — total forward NGR** (net of bonus, break-even 0), analysed as **one pooled, covariate-adjusted** contrast.
- **Co-primary — total deposits** (lower variance → the more sensitive read).
- **Secondary — churn / went-inactive** (binary; robust to variance; often the practical decider), and **substitution** (change in the capped whales' claims of *other* promos).

**Analysis hardening (pre-specified, not optional):**
- **ANCOVA** adjusting for a **multi-quarter pre-period baseline** of each member's deposits/NGR — this both increases power and further guards against RTM.
- **Winsorize / log-transform** deposits and NGR (whale tails are extreme; one member swings the mean otherwise) — matching the cashback spec.
- **One pooled primary.** Per-stratum / per-tier reads are **exploratory only** — do not make cap-by-tier decisions off ~30-member cells. Control multiplicity across the two co-primaries.
- **Acknowledge clustering (SUTVA):** whales sharing a VIP host aren't fully independent; block/cluster on host where possible.

## 6. Sample size & power — read honestly

N ≈ 237 repeaters, and whale NGR is extreme-variance (a single whale swings RM1M+). **This is very likely underpowered to prove the NGR effect** — the per-member target is small (~RM1,580/member/yr) against per-whale NGR SDs in the tens-to-hundreds of thousands. Consequences and mitigations:
1. Power/MDE must be computed against the **discounted saving (~RM228K floor), not RM375K.**
2. Judge primarily on **deposits + churn** (lower variance), NGR secondary.
3. Run **two quarters** if the first is inconclusive.
4. It is a **directional pilot**, not a p<0.05 trial — but see the decision rule: underpowering must lead to *INCONCLUSIVE*, never to a default "cap."

## 7. Guardrails (non-negotiable)

- **VIP-host sign-off** before any whale enters treatment.
- **No compensating offers** to the capped arm — a VM handing them a substitute bonus contaminates the test.
- **Mask the holdout from front-line VMs** so they don't "rescue" capped whales.
- **Safety release valve — but NOT on the primary outcome.** Release a capped whale only on **independent distress signals** — login inactivity, or **VIP-host clinical judgment** — adjudicated by the host, **never** an automatic deposit-drop threshold (that censors on the very metric being measured and biases the result toward "cap"). A whale simply *asking* for the bonus is host-adjudicated, not auto-granted (it's gameable). Report a **per-protocol / CACE sensitivity analysis** alongside ITT to bound any dilution from releases.
- **Top-whale protection** as in §3.

## 8. Decision rule — NON-INFERIORITY (this is the fix; do not use "no significant difference")

The action strips a standing benefit from whales, so the **burden of proof is on the cap**: it must be *proven* not to cost more than it saves — an underpowered "we couldn't find a difference" must return **INCONCLUSIVE, never CAP.**

Set the non-inferiority margin **Δ = the ~RM228K/quarter of bonus the cap frees** (the guaranteed floor from §1). Then:

- **CAP IT** only if the **upper 95% confidence bound on the control-minus-treatment forward-NGR loss is below Δ** — i.e., you can rule out that the capped whales give up more play than the bonus you certainly save. (Equivalently on NGR, which already nets the bonus: the capped arm's NGR is proven non-inferior to control within Δ.) Deposits must corroborate and churn must not be elevated.
- **INCONCLUSIVE** — if the confidence bound can't clear Δ (the likely outcome at this N). Default to the **gentler 2/quarter cap on the heaviest repeaters only**, and re-measure next quarter. **Never** auto-cap from a failure to reject.
- **DON'T CAP** — if treatment shows materially lower deposits/NGR or higher churn beyond Δ → the bonus was doing retention work; the observational saving was an illusion.

This matches the companion cashback spec's CI-lower-bound logic and removes the inverted "absence-of-evidence = cap" default.

## 9. What is safe to act on *today*, before the trial

The **~RM228K/quarter of freed bonus is near-certain and mechanism-independent** — it's reason enough to run a *capped pilot* now (with all guardrails). What is **not** safe to bank: the RM375K as realised NGR savings, or an automated "cap it" rollout. Run the pilot, judge it by §8, and only then scale — tier by tier, top whales last.

---

*Companion to `cashback-holdout-spec.md` — same randomized-withhold, non-inferiority logic; different lever (frequency of the whale free-credit vs the rate of the loss-cashback).*
*Data note: the observational splits above use matured-7 claims; the recent/dormant split classes the 108 late claims with unknown recency as "recent" (the load-bearing definitional choice — classing them dormant changes the split materially).*
