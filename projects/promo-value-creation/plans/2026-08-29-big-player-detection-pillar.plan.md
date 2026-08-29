# Plan: Big-player detection pillar (whale tab) + VIP whale summary

> **REQUIRED:** Use superpower-execution to implement this plan task-by-task.

**Status:** IN_PROGRESS
**Created:** 2026-08-29
**Goal:** Move the **depth** of the whale analysis out of VIP and into the already-stubbed "Big-player detection" tab (which becomes a full detect + decide surface), and leave VIP with a **condensed whale summary that still carries enough context** to understand why whales matter and click through. The depth exists once (the tab); VIP summarizes and links — no duplication.
**Architecture:** A new builder `bin/vip_report/whale_detection.py` emits a `whale_pillar` block (detection + decision, from existing data). The three whale-only cards **move** from `#panel-vip` into `#panel-whale` (relocate their markup so `buildPanel('panel-vip')`'s `replaceChildren` doesn't wipe them), joined by new detection cards (who / cooling / rising) and a whale decision box + moves. VIP loses those three cards and gains ONE condensed "Whales" summary card (headline stats + context + link to the tab). Two mixed cards give up only their whale sub-block: the reallocation card's "what keeping a whale is worth" and the operating card's whale-slip watchlist move to the tab, replaced in VIP by a one-line pointer.
**Tech/Tools:** Python 3 (`bin/vip_report/`), Node build, Browser-pane verify, Artifact publish. Reuse P0–P2 helpers (`buildPanel`/`cardSec`/`leadSec`/`htmlSec`/`byId`/`cardById`, `.dreg`/`.fbadge`/`.varbox`/`.decbox`/`vM`/`fmt`/`CV`).
**Design:** Stakeholder ask — separate marketing decisions for whales. User chose: **VIP section + own tab**, **detection layer**, and (this revision) **depth in the whale tab, summary + context in VIP, no duplication.** Builds on `project_vip_report_ceo_decision_layer_design` (P0–P2 shipped).

## Content disposition (the map that drives every task)
| Current card (in VIP) | Disposition |
|---|---|
| `v_whale` — Where value concentrates | **MOVE whole → whale tab** (becomes "Who's a whale / concentration") |
| `vipWhaleCard` — At-risk whale ledger | **MOVE whole → whale tab** (becomes "Cooling — act now") |
| `vipCostWrongCard` — Cost of being wrong (break-even) | **MOVE whole → whale tab** (whale-defection downside) |
| `vipReallocCard` — What the reinvestment is worth | **STAYS in VIP**, but its "What keeping a slipping whale is worth" sub-block **moves → whale tab**; VIP keeps marginal-return + Rescue + migration funnel, with a one-line pointer |
| `vipOperatingCard` — Running it monthly | **STAYS in VIP**, but the whale-slip **watchlist moves → whale tab**; VIP keeps baseline + indicators + tracker, with a one-line pointer |
| everything else in VIP (decision box, coverage, sweet spot, deposit split, lanes, GGR, funding, tier migration, farming, scope) | **STAYS in VIP** unchanged |
| NEW: condensed "Whales — the big players" summary card | **ADD to VIP** (headline stats + context + link to tab) |

## Key facts the executor MUST know
- **The tab already exists**: `data-tab="whale"` button (~line 407, "Big-player detection" + a `soon` badge to drop), `#panel-whale` placeholder (~line 680). Tab switching (~2088–2091) shows `panel-<key>`. `buildPanel('panel-whale', secs)` renders it like the others.
- **buildPanel wipes its panel**: `buildPanel('panel-vip')` does `panel.replaceChildren` — any card physically inside `#panel-vip` but NOT in the vip secs is destroyed. So the three moved cards' **markup must be relocated into `#panel-whale`** before wiring, and removed from the VIP spec.
- **No new pulls** — all in `vip-metrics-MY.json`: `program.whale` (74 top-1%, shares, 262 at-risk / RM15.3M), `whale_ledger` (opaque `members`, `summary{whales:74,cooling:44,whale_threshold_ngr:112721}`), `tier_migration.by_end_tier` (climbed_in Platinum 139 / Diamond 88 = rising), `reallocation` (cost_per_retained_whale directional + migration_funnel), `decision.breakeven`, `size_turnover`, `program.by_tier`.
- **Privacy**: whale watchlist opaque SHA1[:6] `ref` only, ever. Member-level stays in scratchpad.
- **Causal honesty**: `cost_per_retained_whale` stays directional/holdout-gated in the tab — do not upgrade.
- **Verify/publish** as P0–P2. DOM-checking the tab = click `[data-tab="whale"]`.

## File Map
- Create: `bin/vip_report/whale_detection.py` — `whale_pillar` block (definition/cohort/cooling/rising/downside/reinvest/decision).
- Modify: `templates/acq-dashboard.html` — relocate 3 whale cards' markup to `#panel-whale`; add detection cards + decision box + moves; `buildPanel('panel-whale', …)`; strip the 3 cards + whale sub-blocks from VIP, add the condensed VIP summary card + pointers; drop the `soon` badge; CALC/READ.
- Modify (regenerated): `outputs/acq-dashboard-MY.html`.

---

## Phase A — Whale tab holds the depth

### Task 1: `whale_detection.py` — the `whale_pillar` block

- [ ] **Task 1**

**Files:** Create `bin/vip_report/whale_detection.py`

