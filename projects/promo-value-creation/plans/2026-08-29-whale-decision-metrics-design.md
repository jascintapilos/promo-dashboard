# Design: Whale decision-metrics (Big-player detection)

**Status:** APPROVED (metric set confirmed by user 2026-08-29) → next: superpower-planning
**Created:** 2026-08-29
**Audience:** VIP/VM decision-makers via the Big-player detection tab of `templates/acq-dashboard.html`.

## Goal (one sentence)
Move the Big-player detection tab from **describing** whales (concentration, cooling counts — things the VMs already feel) to **driving decisions**: a ranked weekly save-list of who to act on, an early-warning signal that fires *before* revenue drops, and a per-whale read of whether our bonus spend is even working.

## The problem this solves (why "Main findings" is currently weak)
The tab's Main findings lead with *"the top 1% make 34% of net revenue."* That is **Pareto — a known fact, not a finding.** A report earns its keep by surfacing what a decision-maker can't see by gut and that changes an action. User: *"this findings is what we already know … there needs to be real analysis for the decision maker."* The genuinely non-obvious insights are already in the data but buried: (a) we **under-fund** the top (22% of bonus for 34% of value), and (b) our bonuses **can't be shown to keep them** (they'd mostly stay anyway) — both challenge the assumption that VIP bonuses are retention tools.

## Decisions confirmed in brainstorming
- **Data:** HYBRID — build a coarse version now from existing data, AND spec a proper deposit-series pull for the real leading signal.
- **Primary use:** BOTH — lead with the operational **save-list**, with the **spend-reallocation** (bonus-efficiency) view alongside.

## Data reality (the binding constraint)
`member-ledger-MY.json` carries only two half-year deposit totals (`dep_h1`, `dep_h2`), YTD NGR/GGR, `vip_claims`, `rescue_claims`, tier. `claim-rows-MY.json` has per-claim recency/deposit-proximity (`recency_days`, `last_dep_before`, `dep_days_30/60/90`) — a claim-based proxy for activity, not a clean deposit ledger. **There is no per-member deposit time-series.** So today's "cooling" flag (H1 vs H2) is the best the current data can do — a coarse 2-point trend. A genuine leading signal (gap-since-last-deposit vs norm, deposit-frequency trend, deposit-size trend) needs a new pull.

## The metric set

