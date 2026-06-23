---
name: update-tracker
description: Update Jascinta's Work Hours Utilization Tracker in Google Sheets for the current or most recently completed week. Pulls data from Google Calendar, Slack, and Claude session files to reconstruct daily activities and estimate hours. Presents a draft table for review before writing to the sheet. Trigger on "update tracker", "update utilization", "update my hours", or /update-tracker.
---

# Work Hours Utilization Tracker — Weekly Update

You are updating Jascinta's utilization tracker in Google Sheets (sheet ID: `1z5IUbq4XwvihtyHH2jXU9lngh9FLvmvy-fAYbAcig00`). The working directory is `C:\Users\vdiuser\Downloads\promo-automation\promo-automation`.

## Step 1 — Determine the week

Today's date is available from the system. The tracker uses Mon–Fri weeks.

- If today is Mon–Thu: update the **prior** completed week (Mon–Fri of last week).
- If today is Fri: update the **current** week (Mon–Fri this week, up to today).
- If the user specifies a date or says "this week" / "last week", honour that instead.

Compute the 5 dates: Mon, Tue, Wed, Thu, Fri (format: DD/MM/YYYY).

## Step 2 — Pull data in parallel

Fire all of these simultaneously:

**A. Google Calendar** — fetch events for Mon 00:00 to Fri 23:59 MYT (Asia/Kuala_Lumpur). Use `list_events` from the connected Calendar MCP tool.

**B. Slack** — one search per working day using the connected Slack MCP tool:
```
from:<@U097Q9DTK29> on:YYYY-MM-DD
```
Run all 5 in parallel. Look at timestamps (first/last message) and content to gauge activity depth per day.

**C. Session files** — list JSONL files in `C:\Users\vdiuser\.claude\projects\C--Users-vdiuser-Downloads-promo-automation\` and group by which day they were **created** or **last modified**, noting file sizes (KB). Larger files = heavier automation work.

## Step 3 — Detect AL / PH days

A day is AL or PH if ANY of:
- Calendar has an all-day event named "Annual Leave", "AL", "Public Holiday", or "PH"
- Zero Slack messages AND zero session files created or modified that day
- The user has already told you (e.g. "Mon is AL")

Mark AL/PH days with the appropriate label. They get no hour entry.

## Step 4 — Estimate hours per working day

For each working day, estimate hours using this hierarchy:

1. **Meetings** — count from Calendar events. Do NOT use calendar end time blindly; gauge actual duration from Slack (was she messaging during the meeting? Did she join late?). Cap a single meeting at 1h unless it's a clearly extended session.

2. **Slack activity window** — first to last message gives the outer bound of the active window. Count the number of messages and their substance (substantive posts > 100 chars count as focus time; brief acknowledgements do not). A day with <5 messages that are all brief replies ≠ a full day.

3. **Claude sessions** — session files created/modified that day. Sum their sizes as a proxy for work depth:
   - <500KB: light (0.5–1h)
   - 500KB–2MB: moderate (1–2h)
   - 2–10MB: heavy (2–4h)
   - >10MB: very heavy (3–5h)
   Carryover sessions (created days earlier, just briefly touched) count at 25% weight.

4. **Hard caps and deductions**:
   - Claude usage limit hit (visible in Slack "Claude usage limit reached") → subtract 1–1.5h for the gap
   - RDP / system issues at start of day → subtract 0.5h
   - Explicit breaks ("need longer break to reset", "getting water") are already part of the window, not deducted
   - Day clearly ended before 5pm (last Slack <3pm, sessions closed <4pm) → cap at 6h max

5. **Maximum**: Never exceed 8h per day without explicit evidence (e.g. sessions still active past 8pm AND substantive Slack past 7pm). If evening activity exists, it can push a day above 8h only if she clearly worked after dinner — keep it at 8h otherwise (evening sessions often carry over).

## Step 5 — Draft entries per day

For each working day, draft 3–6 task rows. Rules:
- Lead with meetings in chronological order
- Follow with Claude Automation work (group session types: P### saves, skill fixes, canary runs)
- Slack coordination & team management (group all Slack-based coordination into 1–2 rows)
- Any other substantive work (deck preparation, proposals, documentation)
- Last row of the WEEK (Friday, or last working day): "Claude Automation — Work hours tracker Week N update (DD–DD Mon) via connected apps", 0.5h

**Hour allocation per row must sum to the day's total.**

**Naming conventions:**
- Meetings: match the exact calendar event name + attendees from Calendar + Zoom/Google Meet marker + time if relevant
- Claude Automation rows: be specific (e.g. "P001-P008 Ryan FS promo saves (QPRO4, QP2C)", not just "automation work")
- Slack rows: list the channels/people and what was actually coordinated

## Step 6 — Present draft table for confirmation

Show a compact table:

```
| Day   | Date     | Hours | Key activities (summary) |
|-------|----------|-------|--------------------------|
| Mon   | DD/MM    | Xh    | Meeting A, Claude work, Slack |
| Tue   | DD/MM    | AL    | Annual Leave |
...
| TOTAL |          | XXh   |              |
```

Then list the full draft entries day by day (date + task name + hours) so Jascinta can spot errors.

Ask: **"Does this look right? Let me know any corrections before I write to the sheet."**

Wait for her response. Apply any corrections she gives (e.g. "Wed was 6h not 8h", "Tue I had an extra meeting with X"). Do not write to the sheet until she approves.

## Step 7 — Find the right sheet location

Run this probe to find the current state of the sheet tab:

```
PROMO_SHEET_ID=1z5IUbq4XwvihtyHH2jXU9lngh9FLvmvy-fAYbAcig00 node bin/hours-probe.mjs --tab="<Month YYYY>" --start=1 --rows=5
```

Determine:
- The correct tab name: format `"Month YYYY"` (e.g. `"June 2026"`) matching the week's month. If the week spans two months, use the month of Monday.
- The **next empty row** after the last written entry. Read the tab from row 1 downward (use the probe script incrementally if needed) to find where data ends.
- The **WEEK number** for the marker row: count from the tab's first data week. Week 1 = first week with data in that tab.
- The **FIRST_DATA_ROW** for the SUM formula anchor = the row number of the first actual data entry in this week (the row after the WEEK N marker).

## Step 8 — Write to the sheet

Use an inline node script (not a file) via:

```
PROMO_SHEET_ID=1z5IUbq4XwvihtyHH2jXU9lngh9FLvmvy-fAYbAcig00 node --input-type=module << 'EOF'
import { getSheetsClient, getSpreadsheetId } from './src/sheets-client.js';
...
EOF
```

**Formula rules — NEVER deviate:**
- Cumulative (col E): `=SUM($D$FIRST_DATA_ROW:D{rowNum})`
- Remaining (col F): `=40-E{rowNum}`
- Utilisation (col G): `=(E{rowNum}/40)*100`
- Denominator is ALWAYS 40 — never the number of working days in the week.
- AL/PH rows: only columns A (date) and B (label). No values in D/E/F/G.
- All rows write to columns A:H (include empty string for H/Remarks).

**Row structure:**
```javascript
const FIRST_DATA_ROW = <first data row number>;
const TAB = '<Month YYYY>';

