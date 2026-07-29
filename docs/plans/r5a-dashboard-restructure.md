# R5a — Ops Dashboard restructure

**Status:** plan for review
**Scope:** nav + view split only. No new data, no new visualizations. R5b and R5c come later.

---

## Changes (all in `public/dashboard.html`)

### 1. Side-nav tabs
Replace **Escalations** with **SOP**, add **Utilization** below Guardrails.

```diff
- <button class="pg-tab" id="pg-esc" onclick="switchView('esc')"><i class="ti ti-alert-circle"></i> Escalations</button>
  <button class="pg-tab" id="pg-hk"  onclick="switchView('hk')"><i class="ti ti-home-check"></i> Housekeeping</button>
  <button class="pg-tab" id="pg-gr"  onclick="switchView('gr')"><i class="ti ti-shield-check"></i> Guardrails</button>
+ <button class="pg-tab" id="pg-util" onclick="switchView('util')"><i class="ti ti-chart-histogram"></i> Utilization</button>
+ <button class="pg-tab" id="pg-sop" onclick="switchView('sop')"><i class="ti ti-book"></i> SOP</button>
  <button class="pg-tab" id="pg-at" onclick="switchView('at')"><i class="ti ti-robot"></i> Automation</button>
```

Final nav order: Operations · Housekeeping · Guardrails · Utilization · SOP · Automation.

### 2. Escalations view removal
Delete the entire `<div id="view-esc">...</div>` block (lines 647-834 confirmed by Codex).

**Codex-flagged regression fix:** `renderAll()` at `public/dashboard.html:1567` references `document.getElementById('view-esc').style.display` and will throw once the element is deleted. Guard that reference with a null check:

```diff
- if(!_escInit && document.getElementById('view-esc').style.display!=='none'){initEscalationCharts();renderEscTable();_escInit=true;}
+ const _escEl = document.getElementById('view-esc');
+ if(!_escInit && _escEl && _escEl.style.display!=='none'){initEscalationCharts();renderEscTable();_escInit=true;}
```

This one-line defensive guard lets the escalation JS (`_escInit`, `initEscalationCharts`, `renderEscTable`, `ESC_ROWS`) stay dormant in source (never triggered because the element it looks for doesn't exist). Cleanup of those functions deferred to a later chore commit.

### 3. New `<div id="view-util">` (new tab)
Move the **Team capacity** section (~lines 526-547) out of `view-ops` into `view-util`. Keeps existing `#cap-summary-row`, `#cap-bars`, `#cap-highlights`, `#cap-weekly-grid`, `#cap-tab-ytd`, `#cap-tab-weekly` element IDs unchanged so `renderCapacity()` still finds them.

Only the **Team capacity** card and its title (`section-label`) move. **Deliverables Trend stays in Operations** (it's about output volume, not utilization).

### 4. New `<div id="view-sop">` (new tab)
Single card with heading, a short description of what's in the Directory Sheet's SOP tab, and an external link. No iframe (Google Sheets iframes fail for non-owner viewers).

```html
<div id="view-sop" style="display:none;">
  <p class="section-label">Standard operating procedures</p>
  <div class="card" style="margin-bottom:28px;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;">
      <div>
        <div class="card-title">SOP index — Team Directory</div>
        <div class="card-hint" style="margin-top:6px;">Live working files and templates. Categories: Banner, Promo Code, Game, CRM, General Knowledge Library.</div>
      </div>
      <a href="https://docs.google.com/spreadsheets/d/1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68/edit" target="_blank" rel="noreferrer" class="btn"><i class="ti ti-external-link"></i> Open Directory sheet</a>
    </div>
    <ul style="margin-top:20px;line-height:1.9;color:var(--ink2);padding-left:20px;">
      <li><strong>Banner</strong> — working files, templates, upload procedures</li>
      <li><strong>Promo Code</strong> — naming convention, canary flow, T&amp;C</li>
      <li><strong>Game</strong> — provider onboarding, category updates</li>
      <li><strong>CRM</strong> — FastTrack / Smartico setup + workflows</li>
      <li><strong>General Knowledge Library</strong> — team-wide reference docs</li>
    </ul>
  </div>
</div>
```

R5b later replaces this static card with live data (either nightly sync into PromoOps Data or direct fetch from Directory Sheet).

### 5. `switchView()` update
- List of view IDs: `['ops','esc','hk','gr','at']` → `['ops','sop','hk','gr','util','at']`
- Remove escalation init block (`if(v==='esc' && !_escInit) ...`)
- Add util init: `if(v==='util') renderCapacity();` — since the Team capacity content lives in `view-util`, first-time activation should trigger a render. Actually already happens via `renderAll()` on load, so this may be a no-op. Keep it defensive.
- `showCtrl` check: date-btn + refresh still only visible on `v==='ops'`. Utilization view may also want them (it reads from the same weekly data) — **decision needed**. For MVP, keep them ops-only; user can toggle to ops to change the date range then back.
- `history.replaceState` hash mapping: `'sop'→'#sop'`, `'util'→'#utilization'`; drop `#escalations` (no alias — old bookmarks land on Operations by default via the else branch).

### 6. Hash-on-load routing (`~line 2827`)
```diff
- if(location.hash==='#escalations') switchView('esc');
- else if(location.hash==='#housekeeping') switchView('hk');
+ if(location.hash==='#housekeeping') switchView('hk');
  else if(location.hash==='#guardrails') switchView('gr');
+ else if(location.hash==='#utilization') switchView('util');
+ else if(location.hash==='#sop') switchView('sop');
  else if(location.hash==='#automation') switchView('at');
```

---

## Tests to add

Existing test coverage doesn't touch dashboard.html (it's a static page loaded via server). No new test file required. Manual verification via Playwright:

- All 6 tabs render without error
- Utilization tab shows the capacity table + weekly grid (moved intact)
- Operations tab no longer shows capacity block
- SOP tab shows the card with the external link
- Direct URL `#utilization` and `#sop` open the correct tab

---

## Acceptance criteria

- [ ] Escalations nav button gone
- [ ] SOP + Utilization nav buttons visible
- [ ] Team capacity section renders correctly in Utilization tab (weekly grid + YTD toggle both work)
- [ ] Operations tab no longer includes Team capacity
- [ ] SOP tab renders with external link that opens the Directory Sheet
- [ ] Deliverables Trend chart stays in Operations
- [ ] `#sop` / `#utilization` hash routing works
- [ ] No JS console errors on any tab
- [ ] Full test suite still 148/148 pass (no CSS/data changes affect existing tests)

---

## What R5a does NOT do

- Does not fetch live SOP data from Directory Sheet (that's R5b)
- Does not add any utilization visualizations (that's R5c)
- Does not remove the escalation JS from source (dormant)
- Does not change any data-fetch, date-picker, or refresh behavior
- Does not migrate any tab data or add new sheet ranges

---

## Safety constraints

- Only `public/dashboard.html` modified
- No changes to server, tests, or `bitbucket-pipelines.yml`
- No changes to Sheets API key or its restrictions
- No dependency additions
- No changes to CSS files outside the moved section (which uses existing classes)
- Full test suite must pass before commit; nothing pushed until user approves the diff