### ① Churn-risk score (0–100) — ranks who's slipping
- **Coarse (now):** `risk = 65% · deposit-decline + 35% · dormancy`
  - `deposit-decline = clamp((dep_h1 − dep_h2)/dep_h1, 0, 1)`
  - `dormancy = clamp(days-since-last-claim-activity / 60, 0, 1)` (from claim-rows `recency_days` on the whale's latest claim — a proxy)
  - Bands: **High ≥ 60 · Medium 35–59 · Low < 35.**
- **Real (after the pull):** replace the two proxies with true signals — gap since last deposit vs the member's own norm, deposit-frequency trend, deposit-size trend. Same 0–100 output + bands so the tab doesn't change shape.
- *Caveat, shown:* the coarse score is only slightly ahead of today's flag; it becomes a genuine early warning once the deposit series lands. Directional, not proof.

### ② Recoverability — winnable vs gone
- **Reachable** = risk High/Medium **and** still showing a pulse (`recency` under ~45 days OR `dep_h2 > 0`).
- **Likely gone** = cooling **and** dormant (no recent activity AND `dep_h2 ≈ 0`).
- Purpose: don't spend VM effort on the already-departed.

### ③ Save-list — the weekly "call these" *(leads the tab)*
- `save_value = ytd_ngr × (risk / 100)`, filtered to **reachable**, ranked high→low.
- Render: **top ~10 whales to act on this week** — opaque ref · tier · RM-at-risk · risk band · one-line why-flagged (e.g. "deposits −48% H1→H2, last active 22d ago").
- This is the operational output that turns "44 cooling" into "call these 8."

### ④ Bonus efficiency per whale — 30/60/90-day forward return *(alongside)*
The efficiency read is a **forward return at three horizons**, not a single YTD ratio — so you see whether a whale's bonus **pays back fast or slow**:
- `eff_30 / eff_60 / eff_90 = forward NGR in the 30/60/90 days after each bonus ÷ that bonus cost`, summed over the whale's bonuses (matured windows only), per whale.
- Read: a whale whose eff climbs 30→60→90 pays back over time (keep funding); one flat/negative at 90 is dead spend. Crossed with the risk band → **over-fed & steady** (trim candidate) vs **under-attended & cooling** (fund these) — the spend-reallocation view, and it operationalises the "we under-fund the top" finding at the individual level.
- **Data:** forward NGR at 30/60/90 is **not** in `claim-rows` (only 7-day `ngr_lift` + 30/60/90 *deposit-activity*). It **is** already computed for rescue claims (`rescue-forward-MY.json` → `fwd_ngr_30/60/90`), which proves the pipeline; extend that forward-NGR computation to **all whale bonuses** via the pull (below). Coarse-now can only show a single rough window (7-day `ngr_lift` per RM) as a placeholder — the true 30/60/90 read lands with the pull, so **④ is a P2 metric.**

## The pull (for the real ①/② and ④)
One targeted ClickHouse pull, per member (whales first, extensible), covering both needs:
- **Deposit series** — per-month deposit count · amount · last-deposit date (and days-active) → the real leading churn signal (① frequency/gap/size trends) and recoverability (②).
- **Forward NGR windows** — NGR in the 30/60/90 days after each whale bonus → the 30/60/90 bonus efficiency (④). The rescue pipeline (`rescue-forward-MY.json`, `fwd_ngr_30/60/90`) already does this for cashback; scope it to **all whale bonuses**.

Member-level → lands in scratchpad only, **opaque refs** in any surfaced view; no member identity leaves scratchpad. Spec'd as its own plan task; the coarse metrics (①/②/③) ship without it, and ④'s real 30/60/90 read arrives with it.

## Report changes (`templates/acq-dashboard.html`, whale tab)
1. **Main-findings reframe** — lead with the non-obvious: *"We under-fund the players who carry the book (22% of bonus for 34% of value), we can't yet prove our bonuses keep them, and N cooling whales are worth saving this week."* Concentration demoted to a one-line footnote.
2. **New "Save-list" card** — the ranked top-N weekly action list (leads the analysis, after the whale call).
3. **New "Bonus efficiency" card** (or fold into the reallocation read) — the over-fed vs under-attended split.
4. The existing at-risk ledger keeps the full cooling list; the risk score + recoverability enrich it (add risk band + reachable/gone columns).

## Success criteria
A VM opening the tab can, without reading raw data:
1. See **who to contact this week**, ranked by save-value, not just "44 are cooling."
2. Tell a **reachable** whale from an **already-gone** one.
3. See **which whales are under-funded for their value/risk** (where to move spend).
4. Understand that the early-warning is **coarse today, genuinely leading once the deposit pull lands** — labelled honestly.
5. Never see a concentration/Pareto line presented as the headline "finding."

## Constraints & guardrails
- Member-level stays in scratchpad; **opaque SHA1[:6] refs only** in the tab (as now).
- Churn-risk and recoverability are **directional/heuristic**; the retention *proof* ("does the bonus keep them") remains the holdout (P3), not claimed here.
- Thresholds (60/35 risk bands, 60-day dormancy cap, ~45-day reachable cut, top-10 list) are **tunable defaults** — revisit once seen on real names.
- No overstating: coarse score labelled as such; "at-risk NGR" never called a promo-attributed loss.

## Phasing (for the plan)
- **P1 — coarse metrics + reframe (no pull):** churn-risk (coarse ①), recoverability (②), save-list (③), Main-findings reframe. Bonus efficiency (④) shows only a single-window placeholder in P1, labelled "30/60/90 pending pull." Builds on `whale_detection.py` / `whale_pillar`.
- **P2 — the pull + real signals:** spec + pull script (deposit series + forward NGR windows). Swap ①'s coarse proxies for true frequency/gap/size signals behind the same 0–100 output, and light up ④'s real **30/60/90 bonus efficiency**.

## Open items (tune later, don't block)
1. Risk-band + reachable thresholds — defaults above; confirm on real names.
2. Save-list length (top-10 default).
3. Whether bonus-efficiency is its own card or merged into the existing reallocation read.