const dataRow = (date, task, hours, rowNum) => [
  date, task, '', hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=40-E${rowNum}`,
  `=(E${rowNum}/40)*100`,
  '',
];
const leaveRow = (date, label) => ['', label, '', '', '', '', '', ''];
// For AL rows, use actual date in col A:
// ['DD/MM/YYYY', 'AL', '', '', '', '', '', '']
```

Write using `values.batchUpdate` with `valueInputOption: 'USER_ENTERED'`.

## Step 9 — QC verify

After writing, probe the last 3 rows of the written range and confirm:
- Final cumulative (E column) matches the expected week total
- Final F = 40 minus that total
- Final G = (total/40)*100

Report back: "Week N written. Total: Xh (Y%). Sheet rows R_start–R_end."

---

## Reference: hours-probe.mjs

The probe script lives at `bin/hours-probe.mjs`. Usage:
```
PROMO_SHEET_ID=... node bin/hours-probe.mjs --tab="June 2026" --start=1 --rows=10
```
It reads and prints rows from the given tab. If the script doesn't exist yet, read the sheet directly via the Sheets API instead.

## Reference: key identities
- Jascinta's Slack user ID: `U097Q9DTK29`
- Session files directory: `C:\Users\vdiuser\.claude\projects\C--Users-vdiuser-Downloads-promo-automation\`
- Sheet ID: `1z5IUbq4XwvihtyHH2jXU9lngh9FLvmvy-fAYbAcig00`
- Working directory: `C:\Users\vdiuser\Downloads\promo-automation\promo-automation`
- Sheets client: `src/sheets-client.js` — `getSheetsClient()` + `getSpreadsheetId()` (reads `PROMO_SHEET_ID` env var)
