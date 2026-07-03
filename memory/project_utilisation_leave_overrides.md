---
name: project-utilisation-leave-overrides
description: pull-utilisation.mjs: leaveOverrides, WR fallback, team avg divisor fix, current results (2026-06-20)
metadata: 
  node_type: memory
  type: project
  originSessionId: 648c60e5-e96e-4acd-850a-6de4e5d37482
---

## leaveOverrides in pull-utilisation.mjs (as of 2026-06-20)

```javascript
const leaveOverrides = {
  Jascinta: ['2026-03-06', '2026-05-25', '2026-05-29', '2026-06-03', '2026-06-04'],
  Wen:      ['2026-03-06'],
  Alysa:    ['2026-05-04'],
  Elyssa:   ['2026-01-29', '2026-02-16', '2026-04-13', '2026-05-25', '2026-05-29'],
};
```

**Why:** Confirmed unrecorded leave (absent from TG morning chain + Slack cross-check) that wasn't logged in tracker. Each entry reduces effective-hours denominator by 8h.

**How to apply:** Append to the relevant array and re-run `node bin/pull-utilisation.mjs --write`.

## Weekly Report fallback (added 2026-06-20)

When a staff member's individual tracker sheet throws (access denied, empty, wrong tab format), `pullWeeklyReportFallback(staffName)` reads the `Utilisation` tab from every Weekly Report file in the `Weekly Report` Drive root folder (`1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P`).

- Enumerates monthly subfolders dynamically via Drive API (`supportsAllDrives: true` required for org shared folders — without this, `files.list` returns 0 results)
- Reads `'Utilisation'!A:F` → `Staff | PH/AL days | Expected Hours | Actual Hours Logged | % | Notes`
- Parses week start date from file title ("Weekly Report D/M/YY-D/M/YY")
- Uses `expH > 0` guard to skip weeks before the person appeared
- WR fallback results carry `fallback: true` flag; the `(WR)` suffix appears in the Utilisation tab breakdown column

Fallback coverage (tested 2026-06-20): Gaby 6 weeks, Bangun 5 weeks. Their individual trackers ARE now filled in, so the fallback is currently dormant — it activates only on a tracker API error.

## Team avg divisor fix (dashboard, 2026-06-20)

**`calcWeeklyTeamUtil()`** changed from averaging per-person util% (fixed divisor = staff count) to a weighted pool: sum all actual hours / sum all expected hours across all active staff-weeks. Weeks where a staff member has no `we` entry (pre-join / post-resignation) are excluded from both numerator and denominator. Divisor varies naturally by week.

**`renderWeeklyCapacity`** avg row: `?? 40` fallback removed. Only staff with a `we` entry for that week contribute to expected hours. This corrects the artificially low early-weeks avg that was diluted by including not-yet-joined staff.

## Current utilisation results (dry run 2026-06-20)

| Staff | % | Hours | Denominator | Notes |
|-------|---|-------|-------------|-------|
| Jascinta | 83.0% | 697.0h / 840h | from 2026-01-02, +3we, -10PH, -6AL | |
| Wen | 60.1% | 370.2h / 616h | from 2026-02-23, +1we, -7PH, -1AL | |
| Alysa | 71.8% | 632.1h / 880h | from 2026-01-02, -10PH, -1AL | |
| Elyssa | 61.3% | 520.2h / 848h | from 2026-01-02, +2we, -10PH, -5AL | |
| Gaby | 42.6% | 105.7h / 248h | from 2026-05-04, -4PH | individual tracker now working |
| Bangun | 48.6% | 97.1h / 200h | from 2026-05-12, +3we, -4PH | individual tracker now working |
| Michelle | 83.4% | 393.4h / 472h | from 2026-01-02 to 2026-04-01, +8we, -5PH | resigned |
| **Total avg** | **64.4%** | | | active members only |
