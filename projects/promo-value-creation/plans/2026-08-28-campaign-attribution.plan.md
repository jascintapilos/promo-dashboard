# Plan: Campaign Attribution

> **REQUIRED:** Execute task-by-task; pause at the → CHECKPOINT.

**Status:** COMPLETED
**Created:** 2026-08-28
**Goal:** Tag every promo code with owner / campaign / objective (rules + override + gap), roll spend (exact) and directional outcomes up by campaign, and surface a gap register for the source teams.
**Design:** `projects/promo-value-creation/plans/2026-08-28-campaign-attribution-design.md`
**Guardrails:** spend-exact only for spend; outcomes labelled directional (never "promo-attributed NGR"); unmapped surfaced as a gap; no member data; overrides win over rules.

## File Map
- Create: `bin/campaign_tag.py` — rule + override classifier → `scratchpad/campaign-map-MY.json`
- Create: `campaign-map.overrides.json` (repo root or projects/…) — manual corrections, seeded empty
- Create: `bin/campaign_rollup.py` — `by_campaign` + `campaign_coverage` + `campaign_gaps` into metrics
- Modify: `templates/acq-dashboard.html` — "By campaign" view + gap register on Summary
- Data (scratchpad only): `campaign-map-MY.json`; metrics gain the campaign blocks

---

### Task 1: Rule-based tagger + override plumbing
- [x] **Task 1**
  - Result: ✅ bin/campaign_tag.py + campaign-map.overrides.json → campaign-map-MY.json (owner/campaign/objective/confidence). First pass 75% of spend attributed.
**Files:** Create `bin/campaign_tag.py`, `campaign-map.overrides.json` (`{}`)
**Step 1:** Load the 3 pillar metrics' codes + `promo-config-MY.json`. Define ordered name/config rules → {owner, campaign, objective, confidence:'rule-high'|'rule-low'}. Cover: World Cup, Weekly Rescue, Welcome, Birthday, Check-in, Mini-games, Payday, Referral, Reload/VIP-deposit, Membership/Entitlement, game-specific free-spins, CRM optimove, VM/AM prefixes.
**Step 2:** Apply overrides (win over rules). Unresolved → owner=Unknown/campaign=Unattributed/confidence='unattributed'. Emit `scratchpad/campaign-map-MY.json`.
**Verify:** print coverage (attributed codes/spend vs unattributed); every code present exactly once.

### Task 2: Tune the ruleset to lift coverage
- [x] **Task 2** · Depends: Task 1
  - Result: ✅ Added VIP Free Credit + Reactivation rules; fixed a mis-bucket (tier codes _gl_/_sil_ were matching Free-spins). Coverage 75%→99.9% (10 codes/RM8K unmapped). Spot-checked buckets.
**Files:** Modify `bin/campaign_tag.py`
**Step 1:** Inspect the unattributed list (codes + RM), add rules for the biggest unmapped clusters; re-run.
**Step 2:** Sanity-check a sample of each campaign bucket against code names.
**Verify:** unattributed spend share is materially reduced and honest; no code mis-bucketed in the top-spend sample.

### Task 3: Campaign rollup into metrics
- [x] **Task 3** · Depends: Task 2
  - Result: ✅ bin/campaign_rollup.py → acq.campaign_rollup (13 campaigns, spend cross-foots). VIP Free Credit RM3.4M -0.88; Reload RM3.37M +1.02; World Cup RM1.06M +1.75; Mini-games +4.33.
**Files:** Create `bin/campaign_rollup.py`
**Step 1:** Join the map to each pillar's codes. Emit `by_campaign` (per campaign: codes, spend, spend_share, + directional outcome: acq=cost/FTD & conversion; ret/vip=ngr_lift_per_rm) and `campaign_coverage` (attributed vs unattributed spend) into each pillar's metrics; also a consolidated cross-pillar campaign roll for Summary.
**Step 2:** Emit `campaign_gaps` = top unattributed codes by RM.
**Verify:** Σ campaign spend = Σ pillar spend (attributed + unattributed); spot-check one campaign's total against raw.

→ CHECKPOINT: Show the tagged coverage + campaign roll-up numbers; confirm before rendering.

### Task 4: Render the "By campaign" view + gap register
- [x] **Task 4** · Depends: Task 3
  - Result: ✅ Summary 'By campaign (discovery draft)' card: spend bars (exact) + directional returns + coverage + gap register. CHALLENGED first (verify-first+brainstorm): no authoritative BO campaign map exists, so framed as inferred draft; hard 'association not causal' caveat; returns computed on money-judged codes (basis stated); Unknown-owner spend surfaced as the gap. Verified via render simulation.
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** Add a Summary section: spend-by-campaign bars + a coverage bar (% attributed) + a directional-outcome column (labelled "association, not causal"). Wire into `renderSummary` + the summary spec.
**Step 2:** Add a compact gap register (top unattributed codes + RM) with the "send to CRM/Sales/Marketing" framing.
**Verify:** `--verify` build; render simulation against real data if the preview pane is unavailable; numbers cross-foot; 0-jargon; console clean.

→ FINAL: full build + publish; confirm no member data committed; update Status to COMPLETED; commit.
