# Promo Codes tab — Ops Dashboard

**Requested by:** Gabrielle Tiffany · **Drafted:** 2026-10-16 · **Branch:** `feat/promo-codes-tab`
**Status:** approved 2026-10-16 (viewer list only — admins not implied; daily 9 AM). Built on `feat/promo-codes-tab`; not merged.

## Goal

A "Promo Codes" tab on https://qc-dashboard.zoom66.xyz/dashboard listing every code from the
team's three code sheets, with each code's **live BO status per brand**, visible **only to a
named list of people** who must sign in.

## Data sources (read-only)

| Sheet | Drive id | Tabs used | ~Rows |
|---|---|---|---|
| CEE Codes | `1gCXe0wzYySMG-usZHvXAFVqq3SL2UmHhPjpvDemToKA` | `CEE Codes` | 31 |
| Sales Codes | `1Teg9TiKlubOjNF-0mjoHA9QLmWiI6EoiivMzjJgNm8s` | `Index (All Teams)` (VM/TSM/AM) | ~180 |
| CRM Codes | `1-ZjgA3ietUyh7TpotivVID1GgLZ9CyV7nIpy-PRA1HU` | `All CRM Codes` | ~1,185 |

The per-person / per-team tabs are subsets of the "All" / "Index" tabs, so only those are read
(avoids double counting). Header rows are located by name (e.g. `Live Code (BO)`), not by fixed
row number, so title/blank rows above the header don't break parsing. Section/group rows
(code cell empty) are carried as the row's `section` value.

Normalised row: `{ source: CEE|Sales|CRM, team, stakeholder, pic, section, code, brands[], region[], type, offer, sheetStatus, note }`.
Brand ranges like `QPRO1-4`, `QP2A-D` are expanded to individual brands.

## Live BO status

- Runs on the **VDI** (the server has no BO access), **once a day** (morning, next to the existing nightly pulls).
- Uses the existing read-only `fetchAllLiveCodes()` (`src/live-codes.js`) — one active-list
  call per QPRO site / QP2 merchant / IGMP site. **GET/list only — no PUT, no activate, no deactivate.**
- Per code × brand the tab shows: **Active on BO** · **Not active on BO** (not in the active list) ·
  **Not checked** (brand not covered: ZG1, UG01, JK01/JK02, NX01, or that site errored this run).
- A **mismatch** flag when sheet status disagrees with BO (e.g. sheet "crossed out" but still active on BO; sheet "Active" but not active on BO).
- WS1 rows are checked per region (WS1_MY / WS1_SG / …); WS2 is one site.
- Sales "group" brand labels — `ALL (QP2/QPRO)`, `ALL (except WS1)`, `QP2/QPRO + WS`, `21 brands` — take their named brands from
  the status cell's `Live:` / `Inactive:` lists; every QPRO/QP2 brand (+ WS1/WS2 if the label says WS) is still checked, as information only.
- Mismatch rules: a brand the sheet expects ON but BO has off/expired, or expects OFF (`Switched off on BO:` / `Inactive:` lists,
  or a crossed-out / "Not in use" row) but BO still has active. Brands under `Not checked:`, rows whose status starts "Not checked",
  and brands BO could not be read for never raise a mismatch.
- WS1/WS2 sessions expire: the daily job runs the existing `bin/refresh-igmp-sessions.mjs` (promo_testbot) first; if that login fails
  those brands show "Not checked" for the day.

## Delivery to the server

> **Superseded (2026-10-16):** the upload no longer uses the QC relay secret. It goes to `POST /api/promo-codes/snapshot`, signed with a dedicated Promo Codes feed key — see `docs/plans/promo-codes-feed-key.md`. The `/api/relay/promo-codes/dataset` route below was removed.

- New VDI script `bin/push-promo-codes.mjs`: read sheets → normalise → BO check → gzip JSON →
  `POST /api/relay/promo-codes/dataset`, HMAC-signed with the existing relay secret (same mechanism as `bin/push-ops-dataset.mjs`).
- Server writes it to `data/ops/promo-codes*.json` (already gitignored + deploy-surviving via `data/ops/`; override with `PROMO_CODES_DATA_DIR`). Code data never goes into git or into a public static file.
- A failed run records `ok:false` + reason and **keeps the last good data**; the tab shows "last checked <time>" and a stale warning if older than 36h.
- Scheduled via a Windows scheduled task on the VDI (`run-push-promo-codes.bat`, runs from its own folder), daily 9 AM. The VDI-side files (`bin/push-promo-codes.mjs`, `src/qc-dashboard/promo-codes-parse.js`, the `.bat`) must also exist in the VDI checkout that holds the BO/Google credentials.

