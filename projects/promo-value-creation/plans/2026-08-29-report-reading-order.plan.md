# Plan: Report reading order — one basics-first spine across all tabs

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** COMPLETED
**Created:** 2026-08-29
**Goal:** Reorder every tab onto ONE basics-first reading pattern so a reader with no management experience is eased in and builds up the same way on every tab — plus close the small content gaps a re-verify surfaced on the whale tab.
**Architecture:** Reordering = re-sequencing the `buildPanel('panel-X', [ … ])` spec arrays in `templates/acq-dashboard.html` (each entry is a `cardSec/leadSec/htmlSec/plainSec` — reordering the array reorders the sections; cards render independently, so this is low code-risk). The real risk is **narrative**: text that says "above / below / next / see X" must be fixed when a section moves. Plus targeted whale content edits (`whale_detection.py` + template).
**Tech/Tools:** Node build, Browser-pane verify, Artifact publish, Python (`whale_detection.py`). Optional re-verify: re-run the reading-order workflow.
**Design/evidence:** Reading-order audit (workflow `wf_2cf8c7a2-fe8`, 5 tab-auditors + 6 re-verify personas). Re-verify CONFIRMED the earlier whale fixes hold. **User decisions:** VIP = full basics-first (What-is before The decision); scope = all 5 tabs + the whale content fixes.

## The shared pattern (every tab follows this)
1. **What it is — and how it's judged** (orientation + yardstick + plain-English key)
2. **Main findings** (answers-first headline)
3. **Key numbers** (the KPI baseline)
4. **Rules & core concepts** (decision rules, definitions, the foundational splits every later chart assumes)
5. **Evidence, simplest → hardest** (single-axis → two-axis → grouped)
6. **The decision / top actions** (right after the evidence that drives it)
7. **Advanced trust-checks / program-wide** (robustness, incrementality, holdout, cross-subsidy) — late
8. **Reference** (full decision table, roster, campaign draft)
9. **Notes / Coming soon** (the tail)
Governing rules: concept before decision · rules before results · every evidence section before the action that needs it · hardest/statistical panels late · caveats & methodology in the tail · **no forward references**.

## Target order per tab (executor: reorder the buildPanel spec to match; keep every section)
**Summary:** 1 What this report is · 2 Main findings · 3 Promo portfolio · 4 Month by month · 5 Best-to-worst return · **6 Top decisions** (↑ from 7) · **7 How much can we trust this?** (↓ from 6) · 8 By campaign · 9 Open a pillar.

**Acquisition:** 1 What-is · 2 Main findings · 3 Key numbers · **4 Decision rules** (↑ from 5) · 5 Cost per first-time depositor · 6 Cost vs coming back · 7 By bonus type · **8 Deposit-required vs no-deposit** (↑ from 10) · 9 Sweet spot · 10 New depositors by month · **11 Where the money goes — is the headline real?** (↓ from 4, the hardest panel, now the capstone) · 12 Claim→deposit funnel · 13 Decision table · 14 Notes.

**Retention:** 1 What-is · 2 Main findings · 3 Key numbers · **4 Deposit-required vs no-deposit** (↑ from 6) · **5 Decision rules** (↑ from 8) · 6 Who the money reaches (lifecycle) · 7 Does the value last? (60/90) · 8 Extra returns / incrementality · 9 Net rev per RM by promo · 10 Money × retention · **11 Bonus type × tier (grid)** (↑ before the tier card that references it) · 12 By player tier · 13 Sweet spot by tier · 14 Decision table · 15 Notes · 16 Coming soon.

**VIP (full basics-first — the big one):** 1 **What VIP is** (↑ from 2; decision no longer opens) · 2 Main findings · 3 **Key numbers** (↑ from 11) · 4 **The four groups** (↑ from 12; the concept) · 5 Deposit-required vs no-deposit · 6 Sweet spot by tier · 7-10 A/B/C/D lanes · 11 Funding balance by tier · 12 Where the bonus eats the margin · 13 Growing up the tiers · 14 Whales — the big players · **15 The decision** (↓ from 1; after the evidence) · 16 Decision register · [**Need-to-know divider here**] · 17 Who carries whom (cross-subsidy; now after Whales it depends on) · 18 What the reinvestment is worth · 19 Why VIP performance is sliding · 20 Running it monthly · 21 Bonus-farming watch · 22 Scope & things to watch · 23 Notes · 24 Coming soon.

