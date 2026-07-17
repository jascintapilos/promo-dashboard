# Promo Code QC Dashboard — Design Proposal

Date: 2026-07-17
Author: Claude (for Wai Yip / Promo Team)
Status: DRAFT — awaiting approval before development (dev to be delegated to Codex)
Advisor review: **APPROVE WITH IMPROVEMENTS** (2026-07-17) — improvements folded in below; §1 read-only wrapper and §5 UI-only brand config are Codex acceptance criteria.

---

## 0. Executive summary

Build an **official hosted web app** ("QC Hub") — a Node.js server on an internal/company-controlled host, reachable over HTTPS, with **sign-in restricted to admitted work emails** (Google Workspace OAuth on `thebrandingpeople.co` + an explicit allowlist). The server connects **directly to the BO APIs** and reuses the existing `promo-automation` modules server-side. The core interaction is one click: **Run QC** pulls live BO data, runs every automated check, and returns a **mechanics summary plus a lead verdict** (SAFE TO APPROVE — PASS / NOT SAFE — FAIL) before any detail table:

- **Fetch layer**: `src/api-client.js` (QPRO/QP2) and `src/igmp-client.js` (WS1/WS2 — full scope, not deferred), dispatched via the platform branching already encapsulated in `src/live-codes.js`. Coverage: 17 QPRO brands, 4 QP2 merchants, and all 6 IGMP sites (WS1 MY/SG/ID/TH/KH + WS2).
- **Brand registry**: `bo-sites.json` + `src/ingest.js` `BRAND_TO_SITE` + `data/brand-directory.json` — no new brand data entry needed; a thin `data/qc-dashboard-brands.json` adds UI ordering, deep links, and per-brand rule overrides.
- **Automated checks**: `src/structural-checks.js`, `src/mt-content-checks.js`, `src/campaign-checks.js` (pure functions returning `[{severity, check, message}]`) plus `src/qc-mt-tnc.js` (an async live BO probe, run server-side) — rendered as pre-filled checklist hints.
- **QC record persistence**: new `Manual QC Log` tab on the PromoOps Data sheet via the `src/qc-results-log.js` / `src/sheets-client.js` pattern (OAuth already configured), with local JSONL fallback when Sheets is unreachable.

The dashboard is **strictly read-only toward the BO**: the server exposes only GET/list fetch functions; no promotion PUT/POST route exists in the server at all.

---

## 1. Recommended technical solution

### Option analysis

| Option | Verdict | Reason |
|---|---|---|
| **Hosted Node web app (recommended)** | ✅ | Reuses all existing ES modules and `*.local.json` credential files as-is on the server. Zero porting cost for the QC check libraries. Same runtime as canary/brand-watch, so fixes propagate. Team-wide access behind work-email sign-in. |
| Google Apps Script web app | ❌ for fetch | Cannot reuse the Node clients (AES-encrypted login, session cache, IGMP Playwright cookie capture). Would mean rewriting ~4,000 lines of battle-tested client/check code in Apps Script and storing BO secrets in Script Properties. Fine as a *viewer* later, not as the engine. |
| Google Sheet + Apps Script interface | ❌ | Same as above, plus poor UX for a fetch-and-compare workflow. |
| Browser extension | ❌ | Ships secrets to the browser, per-BO DOM scraping is brittle, and each BO UI change breaks it. |
| Claude-assisted automation interface | Partial | Already exists (`/deep-qc`, `/pre-qc`, promo-troubleshoot skill). The dashboard complements it for fast human QC; the skills remain for deep audits. |

### Architecture

```
Browser (HTTPS, after work-email     Node server (qc-hub, internal host)
Google sign-in)                      ┌────────────────────────────────────────┐
┌──────────────────────────┐         │ Auth: Google OAuth (workspace domain    │
│ Single-page UI            │ fetch()│  restriction + admitted-email allowlist,│
│ - brand buttons           │───────▶│  signed session cookie; every /api/*    │
│ - promo code input        │        │  route requires a session)              │
│ - RUN QC button           │        │ GET /api/brands                         │
│ - verdict + mechanics     │        │ POST /api/run-qc {brand, code}          │──▶ api-client.js / igmp-client.js
│   summary                 │        │   → live BO fetch + all auto checks     │      (read-only wrapped transport,
│ - details panel + flags   │        │   → {verdict, mechanics, findings,      │       session cache, auto-relogin)
│ - checklist (auto-filled) │        │      details, checklist}                │
│ - result + error form     │        │ POST /api/qc-record                     │──▶ Manual QC Log tab (Sheets OAuth)
│ - history + metrics       │        │ GET /api/history?filters…               │      + captures/qc-dashboard/*.jsonl
│ - Fix with Claude button  │        │ POST /api/fix-request                   │──▶ captures/qc-dashboard/fix-requests/
└──────────────────────────┘         └────────────────────────────────────────┘      (task file consumed by Claude
                                                                                      pipeline — NOT a direct BO write)
```

