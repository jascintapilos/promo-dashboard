---
name: Promo request sheet — always use current month tab
description: Standing rule for parsing the Promo Code Request Details Template Google Sheet — only the current-month tab counts; older tabs reuse the same P### numbers and must not be mixed in.
type: feedback
originSessionId: c236a820-16a6-4fdc-819b-36f0ab19fa3d
---
When looking up a promo request by its `P###` number (e.g. P042) in the team's "Promo Code Request Details Template" Google Sheet (file id `1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM`), **always read from the current-month tab only**. The sheet has one tab per month; earlier months reuse the same P### numbering, so the same P042 row exists multiple times across tabs but means different brands/promos each time.

**Why:** mixing tabs led to a wrong-target moment — a user asked to canary "P042" expecting the May 2026 row, but the cached markdown dump had pulled P042 from May 2025 (WS1 brand) and another month (QPRO3/QPRO4) mixed in. Without the month filter, the bot picks the wrong row.

**How to apply (strict — Jascinta 2026-05-16):**
- Whenever a `P###` reference appears in a chat, **default to the current-month tab row, period.** Never list / dry-run / commit older-month records "for reference" — that wastes attention and risks acting on the wrong target.
- The ingest pipeline now reads from a fresh **XLSX export** of the spreadsheet (not the old markdown dump). `bin/refresh-sheet.mjs` downloads the latest XLSX → `captures/sheet-extracted/`. `bin/ingest-requests.js` reads ONLY the current-month tab by default (auto-detected by name: "May 2026", "June 2026", etc.). Other tabs are ignored unless `--tab=<name>` or `--all-tabs` is passed.
- Column positions are auto-detected from the header row — spreadsheet layout changes (new columns, reordered columns, renamed headers) no longer silently drop rows. The detector lives at `src/ingest-xlsx.js` → `HEADER_ALIASES`. Add new regex aliases there when the operator renames a header.
- Resolution rule for bare `P###`: among `captures/requests/P###-r*.json` fixtures, pick the one with the **highest `source_line`** (= newest tab). Since the ingest now only writes current-month rows by default, this usually yields the May/June/… row.
- The canary CLIs (`bin/canary-multi-brand.js`, `bin/canary-api.js`, `bin/canary-api-qp2.js`) auto-resolve bare `P###` via `resolveHandle()` (in `src/planner.js`). Teammates can pass either `P065` or `P065-r1435` — both work, both target the current-month row.
- Excel dates (stored as serial numbers like `46158.0`) are converted to human-readable `"DD MMM YYYY"` form by `maybeExcelDate()` in `src/ingest-xlsx.js`.
- If the current-month tab doesn't have a row for that P###, the CLI errors out cleanly rather than falling back to an older month.
- The legacy markdown ingest path is still available via `--markdown` flag, but use only for backfill / debugging.
