---
name: project-smartico-crm-pull
description: Smartico CRM campaign pull — bin/pull-smartico-campaigns.mjs writes YTD 2026 scheduled campaigns to CRM Assignment Log tab
metadata: 
  node_type: memory
  type: project
  originSessionId: 648c60e5-e96e-4acd-850a-6de4e5d37482
---

`bin/pull-smartico-campaigns.mjs` pulls YTD team segments from `j_segment` into the Weekly Report sheet's 'CRM Assignment Log' tab.

**Columns**: Date | Brand | Region | CRM Tool | Segment Name | Created By

**Data sources**: `j_segment` (737 YTD rows) + `j_audience_scheduled` (748 YTD team rows — Scheduled Campaigns created by Alysa/Wen/Elyssa/Bangun/Gaby). TOTAL: 1485 YTD rows as of 2026-06-26.

**CRITICAL API NOTE — j_audience_scheduled list endpoint is broken**: The react-admin style endpoint (`_start/_end/_sort/_order`) ignores all parameters and ALWAYS returns the same 1000 oldest records. All team entries are NEW (Apr–Jun 2026) and were completely invisible.
**FIX**: Use SPA API format: `filter=JSON&range=[0,999]&sort=["create_date","DESC"]&lbl=24016`. `listSPAAll(resource, filter, year)` in smartico-client.js wraps this with correct pagination. Confirmed working — returns Alysa@enigma's June 2026 campaigns.

The promo team creates BOTH Segments (j_segment) AND Scheduled Campaigns (j_audience_scheduled). The CRM automation team (SM@enigma, kaiwen@enigma, etc.) ALSO creates Scheduled Campaigns — they're filtered out by the TEAM username set. Filter: team usernames + create_date ≥ 2026-01-01.

**Team usernames in Smartico**:
- `Alysa@enigma` → Alysa (268 YTD segments)
- `Booninn@enigma` → Wen (132 YTD segments)
- `Elyssa@enigma` → Elyssa (34 YTD segments)
- `Bangun@enigma` → Bangun (0 so far)
- `Gabrielle@enigma` → Gaby (0 so far)
- `Jascinta@enigma` → Jascinta (0 so far)
- `Waiyip@enigma` → Wai Yip (TL, tracked but not utilisation)

**Non-team creators in j_segment**: SM@enigma (226), claudia@enigma (127), jeevaan@enigma (26), ryan@enigma (15) — excluded.

**API pagination**: `j_audience_scheduled` listAll() causes infinite loop (API ignores _end). Use `list()` with `_end: 10000` for one-shot. Same applies to `j_segment`.

**List API caps at 1000 records** (oldest IDs ASC). Newer segments missed — needs scan beyond list. Scan via `client.scanBeyondList(listMaxId+1, {consecutiveMissThreshold})` (parallel 10x concurrent).

**SCAN STATE FILE IS ADVISORY ONLY** (`smartico-scan-state.local.json`) — always scan from `listMaxId+1`, never skip based on saved state. Reason: pull CLEARS the tab before writing, so any previously-scanned segments not re-scanned this run are LOST. Default miss threshold 1500.

**Safety guards** (added 2026-06-22): pull aborts (exit 3) before clearing tab if dataRows.length == 0 OR if new pull < 50% of existing Smartico-only rows. `--force` overrides.

**Token**: `smartico-session.local.json`. Re-run `bin/capture-smartico-session.mjs` if 401. Token expiry returns HTTP 200 `{"errCode":3}` not 401 — `smartico-client.js` detects this and throws.

**Auto-login**: `bin/capture-smartico-session.mjs` runs headless Playwright + TOTP 2FA (±1 window tolerance). Credentials in `smartico-creds.local.json` (set up via `bin/setup-smartico-creds.mjs`). TOTP secret extracted from Google Authenticator QR export via `bin/decode-ga-export.mjs`. Nightly bat runs capture THEN pull in step [6/11].

**Nightly bat**: Steps [6/11]+[6b/11] in `bin/nightly-pull.bat` — capture session first, then pull. Steps 8-10 = FT WS1/QPRO1/QP2 appended after.

**Region extraction**: segment_name first (MYS/MY/SGP/SG etc.), then conditions_readable currency (MYR→MY etc.).
