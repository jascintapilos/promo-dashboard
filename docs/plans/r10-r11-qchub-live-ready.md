# R10 + R11 — QC Hub live-ready: interactive redesign + blocker fixes

**Status:** implementing (user approved 2026-07-30)
**Goal:** QC Hub polished and safe enough to use live today.
**Scope:** `public/qc-hub/` only. No server changes. No new dependencies.

---

## R10 — Interactive layout redesign

### Concept
Two-column live-ops workspace + persistent history drawer, replacing the flat top-to-bottom stack.

```
Topbar  ─────────────────────────────────────────────────────────────
[QC SETUP rail (sticky)] │ [ACTIVE QC WORKSPACE]         │ [HISTORY]
  Brand chips             │  Workflow: Setup→Run→Review→Save
  Codes + [+ Add code]    │  Batch tabs (one per code×brand)
  Open BO · Open Module   │  Verdict card
  [Run QC]                │  Details (compact)
                          │  Findings
                          │  Error & Remarks (FAIL/REVIEW only)
                          │  ── sticky bottom action bar ──
                          │  Pass · Fail · Review · Recheck · Save
```

### Specific HTML moves in `index.html`

- Wrap `<main>` in a new `.qc-layout` grid → `[QC-SETUP][WORKSPACE][HISTORY]`.
- Merge the current 3 stacked sections (Brands / Codes / Actions) into ONE **QC Setup** panel with a `qc-setup-rail` class + sticky positioning.
- Remove the duplicate `#searchBtn` (does the same thing as Run QC — Codex confirmed).
- Add **workflow progress strip** (`.workflow-strip`) with 4 steps: Setup · Running · Review · Save.
- Wrap `result-pills`, `verdictPanel`, `Promo Details` section, `Error & Remarks`, `result-row` in a single `.workspace` container.
- Move `Error & Remarks` section immediately after Findings, and hide it by default (show only when active result is FAIL or REVIEW, or when a "+ Add remark" button is clicked).
- Move `Pass/Fail/Review/Recheck/Save/Save All/Copy` into a sticky bottom bar (`.action-bar`) inside `.workspace`.
- Move `Recent QC History` into a right-side `.history-panel` with compact rows.
- Add empty-state text: no brands selected, no QC run yet.
- Add loading skeleton for verdict card + pills during Run QC (`.skeleton` class with shimmer animation).

### CSS additions

New tokens (top of `:root`):
```css
--pink: #db2777;
--pink-soft: #fce7f3;
--pink-line: #fbcfe8;
--elev-1: 0 1px 2px rgba(20,25,35,0.05), 0 1px 3px rgba(20,25,35,0.03);
--elev-2: 0 4px 12px rgba(20,25,35,0.06), 0 2px 4px rgba(20,25,35,0.03);
```

New rules (~250 lines):
- `.qc-layout` — grid, `grid-template-columns: 260px minmax(0, 1fr) 320px`, gap 16px, responsive collapse to single column at <980px
- `.qc-setup-rail`, `.workspace`, `.history-panel` panel styles
- `.qc-setup-rail { position: sticky; top: 16px; }` (desktop only)
- `.workflow-strip` — 4 steps, dot + label, active step gets pink underline, inactive muted
- `.action-bar` — sticky bottom inside `.workspace`, elevated shadow, flex-wrap buttons
- `.result-pill` gets shadow on hover, pink glow when selected, `aria-pressed` state
- `.skeleton` shimmer for loading state (keyframe animation)
- Empty-state helper class `.empty-state` — centered, muted, dashed border
- `.history-panel` compact row style with quick-Fix button
- Responsive: <980px collapse to single column; <640px hide history drawer, show as bottom section

### JS additions to `app.js` (~40 lines)

- `setWorkflowStep(step)` — updates `.workflow-strip` state (`setup` | `running` | `review` | `save`). Called from `runQc`, `renderRun`, `saveRecord`, `saveAll`.
- `renderEmptyStates()` — shows/hides empty-state text based on `state.brands.length`, `state.results.length`, active pill state.
- `showSkeleton() / hideSkeleton()` — toggled during Run QC in-flight.
- `updateRemarksVisibility()` — shows Error & Remarks only when active result verdict is `NOT_SAFE` or `REVIEW`, or user clicked "+ Add remark".
- Update `renderPills()` to set `aria-pressed` on active pill.

### Baby-pink usage (bounded)

- Active workflow step: `border-bottom: 2px solid var(--pink); color: var(--pink);`
- Selected batch pill (currently active): `box-shadow: 0 0 0 2px var(--pink-soft), inset 0 0 0 1px var(--pink);`
- "Requires Review" chip soft-bg: swap `--warn` bg for `--pink-soft`, keep amber text
- Sticky action bar Save button hover: `background: var(--pink-soft)`
- **Never** on FAIL/danger surfaces — `--danger` retains its lane.

### Line budget

