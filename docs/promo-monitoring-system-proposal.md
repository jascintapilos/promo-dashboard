# Per-Brand Promo Code Monitoring System — Design Proposal (v1, reviewed by strategic-design-advisor: APPROVE WITH IMPROVEMENTS, incorporated)

## 0. Grounding: what already exists (do not duplicate)

| Asset | Location | What it already does |
|---|---|---|
| Promo Request Tracker | Google Sheet `1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM`, current-month tabs | Per-request: Status, Requestor, Date, Priority, Deadline, Brand, Region, Campaign, Bonus Type, Promo Code, Promotion Names, Validity fields |
| Promo Code Log | Dashboard tab (`dashboard.html`), populated nightly by `bin/pull-bo-ytd.mjs` | Per-code-per-brand ground truth pulled directly from BOs: Date, Code, Brand, Region, Created By, Type, Status (Active/Inactive) |
| Bot QC pipeline | `/qc-engine` (Triage: READY/NOTE/RETURN) → `/pre-qc` (Pre-QC: PASS/WARNING/FAIL) → save → `/deep-qc` (Sentinel: PASS/WARNING/FAIL/INCONCLUSIVE) | Runs per promo request today. **Verdicts are NOT persisted anywhere** — they print to the session and get discarded once the conversation ends. This is the single biggest gap. |
| Human QA sampling system | Separate Google Sheet `1RXlyIy9hD1LbWnM32k1DGrT9CWJwWvlCBlJzOfE_Q9Q` — tabs: `Weekly QA Log`, `Weekly Summary`, `QA Pivot`, `Reference`, `Learning Log`, `Promo Audit` | **This already covers most of what was asked for in sections 2, 3, and 5 of the brief.** Weekly QA Log has one row per audit (Brand, Task Category, Item Ref, QA Result Pass/Fail, Error Description, Root Cause, Severity S1/S2/S3, Preventive Action, Status). Weekly Summary auto-computes **pass rate by brand already**. Reference tab defines sampling guidance ("Promo Code ~15%, Banner ~25%; adjust by risk"), severity definitions, and a 6-category root-cause taxonomy. `Promo Audit` tab already has an Audit-Pick/Skip checkbox mechanism for selecting weekly samples. |
| Brand Directory | `data/brand-directory.json` | Per-brand: displayName, website, tncDomain. ~25 brands across QPRO1-19, QP2A-D, WS1, WS2. Does not yet carry region/currency/BO-platform as structured fields for dashboard joins. |

**Implication for design:** most of sections 2 (Accuracy), 5 (QC Sampling), and part of 6 (Dashboard) should be **extending the existing QA sheet and its conventions**, not inventing a parallel system. The real gap is: (a) bot QC verdicts vanish instead of feeding this system, (b) nothing joins Request Tracker + Promo Code Log + QA sheet into a per-brand view, (c) no SLA/timing computation exists despite Priority/Deadline already being captured, (d) sampling selection is manual/random rather than risk-weighted.

---

## 1. New data asset: QC Results Log (closes the biggest gap)

New tab (`QC Results Log`), one row written automatically at the end of every canary run (extend `canary-multi-brand.js` / the qc-engine/pre-qc/deep-qc skill wrappers to call a `sheets-writeback`-style append):