## Access control (server-enforced)

- New git-tracked allowlist `promo-codes-viewers.json` → `{ "emails": [...] }`. Initial list: `gabrielle.tiffany@alphaiotabpo.com`, `shuern.lim@seahubasia.com` (add more on request).
- `GET /promo-codes.html` and `GET /api/promo-codes` require a session **and** email on that list → otherwise 403. Admins are **not** auto-included (explicit list only) unless requested.
- `/api/me` gains `canViewPromoCodes`; the dashboard hides the tab button when false (UX only — the server check is the real gate).
- **New role `promo-codes`** (report-only style) for viewers who should see *only* this tab:
  - added to `VALID_ROLES` and `REPORT_ONLY_ROLES` style gating, so `/` (QC Hub), `/dashboard` other views and all other `/api/*` stay refused;
  - a `promo-codes` user who signs in lands on `/promo-codes` (standalone page with the same table + logout), not the report-only refusal page.
  - Shuern is added to `admitted-users.json` with role `promo-codes`.
- promo-team/admin users on the allowlist see it as a tab inside `/dashboard` (iframe, same pattern as Leave).

## Files

New: `bin/push-promo-codes.mjs`, `src/qc-dashboard/promo-codes-parse.js` (sheet parsing + BO status, pure), `src/qc-dashboard/promo-codes-store.js` (validate/apply/read + allowlist), `public/promo-codes.html`, `promo-codes-viewers.json`, `run-push-promo-codes.bat`, `test/qc-dashboard-promo-codes-store.test.mjs`, `test/qc-dashboard-promo-codes-routes.test.mjs`.

Edited (small, additive):
- `bin/qc-dashboard.mjs` — 2 GET routes, 1 relay POST route, `/promo-codes` landing, `canViewPromoCodes` on `/api/me`.
- `src/qc-dashboard/auth.js` — add `promo-codes` role.
- `public/dashboard.html` — one tab button + iframe view (mirrors Leave).
- `public/qc-hub/app.js` — `/promo-codes` allowed as a post-login return path; `promo-codes` accounts are sent to their page.
- `public/admin-users.html` — `promo-codes` role label in Manage Users.
- `admitted-users.json` — add Shuern (`promo-codes`).

**Not touched:** any promo write-path / shared module (`api-client`, `live-codes`, `api-mapper-qp2`, `ingest`, `sheets-client`), the promo report (`src/qc-dashboard/promo.js`, `/promo/*`), QC logic.

## Page features

Search box (code / bonus name), filters (Source, Team/Stakeholder, Brand, Region, Type, BO status, Mismatch only), sortable columns, per-brand status chips, CSV export of the filtered view, "last checked" timestamp. Theme matches the Ops Dashboard.

## Acceptance criteria

1. Allowlisted promo-team user sees the "Promo Codes" tab on `/dashboard`; non-listed promo-team user does not, and `GET /api/promo-codes` returns 403 for them.
2. Signed-out request to `/promo-codes.html` or `/api/promo-codes` → redirect / 401.
3. `promo-codes` role user: lands on `/promo-codes`, sees data; `/`, `/dashboard`, `/api/ops/data`, `/api/run-qc` all refused.
4. Row counts per source match the sheets (CEE 31, Sales Index, CRM All) ± section rows.
5. Status chips match BO for a spot-check of 10 codes across QPRO / QP2 / WS1.
6. Failed push keeps previous data and shows the error + stale warning.
7. All existing tests still pass.

## Verification

```
npm install
node --check bin/qc-dashboard.mjs bin/push-promo-codes.mjs src/qc-dashboard/promo-codes-store.js
node --test test/qc-dashboard-promo-codes-store.test.mjs test/qc-dashboard-promo-codes-routes.test.mjs
npm test
node bin/push-promo-codes.mjs --dry-run    # reads sheets + BO, prints counts, pushes nothing
```

## Rollout (each step needs Gabrielle's go)

1. Build + test locally on `feat/promo-codes-tab`; review diff vs `main`.
2. Push the branch, open a Bitbucket PR (no deploy).
3. Heads-up to Jascinta (she is actively changing `bin/qc-dashboard.mjs` / `dashboard.html`); merge latest `main` into the branch first.
4. **Go** → merge to `main` → pipeline deploys to live QC Hub (production).
5. First live push: `node bin/push-promo-codes.mjs`; verify as Gabrielle + Shuern; then enable the daily scheduled task.

## Safety

- BO: read-only list calls only. No promotion mutation of any kind.
- No secrets in the diff (`*.local.json`, relay secret, OAuth tokens stay local).
- Data reaches only authenticated, allowlisted sessions.
