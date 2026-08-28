# Plan: Discoveries — Wave 2

> **REQUIRED:** Execute task-by-task; pause at the → CHECKPOINT.

**Status:** COMPLETED
**Created:** 2026-08-28
**Goal:** Ship four verified discoveries — tier migration, minimum effective bonus, GGR-vs-NGR efficiency, value survival — each compute → emit → render.
**Design:** `projects/promo-value-creation/plans/2026-08-28-discoveries-wave2-design.md`
**Guardrails:** directional/association labels (D1 especially); member data stays in scratchpad; no member ids in committed JSON; plain language.

## File Map
- Create: `bin/vip_report/tier_migration.py`, `bin/vip_report/ggr_ngr.py`
- Create: `bin/vip_report/min_effective_bonus.py` (uses vip claim-rows; can extend to ret later)
- Create: `bin/discovery/value_survival.py` (ret + vip; acq 30-day)
- Modify: `templates/acq-dashboard.html` — one card per discovery on the fitting tab

---

### Task 1: Tier-migration compute
- [x] **Task 1**
  - Result: tier_migration.py -> vip.tier_migration: 1082 climbed/4954 held/30 slid; climbers 2x bonus, 8x NGR.
**Files:** Create `bin/vip_report/tier_migration.py`
**Step 1:** From member-ledger: per tier, count climbed/held/slid (start→end); for climbers vs held compare median vip_bonus, ytd_ngr, and H1→H2 deposit trend. Emit `vip.tier_migration = {by_tier:[...], climbers:{...}, held:{...}, totals:{...}}`.
**Verify:** climbed+held+slid = members with tier data; medians sane.

### Task 2: Render tier-migration (VIP)
- [x] **Task 2** · Depends: Task 1
  - Result: vipTierCard: climbed/held/slid flow + climbed-into-tier bars + association-not-proof note.
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** VIP card "Are we growing players up the tiers?": a flow/bars of climbed vs held vs slid + a climbers-vs-held bonus/NGR compare; caption labels it **association, not proof**.
**Verify:** `--verify` build + render simulation; cross-foot; console clean.

### Task 3: Minimum-effective-bonus compute
- [x] **Task 3**
  - Result: bin/vip_report/min_effective_bonus.py -> vip.bonus_sizing. <RM50 +10.67 dep/RM +2.66 ngr/RM; collapses above RM150; RM1000+ -0.84/-1.46; RM7.26M oversized. Cross-foots.
**Files:** Create `bin/vip_report/min_effective_bonus.py`
**Step 1:** From claim-rows (matured): band bonus_cost (<50/50-150/150-400/400-1000/1000+); per band compute deposit-lift per RM (Σdep_lift/Σcost), ngr-lift per RM, claims; also a per-tier cut. Identify the "minimum effective" band and the counter-productive top band. Emit `vip.bonus_sizing`.
**Verify:** bands cover all matured claims; per-RM matches the teaser (<50 ≈ +10.7, 1000+ ≈ −0.8).

### Task 4: Render minimum-effective-bonus (VIP)
- [x] **Task 4** · Depends: Task 3
  - Result: vipSizingCard (after sweet-spot) via vBars: dep-lift/RM + ngr/RM by band + note. Verified data + build.
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** VIP card "How big should the bonus be?": bars of deposit-lift-per-RM by size band (green→red as it falls below break-even) + a one-line "smallest bonus that still works" + flag the oversized spend. Directional caveat.
**Verify:** `--verify` + simulation; cross-foot; 0-jargon.

→ CHECKPOINT: Show D1 + D2 (the two strongest); confirm before D3/D4.

### Task 5: GGR-vs-NGR compute
- [x] **Task 5**
  - Result: ggr_ngr.py -> vip.ggr_ngr: 1717/6393 over-bonused = RM1.6M, concentrated Silver/Gold; GGR covers bonus 9.8x.
**Files:** Create `bin/vip_report/ggr_ngr.py`
**Step 1:** From member-ledger: per member bonus-as-%-of-ggr; count/spend of "over-bonused" (bonus > 50% of ggr) among ggr-positive VIPs, by tier; also the program GGR-coverage of bonus. Emit `vip.ggr_ngr`.
**Verify:** over-bonused ⊆ ggr-positive; RM matches teaser (~RM1.6M).

### Task 6: Render GGR-vs-NGR (VIP)
- [x] **Task 6** · Depends: Task 5
  - Result: vipGgrCard: over-bonused by tier table + trim-worst-cases note.
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** VIP card "Where the bonus eats the margin": over-bonused count + RM by tier + a plain "trim here without losing the play" note.
**Verify:** `--verify` + simulation; cross-foot.

### Task 7: Value-survival compute
- [x] **Task 7**
  - Result: value_survival.py -> ret+vip.survival: deposit-bonus 100% durable, free-credit fades to low-80s.
**Files:** Create `bin/discovery/value_survival.py`
**Step 1:** From ret + vip claim-rows (matured-60/90): share still depositing by day 60 / 90, cut by mechanic and by lifecycle/tier; acquisition gets the 30-day near-term read from claim-outcomes. Emit `*.survival` blocks.
**Verify:** shares ∈ [0,100]; denominators are matured claims only.

### Task 8: Render value-survival
- [x] **Task 8** · Depends: Task 7
  - Result: retSurvivalCard: still-depositing day60/90 by bonus type + favour-deposit note.
**Files:** Modify `templates/acq-dashboard.html`
**Step 1:** A card (Retention/VIP) "Does the value last?": survival curve to 60/90 by mechanic; plain note (VIP ~96% = durable / would stay anyway; contrast weaker segments).
**Verify:** `--verify` + simulation; cross-foot; console clean.

→ FINAL: full build + publish; no member data committed; Status → COMPLETED; commit.