| Column | Source |
|---|---|
| Timestamp | run time |
| Handle (P###) | request handle |
| Brand | per-brand loop |
| Region | from request |
| Bonus Type | from request |
| Triage Verdict | READY / NOTE / RETURN |
| Pre-QC Verdict | PASS / WARNING / FAIL |
| Sentinel Verdict | PASS / WARNING / FAIL / INCONCLUSIVE |
| Final Bot Verdict (derived) | Auto-Pass / Needs Human Review / Blocked / Inconclusive |
| Flagged Reason | free text, if not Auto-Pass |
| Linked QA Log ID | filled in later if this row gets human-sampled |

**Final Bot Verdict derivation:** Auto-Pass only if Triage=READY AND Pre-QC=PASS AND Sentinel=PASS. Blocked if any verdict is RETURN/FAIL. Needs Human Review if any verdict is NOTE/WARNING. Inconclusive if Sentinel=INCONCLUSIVE and nothing else failed.

**Partial/skipped runs must still write a row — never omit silently.** The auto-flow allows early exits (Triage RETURN halts before Pre-QC ever runs; user says "skip qc"; Sentinel times out). Each of these gets an explicit verdict value rather than a blank cell, so downstream percentages aren't silently biased by missing rows:
- Triage=RETURN → Pre-QC/Sentinel = `Not Run`, Final Bot Verdict = `Blocked`.
- User skipped QC → all three = `Skipped`, Final Bot Verdict = `Not Evaluated` — excluded from the Bot Auto-Pass % denominator, but counted and shown as its own "Skipped QC" figure on the dashboard so it's visible, not swept under the rug.
- Sentinel INCONCLUSIVE after a timeout → Final Bot Verdict = `Inconclusive`, and this counts toward "Needs Human Review," not toward Auto-Pass.

This is the join key that lets bot QC and human QC finally sit in the same per-brand table, and it costs zero new manual work — it's a code change, not a process change.

---

## 2. Per-Brand Overview (new "Brand Overview" tab)

One row per brand, recomputed nightly by a new script (`bin/compute-brand-overview.mjs`, same pattern as `pull-bo-ytd.mjs`), joining Brand Directory + Promo Code Log + Request Tracker + QC Results Log:

`Brand | Region(s) | Currency | BO Platform | Codes Created (7d/30d/YTD) | Pending Requests | Completed | Bot-Blocked | Needs-Human-Review | Request Volume Trend (vs prior period) | Risk Band`

---

## 3. Accuracy Monitoring (extends existing QA sheet, doesn't replace it)

Per-brand rollup, joining `QC Results Log` (bot) + `Weekly QA Log`/`Weekly Summary` (human, already exists):

`Brand | Total Codes | Bot Auto-Pass % | Bot Needs-Review % | Bot Blocked % | Human Samples (count) | Human Sample Rate % (vs 15% target) | Human Pass % | Error Categories (reuse existing 6: Human error / Checklist gap / Process issue / Automation issue / Knowledge gap / Unclear requirement) | Severity Mix (S1/S2/S3, reuse existing definitions) | Repeat Error Flag`

**Repeat Error Flag:** same (Brand, Root Cause) combination appears 2+ times in the trailing 4 weeks of `Weekly QA Log`.

---

## 4. Risk Monitoring — explainable point-based score (not a black box)

Five factors, 0–3 points each, summed to a 0–15 score, banded Low(0-3)/Medium(4-7)/High(8-11)/Critical(12-15):

| Factor | 0 pts | 1 pt | 2 pts | 3 pts |
|---|---|---|---|---|
| Volume spike vs 4-wk avg | normal | +20-49% | +50-99% | +100%+ |
| Repeat errors (trailing 4wk) | none | 1 repeat | 2 repeats | 3+ repeats, or any S1 in last 2wk |
| QC coverage gap vs target (15%/25%) | at/above target | ≤5pt below | 5-10pt below | >10pt below, or zero samples on active brand |
| Bot/Human agreement rate | ≥95% | 90-95% | 80-90% | <80% |
| Urgency load this week | 0 urgent | 1 | 2-3 | 4+ |

Brands scoring High/Critical auto-populate the "Needs Attention" panel, sorted descending. This reuses the severity/sampling language the QA team already knows instead of introducing new vocabulary.

**These thresholds are a provisional first pass, not calibrated data — label them as such on the dashboard itself** ("Risk bands are provisional; under review until [date]"), and revisit after ~6-8 weeks of real distribution once there's enough history to know whether 8-11 actually behaves like "High" in practice.

**"Bot/Human agreement rate" is undefined, not zero, when a brand has too few paired samples.** At 15% sampling on modest weekly volume, several brands will have 0-2 human-sampled codes in a given window — not enough to compute a meaningful agreement rate. When paired samples in the trailing period are below a minimum threshold (e.g. 5), show `Insufficient Data` instead of a score for that factor, and drop the total to a 0-12 scale for that brand that period rather than assigning a misleading 0.

**The five factors are correlated, not independent** — a single real incident (e.g. a bad batch on one brand) will often spike Repeat Errors, QC Coverage Gap, and Urgency Load together. A brand showing "5/5 dimensions red" is very likely one underlying problem wearing five hats, not five separate problems — worth a one-line caption on the dashboard so management reads it correctly.

---

## 5. SLA / Timeliness Monitoring

Join `Request Tracker` (Date received, Deadline) + `Promo Code Log` (BO save timestamp) + `QC Results Log` (QC completed timestamp):

`Request Number | Brand | Received | Deadline | Created At | QC Completed At | Time-to-Create | Time-to-QC | SLA Status`

**SLA Status:** On Time (QC completed ≤ deadline) / At Risk (incomplete, within 4 business hours of deadline) / Breached (incomplete, past deadline). Aggregated to avg turnaround by brand and a "brands frequently breaching" list.

---

## 6. QC Sampling Rule (formalizes the existing "~15%/25%, adjust by risk" guidance)

- **Base rate:** 15% for Promo Code tasks, 25% for Banner (unchanged, already documented in Reference tab).
- **Escalate to 100% human QC** when any of: first-time/new bonus type setup, brand had an S1 in trailing 4 weeks, brand Risk Band is High/Critical, request spans 3+ brands, request is Urgent with <1-day lead time.
- **De-escalate to spot-check (5%)** when: brand has 8+ consecutive Pass audits with zero S1/S2, AND bot Final Verdict was Auto-Pass, AND Risk Band is Low.
- **Bot QC alone sufficient, skip human sampling this cycle** when: routine repeat pattern, Final Bot Verdict = Auto-Pass, Risk Band = Low, no errors on this brand in trailing 4 weeks. (Still gets swept into occasional audits — never permanently exempted.)
- **Escalation triggers (immediate full review regardless of schedule):** Sentinel = FAIL or INCONCLUSIVE, Pre-QC = FAIL, 2 consecutive human Fails on the same brand, Risk Band flips to Critical.
- **Selection mechanism (two-step rollout, not day-one automation):**
  - **Step A — suggest only.** Add a read-only "Suggested (Risk-Ranked)" column next to the existing `Promo Audit` tab's Audit-Pick/Skip checkboxes. The human QA reviewer keeps picking manually, but now sees a ranked suggestion instead of picking blind.
  - **Step B — auto-tick.** Only after a few weeks where Step A's suggestions visibly match what the reviewer would have picked anyway, switch to auto-pre-ticking the Audit-Pick checkbox from the score, with the human still free to uncheck. Writing an uncalibrated formula's output directly into a live human sampling decision on day one is the one place a scoring bug would directly waste the QC time this system exists to protect — hence the staged rollout.
  - **Override rate as a feedback loop:** from Step A onward, track how often the reviewer's actual pick disagrees with the suggestion (ticks something not suggested, or unchecks a suggested one). Surface this as its own dashboard metric — it's the only signal that tells you whether the risk score is actually good, and it's nearly free to capture from the start rather than retrofitted later.

---

## 7. Dashboard Design (new tabs inside existing `dashboard.html`)

1. **Health strip** (KPI cards): Total codes (7d/30d/YTD), Overall bot Auto-Pass %, Overall human Pass %, # brands High/Critical risk, SLA On-Time %.
2. **Per-Brand Performance table**: Brand | Region | BO | Volume | Bot Pass % | Human Sample % | Human Pass % | Open Issues | SLA On-Time % | Risk Band (color chip: green/amber/orange/red matching existing S1/S2/S3 color language).
3. **Risk / Attention panel**: brands with Risk Band ≥ High, reason chips (Volume / Repeat Error / Low Coverage / Inconsistent / Urgent Load), sorted by score.
4. **QC Sampling summary**: sample rate applied vs target per brand, escalations this week, count auto-skipped (bot-sufficient).
5. **Error trend by brand**: weekly S1/S2/S3 counts, small bar/sparkline per brand.
6. **SLA performance by brand**: on-time/at-risk/breached counts + avg turnaround.
7. **Latest issues / action required**: open rows from `Weekly QA Log` + any unresolved Sentinel FAIL/INCONCLUSIVE, linking back to source row.

Filterable by Region and BO Platform (dropdown, matches existing dashboard.html filter pattern). No new color/status vocabulary — reuses S1/S2/S3 and Pass/Fail already in use.

**8. Freshness indicator (added per review) — every section above shows an "as of [timestamp]" per data source.** This is the single highest-value addition against the biggest risk in this design: the nightly join depends on 3-4 upstream sources (BO pull, QC Results Log writes, cross-spreadsheet read of the QA sheet) succeeding in sequence. If any one fails silently, the dashboard would otherwise look normal while showing stale numbers — the same failure shape already documented in this codebase for a different system (`project_sentinel_currency_status_blindspot.md`). Concretely: the nightly script writes its own run status (success/partial/failed, with which source failed) to a small `System Status` cell the dashboard reads and surfaces prominently if not "success," and pings Slack on failure (pulling that piece of the original Phase 6 forward — it's cheap and closes the biggest reliability gap).

---

## 7a. Ownership & maintenance (added per review)

A nightly join script plus a scoring formula that needs periodic recalibration is an ongoing cost, not a one-time build — a small team with no named owner will let both drift silently. Before Phase 2 ships: name who owns `bin/compute-brand-overview.mjs` and who is responsible for revisiting the risk-band thresholds after the 6-8 week provisional window (section 4). This can be the same person who owns `pull-bo-ytd.mjs` today if that's a natural fit — the point is that it's someone, not "the system."

**Backfill/rollback note:** if a bug is later found in the Final Bot Verdict or Risk Score derivation logic, decide up front whether historical `QC Results Log` / `Brand Overview` rows get recomputed retroactively or only the fix applies forward. Recommend: since both are cheap to recompute from source data (QC Results Log rows are append-only and immutable; Brand Overview is fully derived), keep the derivation logic in one script and support a `--recompute-from=<date>` flag rather than hand-patching history.

---

## 8. Status Definitions (recommended, consolidated)

- **Request Status** (tracker, existing — unchanged): whatever the team's current enum is (known value: "QC Completed"); not proposing to change this.
- **Bot Final Verdict** (new, derived): Auto-Pass / Needs Human Review / Blocked / Inconclusive.
- **Human QC Result** (existing, unchanged): Pass / Fail; correction Status: Open / In Progress / Closed.
- **SLA Status** (new): On Time / At Risk / Breached.
- **Risk Band** (new): Low / Medium / High / Critical.

---

## 9. Implementation phases (revised after review — smallest-safe-slice ordering)

1. **Phase 1 — persist bot verdicts.** Wire `QC Results Log` writes into the existing canary/QC skill flow, including explicit values for partial/skipped runs (never a blank cell). Zero new manual work; unlocks bot pass-rate-by-brand immediately. **Ship this alone first and let it run for a couple weeks before building anything on top of it** — it's the one piece of this design with no open questions.
2. **Phase 2 — nightly join script + freshness signal together, not separately.** `bin/compute-brand-overview.mjs` reads Promo Code Log + QC Results Log + Request Tracker + (cross-spreadsheet read of) the QA sheet, writes `Brand Overview` + `Risk Summary` tabs, AND writes its own run status (success/partial/failed + which source failed) from day one. Building the join without the freshness signal is the change most likely to bite later — do them in the same PR. Name an owner now (section 7a).
3. **Phase 3 — SLA computation.** Same script, adds Time-to-Create/Time-to-QC once Phase 1 timestamps exist.
4. **Phase 4a — suggested sampling queue (read-only).** Add the risk-ranked suggestion column next to the existing `Promo Audit` checkboxes; human still picks manually. Start tracking override rate immediately.
5. **Phase 4b — auto-tick (gated).** Only after a few weeks of Phase 4a's suggestions visibly matching real picks, switch to auto-pre-ticking. Do not skip the gate.
6. **Phase 5 — dashboard tabs.** Extend `dashboard.html` with the 7 sections above (+freshness indicator, +override-rate metric), reading the new sheet tabs via the existing REST batchGet pattern already in use.
7. **Phase 6 (optional) — additional escalation alerts** beyond the job-failure ping already shipped in Phase 2 (e.g. Slack ping when Sentinel FAIL/INCONCLUSIVE or Risk Band flips to Critical mid-week, not just nightly-failure alerts).

**Explicit checkpoint:** after Phase 1 + Phase 2, pause and ask whether the Risk Score/SLA machinery (Phases 3-4b) is earning its keep before building further, rather than committing to all 7 phases up front — per this team's own prior lesson ([[feedback_simplify_workflows.md]]) about defaulting to the smallest version and adding infrastructure only as it proves necessary.

## Constraints stated by the requester
- Must not create unnecessary manual work — must reduce reliance on full human QC while keeping management confidence.
- Must be realistic for a small ops team using trackers + bot QC + sampling + dashboard, not a rebuild.
- Must integrate with the existing dashboard.html, existing Promo Code Log, and the existing (separate) human QA sampling spreadsheet.