- **Fix with Claude**: every critical finding carries a "🤖 Fix with Claude" button. Clicking it does **not** write to the BO — it packages the finding (brand, code, field, expected vs actual, snapshot path) into a fix-request task that the existing Claude automation pipeline (canary tooling + its confirmation gates) picks up, amends, and then flags for **Recheck After Amendment** in the hub. QC checking and promo amendment stay separated: the dashboard's own BO transport remains read-only; amendments run only through the already-gated pipeline.

- **Hosting**: an internal VM / office server (or IP-restricted VPS) that only the company network / VPN can reach, HTTPS via reverse proxy. BO credentials (`bo-sites.json`, `*.local.json`) live only on that host, never in the browser.
- **Login**: Google Sign-In (OAuth) — accepts only `@thebrandingpeople.co` accounts that also appear in an `admitted-users.json` allowlist. No passwords stored; identity from the Google token becomes the QC record's "Checked By".
- **Run QC** is the primary action: one click → live BO pull → auto-checks → lead verdict ("✅ SAFE TO APPROVE — PASS" / "❌ NOT SAFE — FAIL · n findings") + one-line mechanics summary (type, reward %, max bonus, min dep, TO, claim limits, validity, game scope, MT presence) + findings list. The checklist below it is auto-filled from the findings; the QC person only adjusts and confirms.
- Every BO fetch result is snapshotted to `captures/qc-dashboard/fetches/<brand>__<code>__<ts>.json` — audit trail + "cached data" banner support.
- **Read-only guarantee (structural, per advisor review — acceptance criterion #1)**: import-name filtering is NOT sufficient (`addPromotionName`, `authedFetch`, and `igmpPost` all evade it). Instead:
  - QPRO/QP2: the dashboard gets a **wrapped client** whose transport layer rejects any non-GET HTTP method (except the login call) before it leaves the process.
  - IGMP: reads are POSTs, so method filtering can't work — the wrapper enforces an **explicit endpoint allowlist** (`/PM/Get*`, `/VIM/Get*` only); anything else throws.
  - No write helper is imported anywhere in `src/qc-dashboard/`; this is a code-review convention, not the safety mechanism.

### Relationship to the stakeholder dashboard

**Descoped 2026-07-17**: stakeholder access will not be provided (user decision). The design follows the user-flow spec directly; Phase 1 discovery is considered complete on the basis of the repo/environment review.

---

## 2. Proposed wireframe (sections)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ① HEADER   Promo QC Hub                    🔒 signed-in work email      │
├────────────────────────────────────────────────────────────────────────┤
│ ② BRAND SELECT   [QP2A][QP2B][QP2C][QP2D] [QPRO1]…[QPRO10][QPRO15/16] │
│                  [WS1 MY][WS1 SG][WS1 ID][WS1 TH][WS1 KH][WS2]          │
│    (displayed set driven by qc-dashboard-brands.json order)             │
│    selected brand highlighted; region + BO shown under each button      │
├────────────────────────────────────────────────────────────────────────┤
│ ③ PROMO SEARCH   [Code 1][Code 2][Code 3][Code 4][Code 5]             │
│    [Search/Load] [Clear] [Open Brand BO ↗] [Open Promo Module ↗]       │
│    validation line: brand selected? code non-empty? format ok?          │
│    duplicate warning: "already QC'd today by …" / "code exists on N BOs"│
├────────────────────────────────────────────────────────────────────────┤
│ ③b RUN QC   [▶ RUN QC (n codes)] → per-code pills: CODE1 FAIL ·        │
│    CODE2 PASS · CODE3 REVIEW (click pill = switch active code)          │
│    active code: ❌ NOT SAFE TO APPROVE — FAIL · mechanics + findings    │
│    each critical finding: [🤖 Fix with Claude] → dispatches fix task    │
├────────────────────────────────────────────────────────────────────────┤
│ ④ PROMO DETAILS (batch table — one row per code)                       │
│   Code·Name·Type·Currency·MinDep·MaxBonus·TO·Reward·Lifetime·Daily·    │
│   Validity·Recurring·Members·Games·Inbox·Status·By·Updated              │
│   flagged values as chips in-cell · horizontal scroll · stale banner    │
│   — checklist section removed 2026-07-17: auto-findings are the        │
│     verdict source; disagreements go via error form                     │
├────────────────────────────────────────────────────────────────────────┤
│ ⑥ ERROR & REMARKS  (required when Fail / Requires Review)              │
│   category ▾ · description · expected · actual · action · person       │
├────────────────────────────────────────────────────────────────────────┤
│ ⑦ RESULT   [PASS] [FAIL] [REQUIRES REVIEW] [RECHECK AFTER AMENDMENT]   │
│   confirm modal before save · [Save] [Copy QC Summary] [Reset]         │
├────────────────────────────────────────────────────────────────────────┤
│ ⑧ RECENT QC HISTORY (filterable table, last 50)                        │
│ ⑨ METRICS  pass rate · errors by category/brand · common issue · time  │
└────────────────────────────────────────────────────────────────────────┘
```

An interactive HTML mockup accompanies this proposal.

**Typography (per user direction, 2026-07-17):** **Inter** is the primary dashboard font, self-hosted (no CDN). Clean, compact, strong hierarchy, high readability: **SemiBold (600)** for headings and key data, **Medium (500)** for buttons, **Regular (400)** for body text. No decorative fonts. Promo codes stay monospace so lookalike characters (O/0, I/1) can't be misread. **Player-facing previews** (inbox MT / dialog popup render panes) use the actual brand website's font when available (resolvable per brand via `data/brand-directory.json` + a per-brand font entry in `qc-dashboard-brands.json`), falling back to Inter. Chrome is caption-light: no explanatory helper text, no summary metric tiles in the header — metrics live only in the history/metrics section.

---

## 3. User flow

1. **Select brand** → button highlights; BO/module link targets resolve from config; region + platform shown.
2. **Enter codes** → **five separate text boxes, one code per box** (empty boxes skipped); client validates each (`^[A-Z0-9_]{3,40}$`, uppercased on paste); server warns per code if brand+code already has a QC record in the last 24 h and reports which other BOs also carry it (duplicate-across-brands probe).
3. **Search/Load** → server: `findPromotionByCode` → `getPromotionDetail` (+ promotioncurrency, promotionname, message-template body, dialog popup presence). On failure: clear error state ("code not found on QPRO5", "BO unreachable — retry or use Open BO link"), attempt logged to `captures/qc-dashboard/failed-fetches.jsonl`.
4. **Run QC (one click, whole batch)** → server pulls live BO data for all entered codes **in parallel** and runs every automated check per code; one code failing to fetch never kills the batch. Each code gets a verdict pill (PASS/FAIL/REVIEW); the active code shows verdict-first: **"✅ SAFE TO APPROVE — PASS"** or **"❌ NOT SAFE — FAIL · n findings"**, then the mechanics one-liner and findings list. Checks: expired-while-active, missing currency, category-without-provider, foreign-domain leak in MT, seasonal-token leak, wrong T&C hyperlink, claim-limit sanity, duplicate-across-brands.
5. **Review details** → field grid with status chips for the active code; per-code pills switch between the up-to-5 codes in the batch. (Checklist section removed 2026-07-17 — auto-findings drive the verdict; human disagreement goes through the error form.)
6. **Pick result (per code)** → PASS is **blocked** if any required field failed to load or any critical finding is unresolved ("do not pass on missing data" rule). FAIL / Requires Review require category + description + expected + actual + action. **Save All** commits one record per code once each verdict is resolved.
7. **Save** → confirmation modal → row appended to Manual QC Log; plain-text QC summary copied on demand (no Slack integration); form resets; history/metrics refresh.
8. **Fix with Claude** → one click dispatches a fix-request (brand, code, field, expected/actual, evidence snapshot) to the Claude automation pipeline. Available in three places: on each critical Run-QC finding, in the error & remarks panel (for manually-found issues), and on FAIL/REVIEW rows in QC history. The pipeline applies the amendment through its existing confirmation gates, then the hub prompts **Recheck After Amendment**.
9. **Recheck flow** → history rows with FAIL/RR expose a "Recheck" action that reloads the code fresh and links the new record to the original (`recheck_of` column).

---

## 4. Required data sources

| Data | Source | Access status |
|---|---|---|
| Promo config (QPRO/QP2) | BO REST API via `src/api-client.js` | ✅ working (canary/brand-watch use it daily) |
| Promo config (WS1/WS2) | IGMP API via `src/igmp-client.js` (`GetPromotionInfoByCode` → `GetBonusInfo`/`GetFreeCreditInfo`/`GetFreeSpinPromotionInfo` + `GetPromotionRewardContents`) | ✅ working; cookie sessions need periodic capture (`bin/refresh-igmp-sessions.mjs` / keepalive already exist) — dashboard shows a clear "session expired, recapture needed" state |
| Inbox/CRM content | `/messagetemplate` (QPRO/QP2), `GetPromotionRewardContents` (IGMP) | ✅ |
| Brand registry | `bo-sites.json`, `src/ingest.js`, `data/brand-directory.json` | ✅ |
| Request-vs-BO comparison (Phase 3) | Promo request sheet via `src/sheets-client.js` | ✅ OAuth configured |
| QC record store | PromoOps Data sheet, new `Manual QC Log` tab | ✅ OAuth configured; tab to be created |
| Stakeholder dashboard reference | **unknown — need URL/access from stakeholder** | ❌ gating item |
| `created_by` / audit fields | Present in QPRO/QP2 detail payloads; confirm exact field names during MVP | ⚠ verify |

## 5. Brand configuration structure

New file `data/qc-dashboard-brands.json` (UI layer only — connection data stays in `bo-sites.json`):

**UI-layer fields only** (advisor acceptance criterion #2 — the repo already has four brand registries; this file must not become a fifth source of platform/site/region truth):

```json
{
  "brands": [
    {
      "id": "QPRO1",
      "label": "QPRO1",
      "displayGroup": "QPRO",
      "order": 5,
      "promoModulePath": "/promotion",
      "qcRules": { "extraChecks": [] }
    }
  ]
}
```

- `platform` / `siteId` / `merchantId` / `region` / `currencies` resolve at runtime from `src/live-codes.js` `brandToSite()` + `bo-sites.json` — never duplicated here.
- **Fail-loud startup cross-validation**: boot fails if this file references a brand `brandToSite()` can't resolve, or a resolvable brand is missing from this file.
- No credentials in this file. Adding a brand = one JSON entry (plus `bo-sites.json` entry if it's a new BO).
- `qcRules` carries only brand-specific *check overrides* (e.g. QPRO5+ has no SG region → missing SGD is *not* a flag; QP2 max_total blank = Unlimited, not missing).

## 6. QC log structure (`Manual QC Log` tab)

| Column | Notes |
|---|---|
| Timestamp | ISO, Asia/KL |
| Promo Code / Brand / Platform / Region | |
| Promo Type | normalized bonus type |
| QC Result | PASS / FAIL / REQUIRES_REVIEW / RECHECK_PASS / RECHECK_FAIL |
| Checked By | work email from the Google sign-in session |
| Findings JSON | compact auto-check results for the code (checklist removed 2026-07-17) |
| Error Category / Description / Expected / Actual / Action Required / Person Responsible | required on FAIL/RR |
| Amendment Status / Recheck Status / Recheck Of | recheck linkage |
| Evidence Link | optional URL |
| BO Link | deep link used |
| Fetch Snapshot | path to captured JSON |
| Duration (s) | search→save, feeds avg-QC-time metric |

**Persistence hardening (advisor design notes):**
- Every record gets a **UUID** column; write order is **JSONL first, then sheet**, with a replayed-marker so replay after a partial Sheets failure is idempotent (no double-appended rows corrupting pass-rate metrics).
- The 24 h duplicate-QC probe reads the **local JSONL mirror**, not the sheet (no per-keystroke Sheets latency/quota).
- **Metrics boundary**: Manual QC Log rows are *human* QC and are **excluded** from the automated monitoring pass-rate metrics fed by the existing `QC Results Log` tab; column naming mirrors that tab so a future join is possible. This is documented before the tab is created.

## 7. MVP development plan (Phase 2)

Brands: **QP2A, QPRO1, QPRO5, WS1 MY** (covers all three platform families — token-login REST, no-SG QPRO for rule-override testing, and the cookie-session IGMP path — so nothing structural is left unproven for the Phase 3 fan-out to the remaining brands).

1. `bin/qc-dashboard.mjs` — HTTPS-fronted HTTP server, static UI, `/api/brands`, `/api/run-qc`, `/api/qc-record`, `/api/history`; **Google Sign-In auth** (workspace-domain restriction + `admitted-users.json` allowlist, signed session cookie) guarding every route.
2. `src/qc-dashboard/fetch-promo.js` — read-only dispatcher wrapping `findPromotionByCode` + `getPromotionDetail` + MT/dialog presence; normalizes to the §2 field list; snapshot capture.
3. `src/qc-dashboard/auto-checks.js` — adapter running the four existing check libraries over each fetched record → per-field flags + findings feeding the verdict engine.
4. `public/` — **no-build static UI**: 3–5 files (HTML + native ES-module JS + CSS), no framework, no build step. History/metrics aggregation happens server-side (`/api/history` returns pre-aggregated data) so the client stays a thin renderer through Phase 3.
5. `src/qc-dashboard/qc-log.js` — Manual QC Log writer (sheet + JSONL fallback), duplicate-QC probe, history reader.
6. Run-QC verdict engine — aggregates all finding severities into the lead verdict (any FAIL finding or missing required data ⇒ NOT SAFE) + builds the one-line mechanics summary; plain-text Copy QC Summary (no Slack integration).
7. `POST /api/fix-request` — writes the fix-task file (finding context + snapshot path) for the Claude pipeline; hub-side status chip (Dispatched → Amended → Recheck due). MVP scope is dispatch + status only; the amendment itself runs through the existing gated canary tooling.
8. `.claude/launch.json` entry so the dashboard can be started/verified via the preview browser.

Estimated: ~2–3 dev sessions via Codex, each ending with a working verifiable increment.

## 8. Risks and limitations

- **Server credential custody**: BO credentials and OAuth tokens move from the personal VDI to a shared host. That host must be network-restricted (company network/VPN or IP allowlist), disk-access-restricted, and is the single place secrets live. A compromised admitted account can *read* promo configs but cannot write to the BO (read-only transport) — still, the allowlist should stay short.
- **Hosting target undecided**: internal VM vs IP-restricted VPS affects setup effort and who administers it — decision needed before build (see §10).
- **IGMP sessions expire** (cookie-based); WS1/WS2 are in scope from MVP, so the existing keepalive/capture scripts (`bin/igmp-keepalive.mjs`, `bin/refresh-igmp-sessions.mjs`) become an operating prerequisite. The dashboard must degrade gracefully: expired session → explicit "recapture session" message, never a silent empty result.
- **BO API drift**: undocumented endpoints (e.g. exact-code filter) may change; snapshot + graceful-degradation banner mitigates.
- **`created_by`/audit fields** may be absent on some platforms → shown as "not available", never blocks QC.
- **Sheets quota/outage** → JSONL fallback + replay; record never lost.
- **Scope creep risk**: request-vs-BO comparison, metrics filters, and access controls intentionally deferred to Phase 3.
- **Stakeholder dashboard unseen (accepted)**: access won't be provided; workflow may diverge from what the stakeholder's users know. UI is sectioned so reordering is cheap if feedback arrives later.

## 9. Test cases (Phase 4)

Valid code (each platform) · invalid format · code not found · wrong brand selected (code exists on another BO — dashboard should say where) · duplicate code across brands · missing required data (PASS must be blocked) · expired promo still active (auto-flag) · wrong currency for brand region · lifetime/daily claim mismatch vs request · BO unreachable (login refused / timeout — graceful error + logged attempt) · Sheets write failure (JSONL fallback + replay) · double-submit same code within 24 h (warning) · recheck flow links to original record · Slack summary matches saved record.

## 10. Information / access still required before development

1. ~~Stakeholder dashboard access~~ — **descoped 2026-07-17**, proceeding without it.
2. **QC source of truth confirmation**: is the request tracker sheet the authoritative "expected values" source for Phase 3 request-vs-BO comparison?
3. **Hosting target**: which internal VM / server should run the hub (or approval to provision an IP-restricted VPS)? Must be reachable by the team and able to reach the BO hosts.
4. **Google OAuth web client**: approval to create a web-app OAuth client in the existing GCP project (`promo-bot-496510`) for the sign-in flow, and the initial **admitted-emails list**.
5. **Promo code module deep links**: confirm the per-platform BO path to land directly on the promo module (QPRO 3.2 vs QP2 equivalent) — resolvable during MVP from existing BO knowledge.
6. **PromoOps Data sheet**: approval to add the `Manual QC Log` tab.

## 11. Implementation steps

1. Approval of this proposal (+ strategic-design-advisor review). ✅ Advisor: APPROVE WITH IMPROVEMENTS, folded in.
2. Phase 1 discovery. ✅ Complete (repo/environment review; stakeholder dashboard descoped).
3. Codex builds MVP per §7 (Claude runs `codex exec`, per delegation workflow). MVP is **host-agnostic**: it runs locally first for acceptance; the hosting decision (§10) only affects deployment, not development.
4. Verify end-to-end on QP2A/QPRO1/QPRO5 with live read-only fetches.
5. User acceptance with real QC session; iterate.
6. Phase 3 expansion (remaining QPRO/QP2 brands + remaining WS1 regions and WS2, brand rules, request-vs-BO comparison, metrics filters, recheck workflow, access controls).
7. Phase 4 test matrix run; document in `docs/`.
