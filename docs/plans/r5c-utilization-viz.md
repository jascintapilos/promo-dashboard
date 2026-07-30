# R5c — Utilization visualizations

**Status:** plan for Codex review
**Scope:** two new visuals in the Utilization tab. No new data. No changes outside `public/dashboard.html`.

---

## What ships

1. **Team utilization gauge** — Chart.js donut showing team average % vs a target band (70-90% green). Single glance answer to "are we healthy?"
2. **Under/over-utilized callout box** — three cards: **Under (<60%)**, **Healthy (60-90%)**, **Over (≥90%)**, each listing staff names in that bucket. Actionable — tells you who to reassign work to/from.

Both live inside `<div id="view-util">`, above the existing Team Capacity block.

Skipping: per-staff trend line (heatmap covers it), weekly heatmap (already exists as `#cap-weekly-grid`), YTD progress bars (existing `#cap-bars`), deliverables-per-hour (noisy).

---

## Data source (unchanged)

- Global `UTIL = data.utilisation || []` (populated in `renderAll()` at line 1531)
- Per-staff record shape: `{ Staff, '% Utilisation', Notes }`
- Existing helpers already filter with `HIDDEN_STAFF` and `RESIGNED_STAFF` sets
- Parse `% Utilisation` string like `'72%'` → `parseFloat('72%'.replace('%',''))`

Same parsing used in existing `renderCapacity()` (lines 1737-1802). Nothing new to load.

---

## DOM

Inside `<div id="view-util">`, above the existing Team Capacity card:

```html
<p class="section-label">Team health at a glance</p>
<div class="util-summary-row">
  <div class="card util-gauge-card">
    <div class="card-title">Team utilization</div>
    <div class="card-hint">Against 70–90% healthy target</div>
    <div class="util-gauge-wrap">
      <canvas id="util-gauge-canvas"></canvas>
      <div class="util-gauge-center">
        <div class="util-gauge-val" id="util-gauge-val">—</div>
        <div class="util-gauge-lbl">team average</div>
      </div>
    </div>
  </div>
  <div class="card util-buckets-card">
    <div class="card-title">Who to look at</div>
    <div class="card-hint">Buckets by current % utilization</div>
    <div class="util-bucket-row" id="util-buckets"></div>
  </div>
</div>
```

CSS block (~40 lines) inside the existing `<style>`:
- `.util-summary-row` — flex row, wraps on narrow
- `.util-gauge-card` / `.util-buckets-card` — split 40/60
- `.util-gauge-wrap` — 220px square container, canvas + centered value overlay
- `.util-bucket-row` — three side-by-side sub-cards
- Bucket palette: under=warn, healthy=good, over=risk (existing tokens)

---

## JS additions

One new function `renderUtilSummary()` called from `renderCapacity()` (at end, so both refresh on data reload):

```js
function renderUtilSummary(){
  const rows = UTIL.filter(u => (u.Staff||'').toLowerCase() !== 'total' && (u.Staff||'').trim() && !HIDDEN_STAFF.has(u.Staff) && !RESIGNED_STAFF.has(u.Staff));
  const withPct = rows
    .map(u => ({ staff: u.Staff, pct: parseFloat(String(u['% Utilisation']||'').replace('%','')) }))
    .filter(x => !isNaN(x.pct));
  const teamAvg = withPct.length ? withPct.reduce((s,x)=>s+x.pct,0) / withPct.length : NaN;
  renderUtilGauge(teamAvg);
  renderUtilBuckets(withPct);
}
```

**Gauge** (Chart.js doughnut, no external chart library needed — Chart.js already loaded at line 1211):

```js
let _utilGauge = null;
function renderUtilGauge(avg){
  const el = document.getElementById('util-gauge-canvas');
  const valEl = document.getElementById('util-gauge-val');
  if (!el) return;
  const safe = isNaN(avg) ? 0 : Math.max(0, Math.min(100, avg));
  valEl.textContent = isNaN(avg) ? '—' : `${avg.toFixed(0)}%`;
  const color = safe < 60 ? '#d97706' : safe > 90 ? '#dc2626' : '#16a34a';
  const cfg = {
    type: 'doughnut',
    data: {
      labels: ['Team', 'Remaining'],
      datasets: [{ data: [safe, 100 - safe], backgroundColor: [color, '#e9ecef'], borderWidth: 0 }],
    },
    options: { cutout: '72%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, animation: { duration: 400 } },
  };
  if (_utilGauge) { _utilGauge.destroy(); }
  _utilGauge = new Chart(el, cfg);
}
```

**Buckets** (no chart library, plain HTML):

```js
function renderUtilBuckets(withPct){
  const under = withPct.filter(x => x.pct < 60);
  const healthy = withPct.filter(x => x.pct >= 60 && x.pct <= 90);
  const over = withPct.filter(x => x.pct > 90);
  document.getElementById('util-buckets').innerHTML = [
    { label: 'Under (<60%)', cls: 'warn', items: under },
    { label: 'Healthy (60–90%)', cls: 'good', items: healthy },
    { label: 'Over (>90%)', cls: 'risk', items: over },
  ].map(b => `
    <div class="util-bucket util-bucket-${b.cls}">
      <div class="util-bucket-head">${b.label} <span class="util-bucket-count">${b.items.length}</span></div>
      <ul class="util-bucket-list">
        ${b.items.length
          ? b.items.map(x => `<li>${x.staff} <span class="util-bucket-pct">${x.pct.toFixed(0)}%</span></li>`).join('')
          : '<li class="util-bucket-empty">no one</li>'}
      </ul>
    </div>
  `).join('');
}
```

**Wire in:** append `renderUtilSummary();` to the end of `renderCapacity()` (line ~1804).

**XSS note:** staff names are non-user-input (they come from a curated sheet), rendered via template string + innerHTML. Matches the existing dashboard's pattern for rendering sheet data. If we want defense in depth, we can switch to textContent + DOM APIs — but this diverges from every other renderer in dashboard.html. Keep the pattern consistent.

---

## Acceptance criteria

- [ ] Utilization tab shows the new "Team health at a glance" section above Team capacity
- [ ] Gauge renders a donut with team average % in the center, colored by band
- [ ] Buckets show correct staff in each range with counts
- [ ] Both refresh when the Refresh button reloads data
- [ ] No console errors
- [ ] Chart.js `_utilGauge` is destroyed before re-creating (no leak on refresh)
- [ ] Full test suite still 148/148 pass (no server or test changes)
- [ ] No new files, only `public/dashboard.html` modified

---

## Safety constraints

- Only `public/dashboard.html` modified
- No new dependencies (Chart.js already loaded)
- No changes to Sheets API key, data fetch, or refresh flow
- Existing `renderCapacity()`, weekly grid, YTD bars all unchanged
- Nothing pushed until user approves diff and screenshot
