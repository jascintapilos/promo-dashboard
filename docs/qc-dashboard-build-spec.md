# QC Hub — MVP Build Spec (for Codex)

Read `docs/promo-qc-dashboard-proposal.md` first for full context. This file is the binding acceptance list.

## Deliverables

1. `bin/qc-dashboard.mjs` — Node HTTP server (ESM, Node built-ins preferred; reuse deps already in package.json — do NOT add new npm deps unless unavoidable).
   Routes (all under auth, JSON):
   - `GET /api/brands` — UI brand list joined with runtime resolution (see §Brand config).
   - `POST /api/run-qc` `{brand, codes: string[]}` — **up to 5 codes per run**, fetched and checked in parallel (Promise.allSettled; one code failing must not kill the batch) → `{results: [{code, verdict, mechanics, findings[], details}]}`. Reject >5 codes with a clear 400.
   - `POST /api/qc-record` — save QC record (JSONL first, then Sheets; see §Persistence).
   - `GET /api/history?brand=&result=&from=&to=` — server-side filtered/aggregated history from the JSONL mirror.
   - `POST /api/fix-request` — write a fix-task JSON file to `captures/qc-dashboard/fix-requests/<uuid>.json` containing {brand, code, finding, expected, actual, snapshotPath, requestedBy, ts}. NO BO write.
   - Static file serving for `public/qc-hub/`.

