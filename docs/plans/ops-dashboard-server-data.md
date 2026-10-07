# Plan — Ops Dashboard reads its data from the dashboard server (option 4)

Status: **APPROVED 2026-10-07** · Author: Claude (for Jascinta) · 2026-10-07

## Why

On 2026-10-07 the Ops Dashboard (Tab 1, `qc-dashboard.zoom66.xyz/dashboard`) showed almost no data. Two separate failures caused it:

1. **The nightly pull died silently for 4 weeks.** `bin/nightly-pull.bat` built its log path from `wmic`, which is no longer on the VDI. From ~10 Sep the script crashed after step 1 of 12 every night. Task Scheduler still reported success, because the hidden `wscript` launcher always exits 0. Fixed locally on 2026-10-07 (PowerShell date), but nothing would have flagged a similar break.
2. **The browser reads the Google Sheet directly with a public API key.** Once the key was referrer-restricted, the page's `no-referrer` fetches were blocked. Patched 2026-10-07 (`strict-origin`), but the key is still shipped in `public/dashboard.html`. The 2026-10 security audit says to remove it.

The security branch's fix (`fix/security-audit-2026-10`, commit `5cee016`: `/api/ops-sheet/*` proxy) needs the **hosted server** to have Google credentials that can read the Ops sheet. Nobody has confirmed it does: the server never reads the sheet today.

## Goal

The VDI pushes each dataset to the dashboard server over the **existing HMAC relay**. The page reads from the server. That gives us:

- **No Google key in the page.** The server needs no Google credentials, because the VDI already has them.
- **Exact per-dataset freshness.** Each dataset carries when it was pulled, whether the pull succeeded, and its newest row date, so the dashboard can say "Banner log: last good pull 9 Sep" instead of "Updated 8m ago".
- **Failures surface the same day**, through the dashboard plus a Telegram alert.

## Non-goals (this plan)

- Rewriting the 10 pull scripts. They keep writing the Ops sheet exactly as today.
- Retiring the Google Sheet. It stays as the human-readable copy and the rollback path.
- Fixing Smartico/FastTrack logins (option 3). Separate work.
- Logging at the source, e.g. canary writes its row immediately (option 2). Separate work.

## Design

```
VDI (Task Scheduler 10:00 / 18:00)
  bin/nightly-pull.mjs  ── runs each step (own timeout, own status)
     │  step N writes Ops sheet tab(s)   (unchanged scripts)
     │  read those tab(s) back from the sheet (VDI OAuth)
     └─ POST /api/relay/ops/dataset/<key>   (HMAC, gzip JSON)
                                            │
Dashboard server                            ▼
  data/ops/<key>.json  (atomic tmp+rename; previous kept as <key>.prev.json)
  data/ops/status.json (per-key: pulledAt, ok, rowCount, newestRowDate, detail)
     │
  GET /api/ops/data   (session-gated; report-only roles 403)
     ▼
  public/dashboard.html  loadData() → same {promos, banners, …} shape as today
```

**The VDI reads back from the sheet instead of changing each script.** That keeps all 10 pull scripts untouched. It also covers the three **Manual Entry** tabs, which are typed by hand in the sheet, and puts exactly what the sheet holds onto the server.

### Datasets (allow-list, same 14 keys the page already uses)

| key | sheet tab | refreshed by |
|---|---|---|
| promos | Promo Code Log | step 1 |
| banners | Banner Log | steps 2–3 |
| games | New Games | step 4 |
| utilisation, utilWeekly, workLog | Utilisation, Utilisation Weekly, Work Log | step 5 |
| crm | CRM Assignment Log | steps 6b–9 |
| adhoc | Adhoc Tasks | step 10 |
| bannerHealth, homepageBannerStatus | Banner Health, Homepage Banner Status | step 11 |
| manualPromo, manualBanner, manualCrm | Manual Entry (Promo/Banner/CRM) | humans → pushed every run |
| sysStatus | System Status | replaced by `data/ops/status.json` (kept for compat) |

## Work breakdown

### Phase 1 — Server: ingest + read (repo `bin/qc-dashboard.mjs`, new `src/qc-dashboard/ops-store.js`)

1. `POST /api/relay/ops/dataset/:key`. It sits inside `handleRelayApi`, so it reuses `verifySignedRequest` (HMAC, ±60s, nonce).
   - **Body:** gzip JSON `{ key, pulledAt, ok, detail, headers:[…], rows:[[…]] }`. Body limit 8 MB.
   - **Validation:** key on the allow-list; `headers` matches that key's expected header set (warn-only on extra columns); rows ≤ 50k; cells are strings.
   - **Write:** atomic tmp+rename to `data/ops/<key>.json`. The previous file is kept as `.prev.json`. Then update `data/ops/status.json`.
   - **When `ok:false`:** keep the last good rows and only update status (the failure detail plus `lastFailureAt`).
2. `GET /api/ops/data`. Session-gated; report-only roles get 403 (same rule as other `/api/*`).
   - **Response:** `{ datasets:{key:{headers,rows}}, status:{key:{pulledAt,lastGoodAt,ok,rowCount,newestRowDate,detail}} }`.
   - **Size:** gzip-compressed if the client accepts it. Payload today is ~2.6 MB raw JSON, roughly 300 KB gzipped.