**Whale:** 1 What-is · 2 Main findings · 3 Key numbers · **4 Where value concentrates** (↑ from 6; concept before the call) · 5 The 74 whales · **6 At-risk whale ledger** (↑ before the save-list it feeds) · 7 Save-list · **8 The whale call** (↓ from 4; after the concept+evidence) · **9 Why protect, not cut** (↑ from 12; the rationale, right after the call) · 10 Rising · 11 Does the bonus keep them? · 12 Is the bonus spend working? · 13 Notes.

---

## Task 1: Whale content fixes (from the re-verify) — do first, independent of reorder

- [x] **Task 1** — ✅ 'reachable' defined + 44→28-reachable/~16-gone reconciled; the two '19's de-collided (§11 → 'look over/under-funded ≈'); §11 verdicts softened; YTD/BO/HOD/CRM + /RM glossed.

**Files:** `bin/vip_report/whale_detection.py`, `templates/acq-dashboard.html`

**Step 1:** Define **"reachable"** where it's used (save-list + who's-who): add a one-liner "reachable = a cooling whale still showing a pulse (active recently or still depositing) — the {15} others look already gone." Reconcile the 44-cooling vs 29-reachable gap so it doesn't read as two parallel groups. Tool: `Edit` (template + `counts_reconciliation` in `whale_detection.py`).

**Step 2:** De-collide the two "19"s — §10 "19 whales with no bonus" vs §11 "19 over-fed & steady". Reword one (e.g. §11 → "19 low-risk whales getting above-median bonus"). And **quarantine §11's placeholder verdicts**: since it's a placeholder, soften "trim 19 / fund 12" to "≈19 look over-funded / ≈12 under-funded (a rough split; the real call waits on the pull)" so it doesn't fight the "protect, don't cut" thesis or invite acting on a not-yet-real metric. Tool: `Edit`.

**Step 3:** Gloss bare acronyms on first use in the whale tab: **YTD** (year-to-date), **BO** (Back Office), **HOD** (Head of Department), **CRM**; and the **/RM** notation once ("per RM1 of bonus"). Tool: `Edit`.

**Verify:** "reachable" defined; the 44/29 gap explained; the two 19s no longer read as the same group; §11 reads as an estimate, not an instruction; acronyms glossed.

---

## Task 2: Summary reorder

- [x] **Task 2** — ✅ Summary: Top decisions (6) now precedes How-much-trust (7).

**Files:** `templates/acq-dashboard.html` (`buildPanel('panel-summary', …)`)

**Step 1:** Swap so **Top decisions** precedes **How much can we trust this?** (move the trust-check to just before "By campaign"). Fix any "above/below" text in those two sections. Tool: `Edit`.

**Verify:** The plain action ("Top decisions") comes before the confidence caveat; caveat sits with the reference tail; no broken cross-references.

---

## Task 3: Acquisition reorder

- [x] **Task 3** — ✅ Acquisition: Decision rules→4, deposit-split→8 (before sweet spot), robustness panel→12 (capstone).

**Files:** `templates/acq-dashboard.html` (`buildPanel('panel-acquisition', …)`)

**Step 1:** Reorder to the target above — **Decision rules → slot 4**, **deposit-split → before the sweet spot**, the **"is the headline real?" robustness panel → after the per-code charts (~11)**. Fix forward-reference text (e.g. sweet-spot/deposit cross-refs). Tool: `Edit`.

**Verify:** Rules appear before any code is graded; deposit-split precedes the sweet spot; the robustness panel reads as a capstone, not an ambush.

---

## Task 4: Retention reorder

- [x] **Task 4** — ✅ Retention: deposit-split→4, rules→5, grid→11 before tier card→12 (forward-ref fixed).