**Step 1:** From existing blocks assemble `definition` (whale = top-1% by NGR, threshold ~RM112,721, share of NGR/bonus), `cooling` (44/74, 262 at-risk / RM15.3M, opaque watchlist), `rising` (climbers into Platinum/Diamond + climbers-vs-held medians), `downside` (Diamond/Platinum break-even), `reinvest` (cost_per_retained_whale directional summary), and a `decision` stance (protect-don't-cut top / retain cooling / grow rising / test before scale). Merge, print. Tool: `Write` + `Bash`.

**Verify:** `whale_pillar` present; cooling opaque; ties to 74/44 and 262/RM15.3M.

---

### Task 2: Relocate the 3 whale cards into `#panel-whale` + add detection/decision markup

- [ ] **Task 2** — Depends: Task 1

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** CUT the card markup for `v_whale`'s card, `vipWhaleCard`, and `vipCostWrongCard` out of `#panel-vip` and PASTE into `#panel-whale` (replacing the placeholder). Their render functions/ids are unchanged. Tool: `Edit`.

**Step 2:** Add to `#panel-whale`: a **whale decision box** (`v_whaleDecision`), and detection source cards **Who's a whale** (`v_whaleWho`), **Rising** (`v_whaleRising`); + a **whale moves** register (`v_whaleMoves`). Add render IIFEs reading `VIP.whale_pillar` (guarded). Move the reallocation card's "What keeping a whale is worth" render + the operating watchlist render into `#panel-whale` cards (`v_whaleReinvest`, `v_whaleCooling`); leave a one-line pointer where each was. Tool: `Edit`.

**Verify:** All whale markup now lives under `#panel-whale`; no orphaned ids; VIP no longer contains the 3 cards' markup.

---

### Task 3: `buildPanel('panel-whale')` + strip VIP spec + drop badge

- [ ] **Task 3** — Depends: Task 2

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** Add `buildPanel('panel-whale', [ decisionBox, htmlSec('Detect'), who, cooling, rising, htmlSec('The economics'), costWrong(break-even), reinvest, htmlSec('Decide'), moves, link→VIP ])`, decision box open by default. Tool: `Edit`.

**Step 2:** REMOVE `cardSec(byId('vipWhaleCard'))`, `cardSec(cardById('v_whale'))`, `cardSec(byId('vipCostWrongCard'))` from `buildPanel('panel-vip')`. Drop the `soon` badge on the tab button. Tool: `Edit`.

**Verify:** Whale tab renders decision box + detect (who/cooling/rising) + economics (break-even/reinvest) + moves + link; VIP no longer shows those cards; console clean.

---

### Task 4: CALC/READ + build/verify the tab

- [ ] **Task 4** — Depends: Task 3

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** CALC/READ for the new whale-tab cards (whale definition/threshold; cooling = H2<H1; reinvest directional). Run `whale_detection.py`, build, browser-verify the tab. Tool: `Edit` + `Bash` + Browser.

**Verify:** Tab complete, labels honest, opaque refs, console clean.

---

→ CHECKPOINT A: Publish + commit the tab (builder + template + output; never scratchpad). Show the user the Big-player detection tab holding the depth; confirm before trimming VIP to a summary.

---

## Phase B — VIP condensed summary + cross-link

### Task 5: Add the condensed "Whales" summary card in VIP

- [ ] **Task 5**

**Files:** Modify `templates/acq-dashboard.html`

**Step 1:** Where the whale cluster was, add ONE `vipWhaleSummaryCard` reading `whale_pillar`/`whale`: 3–4 lines of context (whales = top-1% / ~75% of VIP value; RM15.3M at risk and cooling; a rising pipeline; **protect-don't-cut**) + the two one-line pointers (reinvest, watchlist) + a prominent **"Full analysis → Big-player detection"** link (clicks `[data-tab="whale"]`). Enough context to understand the whale story without the depth. Wire it into `buildPanel('panel-vip')` where the cards were. Tool: `Edit`.

**Verify:** VIP shows a single whale summary with headline stats + link; no leftover whale depth in VIP.

---

### Task 6: Consolidated build & cross-navigation verify

- [ ] **Task 6** — Depends: Task 5

**Files:** Modify `templates/acq-dashboard.html` (fixes only)

**Step 1:** Run all VIP builders (+ `whale_detection.py`), build, `node --check`. Tool: `Bash`.

**Step 2:** DOM verify: whale tab holds the depth (concentration, ledger, break-even, reinvest, watchlist); VIP shows only the summary; VIP→tab and tab→VIP links switch panels; watchlist opaque and appears ONCE (in the tab); no console errors. Tool: `Bash` + Browser.

**Verify:** Cross-nav works both ways; depth appears once; console clean.

---

→ FINAL: Publish + commit; Status COMPLETED; update memory. Report the split (tab = depth, VIP = summary + link) and how they navigate.

## Open items to raise
1. **Whale-move owners/dates** — render TBC like the VIP register.
2. **Whale definition** — top-1% by NGR (~RM112,721) and rising = climbers into Platinum/Diamond; adjust if stakeholders use a different cut.
3. **How much VIP context is "enough"** — confirm the summary depth at Checkpoint A / Task 5 (headline stats + protect-don't-cut + pointers is the proposed bar).

## Out of scope
- New pulls; SG; the P3 holdout; per-whale profiles beyond the opaque-ref watchlist.
