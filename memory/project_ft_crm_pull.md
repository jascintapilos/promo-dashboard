---
name: project-ft-crm-pull
description: FastTrack CRM pull — pull-ft-campaigns.mjs appends YTD activities/segments to CRM Assignment Log after Smartico rows
metadata: 
  node_type: memory
  type: project
  originSessionId: 648c60e5-e96e-4acd-850a-6de4e5d37482
---

`bin/pull-ft-campaigns.mjs --instance=ws1|qpro1|qp2 [--write]` pulls YTD FastTrack CRM data into 'CRM Assignment Log' tab, appended AFTER Smartico rows (Smartico clears+writes first, FT appends).

**API mechanism**: `authtoken: <portaltoken>` header (custom header — NOT `Authorization: Bearer`). The `portaltoken` cookie value is the auth token. Confirmed from Playwright network intercept.

**Data source**: `POST /crm-api/ActivityManager/Activities/GetActivities` with body `{archived:false, activityTypeId:1}`. Filter by `SignedDate >= current year`. Cross-reference with `GET /crm-api/ActivityManager/Segments/ByCategory/1` for segment names.

**Creator attribution**: `GET /crm-api/Changelog/Entity/activity/{activityId}` returns `[{userId, operationType, timestamp, ...}]` newest-first. Find the `create` entry (or oldest entry) for the creator. Discovered via Chrome DevTools intercept — endpoint not listed in Swagger/docs. Wired into pull-ft-campaigns.mjs as primary source; SignedBy is fallback.

**Deleted/unknown user override**: `DELETED_USER_NAMES` map at top of pull-ft-campaigns.mjs. User 71 = deleted AlphaIota BPO account, identity unknown. Update once confirmed with Wai Yip.

**WS1 date field**: WS1 stopped using QA sign-off (SignedDate) after Feb 2026. Use `ExecutionDateTime` as fallback. Script updated: `const date = a.SignedDate || a.ExecutionDateTime`.

**WS1 creator handoff**: Jan–Apr 2026 = TBP team (Elyssa 217, Alysa 141, Boon Inn 33 = 391 team rows). May–Jun 2026 = Mimi (Seahub Asia, id=166) took over WS1 CRM — 0 TBP team rows from May onwards.

**Sessions**: `ft-session-{ws1|qpro1|qp2}.local.json` — expire ~8 hours after capture.

**WS1 ONLY — use browser relay**: VDI IP is Cloudflare-blocked for ALL `*.ft-crm.com` domains. `capture-ft-sessions-all.bat` (Playwright headless) fails at navigation. GAS relay also fails — FT binds `portaltoken` to originating IP; Google server IP is rejected with "nil from database" even with a valid token. **Correct approach for WS1**: log in via AdsPower browser (bypasses Cloudflare via residential proxy), then run `node bin/pull-ft-via-browser.mjs --instance=ws1 --write`. This uses Playwright `connectOverCDP` to `ws://127.0.0.1:53845/devtools/browser/...` (SunBrowser, AdsPower's Chrome), injects the FT API calls into the active FT tab, and reads results back via CDP. **No session file needed** — the browser already has the valid session cookie.

**Session capture (non-WS1)**: `bin/capture-ft-session.mjs --instance=qpro1|qp2`. Uses Playwright `channel:chrome` for WorkOS bot detection bypass. Waits for URL to leave /login/ before capturing cookies.

**Instances** (YTD 2026 team rows):
- `ws1` → `https://mb8.ft-crm.com` — WS1/WS2 brand MB8; 437 rows (Jan–Apr team, May+ Mimi)
- `qpro1` → `https://alpha-iota-qp1.ft-crm.com` — QPRO1; 231 rows
- `qp2` → `https://alpha-iota-qp2.ft-crm.com/v2` — QP2A-D; 750 rows

**BASE URL**: always use `new URL(session.loginUrl).origin` — NOT `session.loginUrl.replace(/\/$/, '')` (QP2 has `/v2/` in loginUrl which breaks API paths).

**QP2 creators via changelog (2026)**: Shu Minn (54 activities), Esther (47), Jeevaan (6) — Seahub/AlphaIota BPO staff.

**Team IDs in FT AdminUsers** (TBP team at thebrandingpeople.co):
- 138 Michelle, 139 Jascinta, 140 Wai Yip, 141 Alysa, 142 Elyssa, 157 Boon Inn, 160 Abigail
- Old AlphaIota BPO accounts still active: 93=Jascinta, 95=Elyssa, 125=Alysa, 76=WY(Wai Yip?)

**WS1 portaltoken**: Only 16 chars (opaque session ID, not a JWT). Still valid — the API accepts it fine. Short token ≠ expired. If API returns 0 activities/users, the session is server-side expired and needs re-capture. The localStorage `jwttoken` (7268 chars) is NOT the right auth token for API calls.

**Region extraction**: Two-stage:
1. `extractRegion()` parses segment/activity name — handles `MBMY*`/`MBSG*` (WS1), `QPMY*`/`QPSG*` (QPRO), `QP2AMY*` (QP2) via embedded pattern. `MB` prefix added alongside QP/WS/BP.
2. Fallback: `POST /crm-api/ActivityManager/Segments/GetSelective` with body `[segmentId, ...]` returns `{SegmentFilter: "<json>"}` containing `user_details-currency` rules. Parse this to get MYR/SGD/IDR/THB/KHR → MY/SG/ID/TH/KH. Only called for segments where name parsing fails. Verified 0 empty-region rows after fix (2026-06-17).

**Sheet write**: uses `spreadsheets.values.append` (INSERT_ROWS) — auto-extends grid. Do NOT use `values.update` with explicit row — hits grid limit when sheet is at max rows.

**Changelog parallelization**: batches of 20 concurrent calls; 1322 QP2 calls complete in ~1.5 min (was 10+ min serial). Progress logged every 20 items.

**Nightly bat**: Steps [1-10/10] (fixed labels) — runs after Smartico step [7/10]; FT appends after existing rows. If session expired, prints warning and exits gracefully.

**Helper bat**: `bin/capture-ft-sessions-all.bat` — runs all 3 captures sequentially with instructions. WS1 uses Google SSO → WorkOS MFA flow.