**Files:** `templates/acq-dashboard.html` (`buildPanel('panel-retention', …)`)

**Step 1:** Reorder to target — **deposit-split → 4**, **Decision rules → 5**, and put the **"Bonus type × tier" grid before the "By player tier" card** (kills the forward reference). Update the tier card's "see the grid first" wording if needed. Tool: `Edit`.

**Verify:** Deposit-split is early; the grid precedes the card that references it; no forward reference remains.

---

## Task 5: VIP reorder (the largest — un-invert the divider)

- [x] **Task 5** — ✅ VIP: What-VIP-is leads; Key numbers+four-groups lifted above the divider; decision at §9 after the evidence; divider reworded; cross-subsidy after Whales. Verified opens on orient, decision box renders.

**Files:** `templates/acq-dashboard.html` (`buildPanel('panel-vip', …)`)

**Step 1:** Rebuild the VIP spec to the target order: **lead with "What VIP is"** (not "The decision"); **lift Key numbers + "The four groups" (+ its A/B/C/D lanes) above** the "Need to know" divider; concepts (deposit-split, four groups) before evidence; **introduce "Whales" before "Who carries whom"** (which depends on it); place **"The decision" + Decision register after the evidence**; move cross-subsidy / reinvestment / "why sliding" / operating **below** the divider as advanced; scope/notes in the tail. Tool: `Edit`.

**Step 2:** Fix every "above/below/answers above/supporting detail below" reference to match the new positions (the divider text, the Main-findings "answers above" framing, "the concentration risk above", etc.). Tool: `Edit`.

**Verify:** VIP opens with orientation; a reader can stop at the divider and understand the whole story; no card references another that now appears later; the decision sits after the evidence.

---

## Task 6: Whale reorder

- [x] **Task 6** — ✅ Whale: concentration→4 (before the call), ledger→6 before save-list→7, call→8, why-protect→9. Save-list link still resolves.

**Files:** `templates/acq-dashboard.html` (`buildPanel('panel-whale', …)`)

**Step 1:** Reorder to target — **"Where value concentrates" before "The whale call"**, **"At-risk ledger" before "Save-list"**, **"Why protect, not cut" right after "The whale call"**. Fix references: §8 ledger says "the concentration risk above" (still true), the save-list/§6 wording, and the Main-findings "see the save-list" link still resolves. Tool: `Edit`.

**Verify:** Concept precedes the decision; the ledger precedes the save-list that ranks it; the rationale sits with the call; links still work.

---

## Task 7: Full build & verify → FINAL

- [x] **Task 7** — ✅ All 5 tabs match target order; build clean; forward-refs checked (572 now backward-pointing, 614 correct); zero console errors. — Depends: 1–6

**Files:** `templates/acq-dashboard.html` (fixes only)

**Step 1:** Run `whale_detection.py`; build; `node --check`. Tool: `Bash`.

**Step 2:** DOM-verify each tab's new section order (titles in the expected sequence), no console errors, and spot-check that no "see X above/below/next" points the wrong way. Tool: `Bash` + Browser.

**Step 3 (optional re-verify):** Re-run the reading-order workflow with the new orders to confirm each tab now flows basics-first. Tool: `Workflow`.

**Verify:** All 5 tabs match the target order; console clean; no broken cross-references.

---

→ FINAL: Publish + commit template + output + `whale_detection.py` (never scratchpad). Status COMPLETED; update memory. Report the shared pattern + the before/after per tab.

## Notes / risks
- Reordering the spec array is safe (cards render independently) — the ONLY breakage vector is text that says above/below/next/see-X. Grep each tab for those after reordering.
- VIP (Task 5) is the highest-risk: 24 sections, a divider to un-invert, and several "answers above" references. Do it carefully and verify the divider reads correctly.
- Keep the whale save-list "See the save-list →" and roster "See the 74 →" links working after the reorder.

## Out of scope
- New metrics/pulls; the deposit pull (P2); the holdout (P3). Content rewrites beyond Task 1's targeted fixes.