3. `GET /api/ops/health`. Session-gated; per-key staleness. Used by the page and by a later external monitor.
4. `data/ops/` is gitignored, and the hosting team must preserve it across deploys (same as `data/promo/`).

### Phase 2 — VDI: runner + push client

1. `bin/push-ops-dataset.mjs <key…>` reads the tab(s) via `src/sheets-client` and POSTs them with `buildSignedHeaders()`.
   - **URL:** from `QC_HUB_URL`, default `https://qc-dashboard.zoom66.xyz`, same as `push-promo-players.mjs`.
   - **Errors:** non-zero exit on any HTTP error.
2. `bin/nightly-pull.mjs` replaces the body of `nightly-pull.bat`; the `.bat` becomes a one-line wrapper so the scheduled task is unchanged.
   - **Isolation:** each step runs in a child process with its own timeout (default 10 min, FastTrack 15). One step's crash cannot stop the others.
   - **Status:** after each step, record status (existing `record-pull-status.mjs`) and push the step's dataset(s) with the real `ok` flag. Manual Entry tabs are pushed at the end of every run.
   - **Log:** written to `logs/nightly-pull-YYYYMMDD.txt` (date from Node, no `wmic`).
   - **Exit code:** the runner exits non-zero if any step failed, so Task Scheduler history is truthful. This needs `wscript … , 0, True` in the VBS launcher to wait for the exit code.
3. **Telegram alert** at the end of a run with any failed step, or any dataset whose newest row is older than its threshold. It uses the existing Promo TG bot, with a recipient to be decided (see questions). One message per run, not per step.

### Phase 3 — Dashboard page

1. `loadData()` fetches `/api/ops/data` and rebuilds the same `data.{promos,banners,…}` object via the existing `rowsToObjects`. Render code is unchanged.
2. Remove `SHEET_ID` and `SHEETS_API_KEY` from `public/dashboard.html`.
3. **Freshness, made honest:**
   - The header pill says when the data was last pulled, not when the page loaded.
   - Each "Detailed records" section shows the newest row date, amber after 2 days and red after 4.
   - The wrench popover's "Last pull" lists which steps failed and since when.
4. **No silent fallback to Google.** If the server has no data, show "Not synced yet" (fails loud).

### Phase 4 — Cut-over, then clean-up

1. **Shadow mode.** Deploy the server first, while the page still reads Google. Run the VDI push for 3 days and compare server row counts and newest dates against the sheet each run. The runner logs the diff.
2. **Flip.** Deploy the page change; the server must be restarted by the hosting team.
3. **Clean-up.**
   - After 2 weeks stable, restrict or rotate the Google API key in Google Cloud. Owner: whoever restricted it.
   - Drop the security branch's `5cee016` ops-sheet proxy, since this supersedes it. Keep its other commits.

## Acceptance criteria

- The page loads Tab 1–5 data with **no request to googleapis.com** (network panel), and `dashboard.html` contains no API key.
- Row counts per dataset on the page equal the sheet's (excluding header) for one full run.
- Killing one step (e.g. a forced Smartico failure) still updates every other dataset. The page shows that step red with its failure time, and one Telegram message arrives.
- A dataset older than its threshold shows amber/red on the page within one load.
- Relay ingest rejects:
  - a bad signature (401)
  - a replayed nonce (401)
  - an unknown key (400)
  - the wrong header set (400)
  - an oversize body (413)
- A report-only account gets 403 on `/api/ops/*`.
- Task Scheduler history shows a non-zero result when a step fails.

## Verification

- Unit tests (`node --test`), with real handlers rather than mocks of our own logic:
  - ops-store: validation, atomic write, keep-last-good-on-failure
  - route tests: auth, 400/401/403/413, GET shape
- Local end-to-end: dev server + `push-ops-dataset.mjs` against `localhost`, then load `/dashboard`. Confirm no googleapis requests and identical counts to the sheet.
- Runner dry-run mode (`--dry-run`: echo steps, no writes), plus a forced-failure test step.
- Shadow-mode diff log for 3 days before the flip.

## Safety constraints

- Server writes go only to `data/ops/`, with no path built from request input except the allow-listed key.
- Nothing on the server writes to Google; the VDI's sheet writes are unchanged.
- The relay secret is unchanged and never logged. The push client sends only to `QC_HUB_URL`.
- No BO/promo mutation anywhere in this work.
- Rollback: revert the page commit. The page goes back to reading Google (needs the `strict-origin` fix, already live), and the server endpoints can stay.

## Dependencies / who

- **Hosting team (Tommy):** deploy the server change, persist `data/ops/`, restart. No new secrets are needed on the server for phases 1–3.
- **Jascinta:** approve this plan; answer the open questions; approve the flip after shadow mode.

## Decisions (Jascinta, 2026-10-07)

1. Telegram alerts go to **Jascinta's DM** only.
2. Staleness thresholds: **amber 2 days, red 4 days** for every dataset.
3. "VDI never ran" detection: **the page's red staleness warning only** — no server-side alarm, no external monitor.

## Estimate

- Phases 1–3: about 1.5–2 days of build and test.
- Shadow mode: 3 days elapsed.
- Flip: depends on the hosting team's restart window.
