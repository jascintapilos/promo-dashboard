# R9 — Ops Dashboard visual polish

**Status:** plan for Codex review
**Scope:** three improvements per user + Codex agreement (option A). Only `public/dashboard.html` modified.

---

## Design token additions

Append to `:root` (near existing `--accent`):

```css
--pink-soft:#fce7f3;
--pink:#db2777;
--pink-line:#fbcfe8;
```

Rule of use:
- ✅ Active nav indicator (left border / dot on active `.pg-tab`)
- ✅ Selected filter chip background
- ✅ Section-label small dot (::before pseudo)
- ✅ Subtle hover state on inactive nav / chips
- ❌ Never for warnings/errors — `--risk-soft:#fcebeb` already owns the red/pink danger lane

---

## Improvement 1 — Command-strip header

**Current** header (`.head`): title left, `.head-right` cluster (dashboard switcher, logout button, date-btn, refresh).

**After R9:**
- Title + subtitle stay on left, cleaner spacing
- Right cluster reads as a single "ops controls" strip, from left to right: **[dashboard switcher] · [last-updated pill] · [date range chip] · [Refresh button] · [logout button]**
- Add a small **"Updated Nm ago"** pill (`--pink-soft` background, `--pink` text) — a stakeholder-grade freshness signal reusing the existing `#refresh-ts` timestamp
- Existing `.btn` and `.chip` styles reused; add one new class `.head-status-pill`

No new HTML data — the last-updated pill computes from `refresh-ts` on refresh.

---

## Improvement 2 — Read This First / Suggested Actions row

**Placement:** first row inside `view-ops`, above the existing KPI cards.

**Structure:** existing `.row2` grid, two `.card`s.

**Left card — "Read This First":**
- 3 auto-computed bullets from existing data:
  1. Current team utilization: `Team utilization is at NN% (healthy/attention needed)` from `UTIL` global
  2. Banner health: `X banners expired or missing this week` from `bannerHealth` tab
  3. Promo workload: `Y active promos across N brands this week` from `promos` tab
- Each bullet has a small pink dot (`.rtf-bullet::before` = pink circle)
- If any data source is empty, bullet shows `— not available yet` gracefully

**Right card — "Suggested Actions":**
- 3-5 hardcoded action rows (Jascinta can edit the array later)
- Each row: label + small chevron → link to relevant tab (`switchView('hk')` etc.)
- Examples:
  - `Review banner expiries` → Housekeeping
  - `Check utilization outliers` → Utilization
  - `Open SOP index` → SOP
  - `See automation roadmap` → Automation
- One row uses pink accent to draw attention (e.g. the topmost item)

**Function:** new `renderCommandBrief()`, called from `render()` at the same time as other renders.

---

## Improvement 3 — Sidebar section eyebrows

**Current sidebar:** flat list of 6 numbered tabs.

**After R9:** group tabs under eyebrows (uppercase, small, muted):

```
COMMAND
  1  Operations
  2  Utilization

QUALITY
  3  Housekeeping
  4  Guardrails

RESOURCES
  5  SOP
  6  Automation
```

- Eyebrows: `.pg-group-label` class — 10.5px, weight 700, letter-spacing 0.07em, `--ink3` color, 12px margin-top
- Active tab gets a **3px pink left border** (`--pink`) plus the existing blue background — combines "here you are" (blue) with product accent (pink)
- Inactive tab hover: subtle `--pink-soft` background (very soft — swap in for the current `#f0f1f4`)

No routing / switchView changes. Just HTML restructure + CSS.

---

## Not doing (Codex's over-investment warning)

- No full sidebar rebuild with nested/collapsible groups
- No ClickHouse-style status pill (CRM-specific)
- No "AI-ready" badges (would feel performative)
- No new data pipelines — Read-This-First reuses existing globals

---

## Acceptance criteria

- [ ] Three new tokens present in `:root`
- [ ] Header shows the ops-controls strip in this order: switcher · last-updated pill · date · refresh · logout
- [ ] Read This First card shows 3 auto-computed bullets that update on refresh
- [ ] Suggested Actions card shows 4 static action rows with tab-jump links
- [ ] Sidebar groups tabs under COMMAND / QUALITY / RESOURCES eyebrows
- [ ] Active tab shows blue background + 3px pink left border
- [ ] Baby pink appears ONLY in nav-active border, chip hover, section dots, "Updated N ago" pill — never on warnings/errors
- [ ] No console errors
- [ ] Full test suite 148/148 pass (CSS/HTML only)
- [ ] All 6 tabs still navigable, hash routing unchanged
- [ ] No changes to server, tests, or `bitbucket-pipelines.yml`

---

## Files touched

- `public/dashboard.html` only

Estimated ~120 lines added (tokens + CSS + HTML for the new row + JS for `renderCommandBrief`).

---

## Safety constraints

- No new dependencies
- No JS behavior changes beyond `renderCommandBrief()` being called from `render()`
- Existing KPI cards, capacity block, trend chart, and all other views untouched
- Baby pink usage strictly limited per token-use rules above
- Full test suite must pass before commit; nothing pushed until user approves the diff