2. **Auth**: Google Sign-In (verify Google ID token server-side, no new heavy deps — use Google's tokeninfo endpoint via fetch), restricted to emails in `admitted-users.json` (gitignored; create `admitted-users.example.json`). Signed session cookie (HMAC, secret from env/local file). `AUTH_MODE=dev` env: localhost-only bypass that signs in as `DEV_USER_EMAIL` — for acceptance testing until the OAuth client exists. Every /api/* route 401s without a session.

3. **Read-only transport (ACCEPTANCE CRITERION — advisor blocker #1)**:
   - New `src/qc-dashboard/readonly-client.js` wrapping `src/api-client.js`: expose only what the hub needs; the underlying fetch layer must REJECT any non-GET request (except the login endpoint) — enforce at the transport wrapper, not by import names.
   - IGMP: wrap `src/igmp-client.js` `igmpPost` with an explicit endpoint allowlist — only paths matching `^/PM/Get` or `^/VIM/Get` pass; anything else throws.
   - Unit tests (node:test) proving: PUT/POST to promotion endpoints throws; `/PM/AddBonus` throws; `/PM/GetPromotionInfoByCode` passes.

4. **Brand config (ACCEPTANCE CRITERION — advisor blocker #2)**:
   - `data/qc-dashboard-brands.json` — UI-ONLY fields: `id`, `label`, `displayGroup`, `order`, `promoModulePath`, `qcRules`. NO platform/siteId/region/currencies.
   - Runtime resolution via `src/live-codes.js` `brandToSite()` + `src/sites.js`.
   - Fail-loud startup cross-validation both directions (JSON brand unresolvable → boot fails; resolvable brand missing from JSON → boot fails, listing the missing ids).
   - MVP fetch-enabled brands: QP2A, QPRO1, QPRO5, WS1 MY. Grid shows the full configured set; non-MVP brands render disabled with a "coming soon" state.

5. **Fetch + checks** `src/qc-dashboard/fetch-promo.js` + `auto-checks.js`:
   - QPRO/QP2: `findPromotionByCode` → `getPromotionDetail` (+ promotionname, MT body presence, dialog popup presence) through the readonly client.
   - IGMP: `GetPromotionInfoByCode` → `GetBonusInfo`/`GetFreeCreditInfo`/`GetFreeSpinPromotionInfo` + `GetPromotionRewardContents` through the allowlisted wrapper.
   - Normalize to the field list in proposal §2 (promo name, type, currency, min dep, max bonus, TO, reward, lifetime/daily claim, validity, recurring, eligibility, games/providers, inbox content presence, status, created by/date, last updated). Missing fields → explicit `"unavailable"`, never blank.
   - Snapshot every fetch to `captures/qc-dashboard/fetches/<brand>__<code>__<ts>.json`; failed fetches appended to `captures/qc-dashboard/failed-fetches.jsonl`.
   - Auto-checks: run `src/structural-checks.js`, `src/mt-content-checks.js`, `src/campaign-checks.js` where inputs are available; plus expired-while-active, missing-currency, category-without-provider, duplicate-across-brands (probe the other MVP brands via findPromotionByCode / GetPromotionInfoByCode).
   - Verdict engine: any FAIL finding OR any required field unavailable ⇒ `NOT_SAFE` (never PASS on missing data); else WARNINGs ⇒ `REVIEW`; else `SAFE`. Mechanics one-liner assembled from normalized fields.

6. **Persistence** `src/qc-dashboard/qc-log.js`:
   - Record schema per proposal §6 incl. `uuid`, `recheck_of`, `duration_s`.
   - Write order: append to `captures/qc-dashboard/qc-log.jsonl` FIRST, then upsert to `Manual QC Log` tab on the PromoOps Data sheet (pattern: `src/qc-results-log.js`, sheet id via `src/ops-sheet.js`, auth via `src/google-auth.js`). Sheet failure → mark record `sheet_pending`; replay is idempotent by uuid.
   - Duplicate-QC probe (same brand+code < 24h) reads the JSONL mirror only.

7. **UI** `public/qc-hub/` — 3–5 static files (index.html + app.js as native ES module + styles.css), NO framework, NO build step.
   - Typography: Inter primary (self-host woff2 in `public/qc-hub/fonts/` if available offline; otherwise font-stack fallback `"Inter",-apple-system,"Segoe UI",sans-serif` and note it) — SemiBold 600 headings/key data, Medium 500 buttons, Regular 400 body, compact 14px base. Promo codes monospace. No decorative fonts.
   - Sections in order: header (title + signed-in email only — NO metrics tiles), brand grid, **five separate promo-code text boxes** (one code per box; empty boxes are skipped; NOT one comma-separated field) + Search/Clear/Open BO/Open Module, Run QC button → **per-code verdict pills** (code + PASS/FAIL/REVIEW chip; clicking a pill switches the detail view) with the active code's verdict banner (verdict-first wording: "NOT SAFE TO APPROVE — FAIL · n findings") + mechanics line + findings list with "Fix with Claude" button on FAIL findings, **batch details table — ONE ROW PER CODE** (all codes of the run in one table, not a per-code field grid; columns: Code, Name, Type, Currency, Min Dep, Max Bonus, TO, Reward, Lifetime, Daily, Validity, Recurring, Members, Games, Inbox, Status, By, Updated; flagged values rendered as status chips in the cell; table scrolls horizontally inside its own container), error form (category/description/expected/actual/action/person/evidence), result buttons for the active code (Pass disabled while data is missing or critical findings exist; confirm dialog before save) + **Save All** (saves every code's record, each requiring its verdict resolved), Copy QC Summary (plain text, no Slack), history table.
   - **NO checklist section** (removed per user 2026-07-17): the automated findings are the verdict source; human disagreement is expressed through the error form + result buttons, not a checklist. One QC record per code.
   - **"Fix with Claude" appears in THREE places**, all posting to `/api/fix-request`: (a) on each FAIL finding in the Run QC results; (b) in the error & remarks panel — dispatches the manually-entered error (category/description/expected/actual) for issues the human found that auto-checks missed; (c) as a "🤖 Fix" action on FAIL/REVIEW rows in the history table (context from the saved record).
   - Match the look of the approved wireframe (light/dark via prefers-color-scheme + CSS custom properties). Minimal captions.

8. `.claude/launch.json`: add a `qc-hub` configuration (`node bin/qc-dashboard.mjs`, port 4321).

## Constraints
- Do not modify existing files in `src/` except purely additive exports if strictly needed; all new code in `src/qc-dashboard/` and `public/qc-hub/`.
- ESM throughout, matching repo style.
- No credentials in any committed file; respect existing `*.local.json` gitignore patterns.
- `node --test` must pass for the new tests; server must boot with `AUTH_MODE=dev` and no Google OAuth client configured.
- If BO creds/sessions are unavailable at dev time, the fetch layer must degrade with a clear error payload (`{error: "BO unreachable", detail}`), and the UI must render that state; do not fake data.
