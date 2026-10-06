# Leave Board in "Promo Team Operations" (Node QC Hub)

**Status:** DRAFT — awaiting approval to implement.
**Decided (2026-09-29):** Abandon the Apps Script "Offline Board" merge (backed out). Build the same *casual* board experience into the Node hub (`public/dashboard.html` + `bin/qc-dashboard.mjs`), **replacing** the never-shipped formal approval-based leave feature that currently sits uncommitted in the working tree.
**Source material:** the Offline Board zip (`OfflineBoard.html` UI + `OfflineBoard.gs` server logic) — ported from Apps Script to Node.

---

## 1. What we're building (the casual model, "option 2")
A team leave board on the **Leave** tab: "off today" glance, Mon–Sun week strip, month calendar, an all-entries table with **edit/delete**, an add form, and a one-click **"Copy Slack post"** for the #promotions-team Offline List.

- **No approval workflow.** Any logged-in team member logs / edits / deletes directly.
- **Types:** `AL`, `MC`, `EL`, `HALF` (half-day) — the Offline Board set.
- **Free "note"** (shown to everyone), not a private admin-only reason — this is inherent to the casual model you picked.
- **Team-only comes for free:** every `/api/*` route already runs behind `requireSession` (`bin/qc-dashboard.mjs:682`), so only admitted users reach the board or its data. No extra gate needed.

## 2. What gets removed (all uncommitted, never shipped — no production impact)
- `src/qc-dashboard/leave-store.js` (formal store) → replaced by `leave-board-store.js`.
- Formal endpoints in `bin/qc-dashboard.mjs`: `POST /api/leave/apply`, formal `GET /api/leave`, `POST /api/leave/:id/decision` (`:333–358`).
- Formal UI in `public/dashboard.html`: the `#view-leave` form/planned/mine/approvals markup (`:810–~875`) and its JS (`renderLeavePlanned/Mine/Approvals`, `refreshLeaveTab`, `decideLeaveFromButton`, `initLeavePicker`, apply handler — `:3266–3420`).
- `test/qc-dashboard-leave-store.test.mjs` → replaced by `leave-board-store.test.mjs`.
- **Kept:** the `Leave` tab button (`:576`) and the `switchView('leave')` slot (`:3422`).

## 3. Server — new store `src/qc-dashboard/leave-board-store.js`
Ports `OfflineBoard.gs`. **Storage changed after first deploy:** the Google Sheets version returned 500 in production, most likely because the hub server has no Google credentials / `ops-sheet-id.local.json` (the Ops Dashboard reads Sheets client-side, so the server never needed them). Entries now live in a JSON file on the hub server instead.
- **File:** `data/leave-board.local.json` (or `LEAVE_BOARD_FILE` env for test runs). Gitignored via `*.local.json`, so the in-place git-pull deploy leaves it alone. Created on first write; missing = empty board; corrupt = error (never overwritten). Writes are synchronous read-modify-write with temp-file + rename. No secrets or provisioning.
- **Schema (cols A–H):** `id, name, type, start, end, note, createdAt, updatedAt`.
- **Validation (server-side, ported from `offlineClean_`):** name required (≤60), type ∈ set, dates `YYYY-MM-DD`, `end >= start`, note ≤80. Values are stored as plain JSON strings, so dates stay `YYYY-MM-DD` and a leading `=+-@` is just text.
- **Exports:** `listEntries()`, `addEntry(input, user)`, `updateEntry(id, input, user)`, `deleteEntry(id)`, `_test` (for unit tests). `name` free-text (prefilled with the caller's name) so you can log a teammate's leave — matches the Offline Board.

## 4. Server — endpoints in `bin/qc-dashboard.mjs` (inside `handleApi`, after the CSRF guard `:332`)
All mutations are POST so the existing CSRF guard covers them; all are team-gated by `requireSession`.
- `GET  /api/leave`            → `{ entries: [...] }`
- `POST /api/leave`            → add   → `{ ok, entry }`
- `POST /api/leave/:id`        → update
- `POST /api/leave/:id/delete` → delete
Swap the import at `:13` to the new store. Validation errors throw `{status:400}` → mapped by the existing `handle()` catch.

## 5. Client — `public/leave-board.html` (the board UI) + a route to serve it
- New file = `OfflineBoard.html` verbatim **except** the data layer: replace the `google.script.run` wrapper (`gs(fn,…)`) with a same-origin `fetch('/api/leave…')` helper (`credentials:'same-origin'`; Origin header satisfies `checkCsrf`). All rendering (calendar/week/off-today/table/Slack-post) is reused unchanged.
- **Serve it:** add a `/leave-board.html` route in the server mirroring the `/dashboard.html` route (`:696–709`).
- **Embed it:** the `#view-leave` tab becomes `<iframe src="/leave-board.html">`. Same origin as the hub, so cookies/session flow naturally — none of the Apps Script cross-origin/cookie iframe risk.
- `renderLeaveTab()` shrinks to "set the iframe src on first open."

**UI tweaks from mockup review (2026-09-29):** drop `· refreshes every minute` from the sync line (leave just `Updated HH:MM`), and remove the `Who's off, day by day` calendar subtitle (keep the `CALENDAR` eyebrow; move its `aria-labelledby` target to the eyebrow).

## 6. Acceptance criteria
1. Logged-in team member opens **Leave** → sees off-today / week / month calendar / table, all populated from `GET /api/leave`.
2. Add an entry → new row in the `Leave Board` tab (+ JSONL fallback); board refreshes.
3. Edit and delete work and persist.
4. "Copy Slack post" copies the Offline-List text (client-side only — no auto-posting, per `feedback_no_live_slack_ui_automation`).
5. A non-logged-in / non-admitted request to any `/api/leave*` route is rejected by the session gate.
6. Validation: bad type / reversed dates / missing name → 400, no row written.
7. Other tabs (Ops/SOP/Utilization/Automation) unchanged; `git diff` shows no change to `pull-utilisation.mjs`.

## 7. Verification (local, NO prod writes)
- Run `AUTH_MODE=dev LEAVE_BOARD_FILE=<temp path> node bin/qc-dashboard.mjs`; curl GET/POST/update/delete; confirm the temp file + `captures/qc-dashboard/leave-board-log.jsonl`.
- Open the hub in the browser, click **Leave**, add/edit/delete via the UI, confirm the calendar renders. Screenshot for sign-off.
- `node --test test/qc-dashboard-leave-board-store.test.mjs`.
- Unset `LEAVE_BOARD_FILE` and delete the temp file before finishing.

## 8. Deploy & risks
- **Ship path unchanged** (same Bitbucket → pipeline that deploys the hub). Commit/push only on explicit ask.
- **Not live until the Promo Team Operations deploy actually runs** — the VDI + cloudflared tunnel is the reliability caveat (up only while the VDI runs). Building is independent of this; shipping depends on it.
- **Optional seed:** the board starts empty. Can pre-load the same 13 starter entries from the zip if wanted (off by default to avoid writing stale rows to the live board).
