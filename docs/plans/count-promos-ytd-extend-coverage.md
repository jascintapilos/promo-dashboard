# Plan: Extend count-promos-ytd.mjs coverage through 2026

**File:** `bin/count-promos-ytd.mjs`  
**Type:** Bug fix — data coverage  
**Risk:** None — read-only script, no BO writes  

---

## Problem

`bin/count-promos-ytd.mjs` has four related defects that cause all codes from late May onward to be miscounted:

1. **`WEEKS` array ends at W19 (2026-05-11 to 2026-05-18).** Any code with `created_at` after 2026-05-18 falls into the `'other'` bucket instead of a named week.

2. **`createdMonth()` maps only months 01–05.** Months 06–12 fall through the `?? m` fallback and return raw strings like `'06'`, `'07'` instead of `'Jun'`, `'Jul'`.

3. **`MONTH_ORDER` is hardcoded as `['Jan', 'Feb', 'Mar', 'Apr', 'May']`.** The weekly table display loop only iterates over these five months — June and July rows are never printed.

4. **`weeksByMonth` display map** uses the same Jan–May-only month name lookup — same gap.

5. **Hardcoded footer** `"Dashboard YTD (authoritative, Jan 1 – May 18): 1,641"` is stale and misleading.

---

## Fix

### 1. Auto-generate W20+ weeks

After the existing hardcoded `WEEKS` array (which ends 2026-05-18), append auto-generated week entries for the remainder of 2026. Generate Mon–Fri windows starting from 2026-05-19, numbered sequentially from W20, labelled in `DD/MM–DD/MM` format matching the existing style. Stop at 2026-12-31.

Use a helper function that takes a start date and generates entries until year-end:

```js
function generateRemainingWeeks(startDateStr, startWeekNum) {
  const weeks = [];
  let d = new Date(startDateStr + 'T00:00:00Z');
  let wn = startWeekNum;
  while (d.getFullYear() === 2026) {
    const from = d.toISOString().slice(0, 10);
    // Advance to Friday (or stay within year)
    const fri = new Date(d);
    fri.setUTCDate(fri.getUTCDate() + 4);
    if (fri.getFullYear() > 2026) break;
    const to = fri.toISOString().slice(0, 10);
    const fmt = (s) => s.slice(8) + '/' + s.slice(5, 7); // DD/MM
    const label = `W${String(wn).padStart(2, '0')} ${fmt(from)}–${fmt(to)}`;
    weeks.push({ label, from, to });
    // Next Monday
    d.setUTCDate(d.getUTCDate() + 7);
    wn++;
  }
  return weeks;
}

const WEEKS = [
  // ... existing W01–W19 entries unchanged ...
  ...generateRemainingWeeks('2026-05-18', 20),
];
```

> Note: W19 ends 2026-05-18 (Monday). W20 should start 2026-05-18 (same Monday) through Friday 2026-05-22. Adjust start to avoid overlap: if W19 `to` date is a Monday, W20 `from` should be that same Monday (Mon–Fri window). Check that `from` of W20 doesn't overlap with `to` of W19 for the same day — it is fine since W19's to is inclusive end-of-day and W20's from is start-of-day Monday.

### 2. Fix `createdMonth()` — all 12 months

Replace the partial month map:

```js
// Before
return { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May' }[m] ?? m;

// After
const MONTH_NAMES = {
  '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun',
  '07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec'
};
return MONTH_NAMES[m] ?? m;
```

### 3. Fix `MONTH_ORDER` — dynamic, all 12 months

Replace the hardcoded `MONTH_ORDER` constant and `weeksByMonth` month map in the display section with a derived list that includes every month that has at least one week entry:

```js
// Build month order from actual weeks (preserves chronological order)
const ALL_MONTH_NAMES = {
  '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun',
  '07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec'
};
const weeksByMonth = {};
for (const w of WEEKS) {
  const d = new Date(w.from + 'T00:00:00Z');
  const m = ALL_MONTH_NAMES[d.toISOString().slice(5, 7)] ?? '?';
  (weeksByMonth[m] = weeksByMonth[m] || []).push(w.label);
}
// Month order: unique months in the order they appear in WEEKS
const MONTH_ORDER = [...new Set(WEEKS.map(w => {
  const mn = w.from.slice(5, 7);
  return ALL_MONTH_NAMES[mn] ?? mn;
}))];
```

### 4. Remove hardcoded footer

Remove or replace the stale line:
```
console.log('\nDashboard YTD (authoritative, Jan 1 – May 18):  1,641');
```

Replace with a dynamic note showing the actual date range covered:
```js
const firstWeek = WEEKS[0].from;
const lastWeek  = WEEKS[WEEKS.length - 1].to;
console.log(`\nDate range covered: ${firstWeek} → ${lastWeek}`);
console.log('Note: WS1 (MB8) and WS2 (RWS77) use BIA platform — not queried here.');
```

---

## Acceptance Criteria

- [ ] `node bin/count-promos-ytd.mjs --brand QPRO1` runs without error
- [ ] Weekly table shows weeks through at least W28 (mid-July 2026)
- [ ] No codes appear in `'other'` bucket for any standard 2026 date
- [ ] Monthly subtotals show `Jun` and `Jul` (not `'06'`, `'07'`)
- [ ] `--json` output: `byMonth` keys are `'Jun'`, `'Jul'` not `'06'`, `'07'`
- [ ] The hardcoded "Dashboard YTD: 1,641" footer line is gone
- [ ] Existing W01–W19 entries and their labels are unchanged

---

## Verification commands

```bash
# Run against a single brand (fast, ~2s)
node bin/count-promos-ytd.mjs --brand QPRO1

# Check JSON output for month keys
node bin/count-promos-ytd.mjs --brand QPRO1 --json

# Confirm no 'other' bucket in JSON (value should be 0)
node -e "
const { execSync } = require('child_process');
const out = execSync('node bin/count-promos-ytd.mjs --brand QPRO1 --json', { cwd: process.cwd() }).toString();
const lines = out.split('\n');
const jsonStart = lines.findIndex(l => l.startsWith('{'));
const data = JSON.parse(lines.slice(jsonStart).join('\n'));
console.log('other bucket:', data.byWeek.other);
console.log('Jun total:', data.byMonth.Jun ?? '(missing)');
console.log('Jul total:', data.byMonth.Jul ?? '(missing)');
"
```

---

## Safety constraints

- Read-only script — no BO writes, no file mutations
- Do not change the W01–W19 labels or date ranges (they match historical dashboard data)
- Do not change the `--json` output shape — `grand`, `byWeek`, `byMonth`, `byBrand` keys must remain
- Do not commit or push
