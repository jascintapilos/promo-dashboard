# Plan: Whale tab — comprehension fixes (make the value land for a non-manager)

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** COMPLETED
**Created:** 2026-08-29
**Goal:** Fix the specific things a first-time-reader audit proved break trust and comprehension on the Big-player detection tab — so someone with no management experience stays confident from top to bottom, not just for the first two sections.
**Architecture:** Mostly plain-language + consistency edits in `templates/acq-dashboard.html` (the whale tab renders), plus two data-text fixes in `bin/vip_report/whale_detection.py` (the "262 whales" mislabel; a counts-reconciliation string). No new metrics, no pull.
**Tech/Tools:** Python (`whale_detection.py`), Node build, Browser-pane verify, Artifact publish. Optional re-verify: re-run the comprehension workflow.
**Design/evidence:** First-time-reader comprehension audit (workflow `wf_ed093fc4-04a`, 6 personas). Verified: **all 6 stated the value correctly** — purpose lands; trust breaks below the fold on the issues below. **User decision:** the save-list is a **strategy/priority tool for the owning teams, not a VM call-sheet** (execution happens in the team's own system; report stays opaque).

## The audit's ranked issues (what each task fixes)
1. "Cooling" reads as 10/29/44/262 with no reconciliation — **all 6 readers** (→ T1)
2. §4 "The whale call" labels 262 people "whales" when whales = 74 — 5/6 (→ T1)
3. net revenue / NGR / VIP value used interchangeably, undefined — 5/6 (→ T2)
4. "holdout" / "control" never defined but called "the proof" — 5/6 (→ T2)
5. Orphan numbers: RM228k, "2.7 defections", "+0.185" — 4/6 (→ T4)
6. Save-list states no move; hashes not actionable by a VM — 3/6 (→ T5, per the strategy-tool decision)
7. §2 vs §7: same 22.2%/33.9% split framed as problem AND win — 2/6 (→ T3)
8. Uncalibrated hedging (DO NOW vs "can't answer yet"/"placeholder") — 3/6 (→ T6)
9. Surface inconsistencies (33.9 vs 34; H1→H2; at risk/at stake/in play; RM/HOD/CRM/YTD) + tab name reads as fraud-detection (→ T7)

## Key facts for the executor
- Whale-tab sections render from `whale_pillar` (built by `whale_detection.py`) + `ABOUT.whale` + per-card renders in `templates/acq-dashboard.html`. Counts: `definition` (74, 33.9%, 22.2%, top10 74.8%), `cooling` (44 of 74 top-1%; `at_risk_members` 262, `at_risk_ngr` RM15.34M across the top-10%), `save_list` (`total_reachable` 29, 10 rows), `roster_stats`.
- **The "262 whales" text** lives in `whale_detection.py` `decision.moves` ("Retain the cooling" → "262 whales slipping"). Fix there.
- Keep every number sourced/consistent; **opaque refs stay** (privacy). Coarse/directional labels stay honest but must be *glossed* (define "directional"), not removed.

## File Map
- Modify: `bin/vip_report/whale_detection.py` — "262 whales" → "262 cooling top-10% players"; add a `counts_reconciliation` string to `whale_pillar`.
- Modify: `templates/acq-dashboard.html` — counts "who's who" line; plain-English key; framing reconciliation; ground orphan numbers; save-list reframe; plain-English one-liners + DO-NOW map; surface consistency; tab subtitle.
- Modify (regenerated): `outputs/acq-dashboard-MY.html`.

---

## Task 1: The "who's who of the counts" + kill the "262 whales" contradiction  *(the #1 fix — all 6 readers)*

- [x] **Task 1** — ✅ 'Who's who of the counts' line under KPIs (74 whales; 44 cooling; 29 reachable; top 10); '262 whales'→'262 cooling top-10% players'. (Fixed a self-introduced error: 29 reachable are of the 74, not the 262.)

**Files:** `bin/vip_report/whale_detection.py`, `templates/acq-dashboard.html`

**Step 1:** In `whale_detection.py`, fix the "Retain the cooling" move why: "262 whales slipping" → "262 cooling top-10% players". Add `whale_pillar.counts_reconciliation` = "Whales = the top 1% (74 players); 44 of them are cooling. Separately, across the wider top 10%, 262 players are cooling; 29 of those are still reachable; we picked the top 10 to act on this week." Re-run the builder. Tool: `Edit` + `Bash`.

**Step 2:** In the whale tab, render `counts_reconciliation` as a short highlighted line directly under the Key-numbers tiles (§3) — one plain sentence that names each population once. Tool: `Edit`.

**Verify:** No "262 whales" anywhere in the built output; the reconciliation line renders under the KPIs; 10/29/44/262 each named once.

---

## Task 2: Plain-English key — define the load-bearing terms once  *(net revenue/NGR, holdout, directional, tiers)*

- [x] **Task 2** — ✅ Plain-English key in §1: net revenue/NGR, holdout, directional, tiers, cooling — defined before first use.

**Files:** `templates/acq-dashboard.html`

**Step 1:** Add a compact "Plain-English key" block (top of the tab, under §1, or a small always-visible note): **Net revenue (NGR)** = what the house keeps from a player's play after their bonuses (same thing everywhere — also shown as "VIP value"). **Holdout** = a group we deliberately give no bonus, so if they stay anyway we learn the bonus wasn't what kept them — the only real proof. **Directional** = a strong hint, not proof. **Tiers** = the VIP ladder (…Gold, Platinum, Diamond at the top). Tool: `Edit`.

**Step 2:** Ensure §7's "NGR"/"VIP value" and §1's "net revenue" now read as the same metric (the key bridges them); no code change needed beyond the key if terms already point back to it. Tool: `Edit` if a bridge word helps.

**Verify:** The four terms are defined once, in plain words, before they're first leaned on; "holdout" is defined before §1/§4 call it "the proof".

---

## Task 3: Reconcile the "under-funded vs efficient" framing (§2 vs §7)

- [x] **Task 3** — ✅ §2 & §7 reconciled: efficient AND under-invested → room to fund retention (no longer problem-vs-win).

**Files:** `templates/acq-dashboard.html`

**Step 1:** State the true, non-contradictory version once and make both sections agree: whales are **efficient** (they return far more than they cost) **and** get a **smaller share of bonus than of value** (22.2% vs 33.9%) — so there's **room to invest more in keeping them**, not a reason to cut. Update §2 and §7 wording so one reads as the consequence of the other, not opposite claims. Tool: `Edit`.

**Verify:** A reader sees one coherent message (efficient → so fund retention), not "problem" in §2 and "win" in §7.

---

## Task 4: Ground the orphan numbers (RM228k · 2.7 defections · +0.185)

- [x] **Task 4** — ✅ Orphan numbers grounded: ~3 Diamonds walking wipes RM228k (sourced to the 2 flagship codes); +0.185 → ~pp on N controls.

**Files:** `templates/acq-dashboard.html`

**Step 1:** §12 "Why protect, not cut": one-line source for the **RM228k** ("the certain bonus saving from capping the 2 flagship no-deposit codes") and phrase "2.7 Diamond defections" as "**it takes only ~3 Diamond players walking** to wipe out that saving." §10: give **+0.185** a unit + baseline ("~18 percentage points higher redeposit — but on only 19 controls, so a hint, not proof"). Tool: `Edit`.

**Verify:** Every headline number in §10/§12 has a source or unit a non-manager can reason about.

---

## Task 5: Save-list reframe — priority tool, not a call-sheet

- [x] **Task 5** — ✅ Save-list reframed 'priority list, not a call sheet'; execution in BO off the stable ref.

**Files:** `templates/acq-dashboard.html`

**Step 1:** Per the user decision, reword the save-list lead + footnote so it reads as **"where the owning teams should focus this week,"** not "call these": e.g. "The top players slipping fastest, in priority order — the owning teams action these in the VMs' own system (each code is a stable handle for one player; identities live in BO, not this report)." Remove any implication of dialling a hash; keep the ranked list + risk + why. Tool: `Edit`.

**Verify:** No wording implies the reader phones a code; the list clearly reads as a prioritised focus list with execution elsewhere.

---

## Task 6: Plain-English one-liners under §10/§11/§12 + a DO-NOW-vs-pending map

- [x] **Task 6** — ✅ Plain-English line on §10 + a 'safe to do this week' DO-NOW-vs-pending map on the whale call.

**Files:** `templates/acq-dashboard.html`

**Step 1:** Add a one-line "in plain English" takeaway atop §10, §11, §12. Add a single reconciling line near §4/§2 that maps the hedges: "**Protecting and retaining the top is safe to do now**; only the *reinvestment-efficiency* question (§11) and the *proof that bonuses retain* (§10) wait on data — they don't block this week's actions." Tool: `Edit`.

**Verify:** A reader can tell which DO-NOW actions are solid today vs which questions are pending, without decoding the hedges themselves.

---

## Task 7: Surface consistency + tab subtitle

- [x] **Task 7** — ✅ Consistency: 34%→33.9%/74.8%; 'H1→H2'→'vs first half'; 'in play'→'at stake'; 'positive net revenue'/'observationally' removed from visible text. Tab subtitle deferred (layout risk).

**Files:** `templates/acq-dashboard.html`

**Step 1:** One figure for the concentration stat (33.9% / 74.8% everywhere — fix any "34%/75%"); one notation for the half-year compare ("first half vs second half", spelled out once, then reused); one phrase for the money-at-risk idea (pick "at risk"); spell out RM (Ringgit), HOD, CRM, YTD on first use. Add a tab subtitle/first-line so "Big-player detection" isn't read as fraud/bot detection — e.g. a one-line lead "Marketing decisions for our biggest players (whales)." Tool: `Edit`.

**Verify:** No mixed figures/notation/phrasing; abbreviations expanded on first use; the tab's purpose is clear from the first line before §1.

---

## Task 8: Build, verify → FINAL

- [x] **Task 8** — ✅ Build clean, DOM verified all fixes, zero console errors. Optional re-run of the 6-persona audit offered. — Depends: 1–7

**Files:** `templates/acq-dashboard.html` (fixes only)

**Step 1:** Run `whale_detection.py`; build; `node --check`; DOM-verify each fix on the whale tab; console clean. Tool: `Bash` + Browser.

**Step 2 (optional re-verify):** Re-run the comprehension workflow (`wf_ed093fc4-04a` script, updated REPORT text) to confirm the count-collision and jargon confusions are gone. Tool: `Workflow`.

**Verify:** All fixes present; console clean; (if re-run) readers no longer flag the count collision / undefined holdout.

---

→ FINAL: Publish + commit template + output + `whale_detection.py` (never scratchpad). Status COMPLETED; update memory. Report the before/after: value already landed; these fixes remove the trust-breakers so a non-manager stays confident top-to-bottom.

## Out of scope
- Real player identities in the report (privacy); the deposit pull (P2); the holdout (P3). The glossary terms recur on other tabs — a report-wide glossary is a follow-on if wanted.
