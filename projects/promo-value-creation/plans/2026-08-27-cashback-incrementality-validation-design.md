# VIP Cashback Incrementality Validation — Design (LOCKED)

- **Date:** 2026-08-27
- **Status:** Design locked — proceeding to implementation plan
- **Parent:** the VIP Decision Report (`2026-08-26-vip-decision-report-design.md`). This validates Lane B's "Review" verdict on the Weekly Rescue **loss-cashback** before any budget is cut.
- **Method chosen:** **Focused observational + one within-member cross-check** (not the full causal battery — see §7). Downside modelled as **break-even churn** (not a full expected-value matrix).

## 1. The question (and why it isn't answered yet)
Is the Weekly Rescue **loss-cashback** (RM2.14M/yr; Diamond alone RM1.33M at ~29% of losses) worth keeping? A base-rate analysis already showed losing VIPs redeposit **~96% with no cashback** (Diamond lift only **+2.7pp**, and that's an upper bound). But a CEO cross-examination found that finding is not decision-grade because it:
- measures only the **extensive margin** ("did they come back?", saturated at 96%) — not the **intensive margin** (do they deposit / play *more*);
- measures **adding** the cashback, not **removing** an established perk (loss aversion — cutting can churn a whale who'd otherwise have stayed);
- ignores an **asymmetric, catastrophic downside** — Diamond = 40% of all NGR, so churning a few top players dwarfs the RM1.33M "saving".

So the current evidence is **strong enough to test, nowhere near strong enough to cut.** This design closes those gaps.

## 2. Chosen approach
Four buildable-now analyses that quantify **the bar the cashback must clear** and **the risk of a wrong cut**, plus a **spec** for the experiment that settles causation. No observational method can prove causation here (98% of eligible losers claim → almost no clean untreated group, selection on unobservables), so the observational work sizes the prior and the **holdout is the proof**. Terminology note: **"top-Diamond / high-value VIP"** everywhere — NOT "whale" (that word is reserved for the separate Whale Detection pillar; these are existing VIP players, not a discovery promo).

## 3. The four analyses (buildable now)
1. **Intensive-margin incrementality** — the main new work; closes the biggest hole. Compare **treated vs matched-untreated** losing VIPs (matched on tier × loss-size decile × prior-deposit level) on forward-30/60d **deposit amount, NGR, and play/GGR** — not just the binary redeposit. Per tier, Diamond first. If recipients deposit/play materially more, the cashback has value the binary missed; if not, the dead-weight case hardens.
2. **Per-tier break-even (the decision spine)** — incremental forward NGR = (treated − matched-untreated) per tier. NGR is **net of the bonus**, so **incremental NGR > 0 *is* break-even** (do NOT re-subtract cost). Output per tier: incremental forward NGR vs cashback cost, and the explicit **attributable-retention bar** Diamond's RM1.33M must clear.
3. **Top-Diamond downside (break-even churn)** — the top Diamonds' actual forward value / LTV, and the blunt number: **how few of them must churn to wipe out the RM1.33M "saving".** If cutting risks ~3 top players, the bar to act on observational evidence alone is very high. This is what stops a premature cut.
4. **Within-member cross-check (+ date-shifted placebo)** — compare each recipient's forward behaviour after a **cashback** losing-week vs their **own** losing-weeks **without** a cashback; re-run with claim dates shifted as a placebo. Directly attacks the mean-reversion confound ("is the post-cashback bounce just the natural rebound after a bad week?"). Cheap; ~80% of the causal-battery's decision-value for ~20% of the work.

## 4. The holdout spec (design deliverable — business runs it, we only write the protocol)
The one thing that *proves* it — a short, pre-registered protocol:
- **Low/mid tiers:** randomly withhold the cashback **offer** from ~20% of eligible losers (routine A/B; manufactures the untreated group the data lacks).
- **Diamond:** never zero them — a **rate crossover** (29% / 22% / 15%), each Diamond their own control across weeks.
- **Primary endpoint: forward 60–90d NGR *and* deposit amount** (not just "came back" — the exact hole being closed); secondary: churn.
- Rough power/duration, guardrails (cap Diamond exposure, VIP-host sign-off, auto-release on distress, mask holdout status from front-line VMs), and the **decision rule**: keep a tier only if its incremental forward NGR clears its cost with confidence; if Diamond 15% retains as well as 29%, cut to 15%.

## 5. How it feeds the VIP report
- Lane B's **"Review"** verdict on Diamond carries the **intensive-margin result + the break-even bar + the "how few Diamonds wipe the saving" number** — not a hand-wave.
- The **holdout becomes the #1 item in "Coming soon"**, labelled the single highest-value experiment in the VIP program.
- A short **"how we'd prove this"** box under Lane B shows leadership the path from *directional* to *proven*.

## 6. Architecture (bin/vip_report/)
- Extend `cashback_incrementality.py` — add the intensive-margin (deposit amount + forward NGR, treated vs matched-untreated) and the within-member + placebo cross-check.
- `cashback_breakeven.py` — per-tier break-even + top-Diamond downside (break-even churn).
- `cashback-holdout-spec.md` — the protocol doc.
- Results merge into `vip-metrics-MY.json` for the panel to render. Member-level data → scratchpad only. ClickHouse: daily per-member GGR/NGR/deposit, bonus claims, tier ASOF.

## 7. Approaches considered & rejected
- **Full causal battery** (matched-propensity + RDD + within-member DiD): rejected as the default — same ceiling (can't prove causation given 98% claim), the best method (RDD) is local-at-the-margin and can't see the deep-money Diamonds who *are* the RM1.33M, and a cheap definitive holdout dominates it; also risks false confidence behind a precise-looking-but-biased number. Worth it ONLY if the holdout is blocked. We kept just its single highest-value slice (the within-member placebo, analysis 4).
- **Expected-value decision matrix** for the downside: rejected for a simpler, decision-ready break-even-churn number.
- **Holdout-spec-only** (skip observational): rejected — the intensive-margin gap is buildable now and is the biggest hole.

## 8. Success criteria
Leadership can see, per tier: **(a)** whether cashback recipients actually play/deposit more (intensive margin), **(b)** the exact bar the effect must clear to be worth it (break-even), **(c)** how much top-player value a wrong cut risks (downside), and **(d)** the concrete experiment that settles it (holdout) — so the Diamond RM1.33M decision is made on evidence and a clear next step, not a hunch. The report's "Review" verdict is defensible and its Coming-soon has a credible proof path.

## 9. Out of scope
Running the experiment (business decision); the heavy causal battery (§7); SG; any actual cut to the cashback (this design informs the decision, it does not execute it).