- `index.html`: ~90 lines shuffled + ~60 added = ~150 line diff
- `styles.css`: ~240 lines added, ~20 removed = ~260 line diff
- `app.js`: ~50 lines added, ~10 refactored = ~60 line diff
- **Total ~470 lines** (slightly over 400 estimate — accepting scope creep for empty states + skeletons)

---

## R11 — Live-ready blocker fixes

Four fixes, all in `public/qc-hub/app.js`:

### Fix 1 — `loadHistory()` failure fatals the app (blocker)

**Current:** `init()` calls `loadHistory()` unwrapped; any 5xx replaces `<body>` with error text.

**Fix:** wrap `loadHistory()` in try/catch. On error, show inline banner in `.history-panel` header ("History unavailable — QC still works") and continue.

### Fix 2 — `saveRecord()` / `saveAll()` have no try/catch (blocker)

**Current:** failed writes throw uncaught, no user feedback.

**Fix:** wrap both in try/catch; on error show toast with error message, keep buttons enabled for retry.

### Fix 3 — `saveAll()` applies same remark to every result (blocker)

**Current:** every result gets the same `errorCategory`, `description`, `expected`, `actual`, `actionRequired`, `personResponsible`, `evidenceLink`. Risky when 3 brands FAIL for different reasons.

**Fix:** two-part:
1. Change default to **save active-only** semantics for the form fields — only the active result gets the remark values from the form. Other results get empty remark fields.
2. Show inline warning above Save All: "Remarks in the form will apply to the active result only. Other results will save without remarks." + link "Apply remark to all" (opt-in).

### Fix 4 — Form doesn't reset on pill switch (blocker)

**Current:** switch active pill → form still shows previous result's remarks → save the wrong thing.

**Fix:** store per-result form state in `state.selectedResults[key]` object (extend from just a verdict to `{verdict, remarks}`). On pill switch, load that result's remarks into the form (or reset if none). On any form field change, write back to `state.selectedResults[activeKey].remarks`.

### R11 line budget
- `app.js`: ~80 lines added/modified across 4 fixes
- `styles.css`: ~30 lines for toast + inline banner styles
- `index.html`: ~5 lines for toast container + banner slot

---

## Toast component (shared R10+R11)

Reused for save success, save error, history unavailable, copy success/fail, generic errors.

```html
<div id="toastContainer" class="toast-container" aria-live="polite"></div>
```

JS API: `toast('Saved 3 records', 'success')`, `toast('Save failed: network error', 'error')`, `toast('Copied', 'muted')`.

- Auto-dismiss after 4s (success/muted) or 6s (error).
- Click to dismiss early.
- Max 3 stacked; oldest evicted.

---

## Test approach

- **R10 (redesign):** no server changes, no test-suite changes. Manual verification via Playwright:
  - Full-page screenshot at 1440×1000 (desktop) and 768×1024 (tablet-portrait)
  - Verify workflow step transitions on Run QC → Review → Save
  - Verify empty states show/hide correctly
  - Verify sticky action bar stays put on scroll
  - Verify pink accents only in allowed slots (no warning/error slots)
- **R11 (fixes):**
  - Existing `test/qc-dashboard-routes.test.mjs` still 148/148 (no route changes)
  - Manual: force `/api/history` to 500 → verify inline banner + QC still usable
  - Manual: switch active pill twice → verify form fields swap correctly
  - Manual: Save All with 2 pills selected → verify remark only on active

---

## Rollback strategy

Both R10 + R11 land as **one commit** touching `public/qc-hub/*` only. If any issue found live:

```bash
git revert 74e031f  # (R10+R11 commit hash — placeholder)
git push origin main
git push bitbucket main
```

Deploy pipeline rolls the revert forward in <60s.

---

## Acceptance criteria (before "live")

**R10 UI:**
- [ ] Two-column layout renders on desktop, collapses on mobile
- [ ] Workflow strip shows correct step at each stage
- [ ] Sticky QC Setup rail stays visible on scroll
- [ ] Sticky action bar visible while reviewing findings
- [ ] History panel visible as right drawer on desktop
- [ ] Baby-pink accent applied to workflow / batch tabs / review chip only
- [ ] Empty states show when no brands selected / no QC run
- [ ] Loading skeletons show during Run QC in-flight
- [ ] No horizontal scroll at 1440px, 1024px, 768px, 640px viewport widths

**R11 correctness:**
- [ ] `loadHistory()` failure → inline banner, QC still usable
- [ ] Save error → toast, buttons stay enabled
- [ ] Save All → remarks only on active result unless "Apply to all" checked
- [ ] Pill switch → form fields load/reset correctly for the new active result

**Shared:**
- [ ] Full test suite 148/148 pass
- [ ] Nothing pushed until Jascinta reviews diff + screenshots
- [ ] Console clean (no errors) after full manual smoke run

---

## Safety constraints

- Only `public/qc-hub/*` modified (index.html, styles.css, app.js)
- No changes to `bin/qc-dashboard.mjs`, `src/`, or tests
- No new npm dependencies
- No `admitted-users.json` change
- Baby-pink strictly bounded per usage rules above
- Rollback = single `git revert` on the merged commit
