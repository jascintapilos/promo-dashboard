# Banner pipeline reliability fixes (retroactive plan)

## Background

This plan documents a body of work already implemented in the working tree (uncommitted at time of writing) touching `bin/upload-promo.js`, `bin/pull-banner-from-clickup.mjs`, `src/api-client.js`, and `src/banner-schedule.js`. It was picked up mid-session with no prior plan file on disk — this doc backfills the plan record per the standard Codex handoff process (`CLAUDE.md` § Codex implementation handoff), for approval before commit.

This is separate from, and lands after, the already-shipped `qpro-qp2-banner-accuracy-speed-fixes.md` plan (creative-mismatch guard, `content_details`/`contentIsStub` threading, sleep removal, category/doc caching — all confirmed present in `HEAD`, not part of this diff).

## Scope

In scope: `bin/upload-promo.js`, `bin/pull-banner-from-clickup.mjs`, `src/api-client.js`, `src/banner-schedule.js`, plus 7 new standalone test scripts (`bin/test-banner-*.mjs`).
Out of scope: the QC Hub dashboard build (`bin/qc-dashboard.mjs`, `src/qc-dashboard/`), the SMS/dialog silent-drop warning fix (`src/api-mapper-qp2.js`/`qpro.js` + agent docs — separate, self-contained, already reviewed), and the `src/ingest.js` "Game Provider:" label parser fix (separate, already reviewed).

## Changes actually made (as found in the diff)

### 1. Unify month-tab resolution (`src/banner-schedule.js`, `bin/upload-promo.js`)
**Problem:** Two divergent copies of "which month tab do we use" logic existed — one in `bin/upload-promo.js` (supported `--month`, threw on no match) and one in `src/banner-schedule.js`'s `resolveScheduleTab` (no override, matched only the 3-letter abbreviated form "Jul 2026" — never "July 2026" — and fell back to `tabs[0]`, which could silently select an unrelated month's tab with zero warning).

**Fix:** New pure, synchronous `resolveMonthTab(tabs, { monthOverride, referenceDate })` in `src/banner-schedule.js` is now the single source of truth. Matches exact abbreviated or full month name first; on miss, sweeps for a `<letters> <year>`-shaped tab whose month token matches the current month (abbreviated or full) — no longer an arbitrary `tabs[0]`. Throws if nothing resolves. `resolveScheduleTab` and `bin/upload-promo.js`'s new `resolveScheduleTabName` (which also handles the pre-existing `--gid` override path) both delegate to it. Covered by `bin/test-banner-month-tab.mjs`.

### 2. Harden ClickUp task-ID extraction (`src/banner-schedule.js`)
**Problem:** The regex extracting a bare task ID from a ClickUp URL didn't tolerate a trailing `?query` or `#fragment`, silently returning `null` on an otherwise-valid task URL.

**Fix:** Extracted into standalone `extractClickupTaskId(url)`, regex now tolerates trailing slash, query string, and fragment. Covered by `bin/test-banner-regex-hardening.mjs`.

### 3. Never fall back to an arbitrary locale for doc content (`bin/upload-promo.js`)
**Problem:** `docContentMap[locCode] || docContentMap[countryEn] || docContentMap['MY_EN'] || Object.values(docContentMap)[0]` — the final fallback grabs whatever locale happens to be first in insertion order. Could silently place e.g. Chinese doc content onto an Indonesian-locale banner.

**Fix:** New `resolveDocEntry(docContentMap, locCode)` — same preference chain (exact → same-country EN → `MY_EN`) but stops at `null` instead of grabbing an arbitrary entry. Applied at both call sites (per-locale row build and the single-locale fallback branch). Covered by `bin/test-banner-doc-fallback.mjs`.

### 4. Fix header/tagline duplication when a doc has no `<hr>` divider (`bin/upload-promo.js`)
**Problem:** `fetchDocHtml`'s header-strip logic only looked at content before the first `<hr>`. Docs whose translator never inserted a divider (observed on MY_ZH/ID_ID variants of a real campaign doc) fell through silently: `description` stayed empty and the raw title+tagline paragraphs survived verbatim as the first lines of the live page body, duplicating the title.

**Fix:** `fetchDocHtml` split into a pure `processDocHtml(rawHtml, { expectedTitle })` (unit-testable without mocking Drive) plus a thin Drive-calling wrapper. New logic parses all `<p>` blocks in document order (not just pre-divider), and only strips paragraph 0 (+1 if present) when paragraph 0 plausibly matches the caller-supplied `expectedTitle` (fuzzy, Unicode-aware match via `titlesRoughlyMatch`/`normalizeForTitleMatch` — handles CJK titles, not just ASCII). When it doesn't match, content is left untouched and a new `headerShapeUnrecognized` flag is set so the doc is treated as stub-quality for QC rather than silently mangled. A second defense-in-depth safety net re-checks the start of the resulting content for a verbatim duplicate of the extracted `description` and strips it if found (also setting `headerShapeUnrecognized`). Threaded through as `headerWarnings` on both the `type: 'plan'` and `type: 'saved'` bundle branches. Covered by `bin/test-banner-doc-parsing.mjs`.

### 5. Campaign-aware banner folder disambiguation (`bin/upload-promo.js`)
**Problem:** `discoverImages()` picked whichever brand-prefix-matching subfolder happened to end in `-min` with zero correlation to the actual campaign — a real incident let a stale `-min` folder from a past campaign get used silently instead of the freshly staged one.

**Fix:** `discoverImages()` now takes a `campaignHint` parameter (the B-ID's campaign/label text). With 2+ brand-matching candidate folders, disambiguates by keyword overlap against the campaign (same stopword-filtered approach as the existing creative-mismatch guard). Exactly one overlapping candidate wins regardless of `-min`/`-ext` suffix; 2+ overlapping candidates throws (ambiguous, requires explicit `--image-dir`); zero overlap falls back to the old permissive single-`-min` behavior but now with a loud warning; zero overlap + multiple `-min` folders throws instead of guessing. Covered by `bin/test-banner-image-discovery.mjs`.

### 6. `docNameToLocaleKey` — match CC/LANG token anywhere in the filename (`bin/upload-promo.js`)
**Problem:** The CC/LANG pattern (e.g. "MY/EN") was only matched if it was the very last thing in the doc filename — a trailing parenthetical, version suffix, or period defeated detection and fell through to a cruder CJK/word-sniffing heuristic.

**Fix:** Matches the pattern anywhere in the name (global match) and takes the last occurrence. Covered by `bin/test-banner-locale-key.mjs`.

### 7. `uploadFile()` auto-relogin on 401/419 (`src/api-client.js`)
**Problem:** Raw multipart banner/image uploads go through `fetch` directly (not `authedFetch`/`rawFetchJson`), so they never got the transparent one-shot relogin-and-retry that every other API call in the codebase has. The first upload in a run could hard-fail on a transient auth hiccup that any other call would have quietly recovered from.

**Fix:** `uploadFile()` now retries once on a 401/419 response — clears the session, forces a refresh, rebuilds the `FormData`/`Blob` from the same buffer (safe to reuse; `Blob([fileBuffer])` doesn't consume it), and retries. Dependency-injectable via an internal `_deps` escape hatch (defaults to the real session functions) so this is testable without a real network/login. Covered by `bin/test-banner-upload-file-retry.mjs`.

### 8. ClickUp download reliability + Nextcloud fallback (`bin/pull-banner-from-clickup.mjs`)
**Problem:** `downloadBuffer(url)` made a single request with a bare `Authorization` header; some ClickUp-hosted attachment URLs are signed CDN links that reject that header shape entirely, causing hard download failures with no recourse.

**Fix:** `downloadBuffer` now tries both `att.url` and `att.url_w_query` (deduped), and for each tries both an authenticated and unauthenticated request. If every ClickUp attempt fails and a Nextcloud "Banners" share link was found in the task comments, falls back to matching the ClickUp filename's locale suffix against a listing of the Nextcloud share (locale-suffix match, not exact filename — the two sources use different suffix conventions) and downloading from there instead. Ambiguous (2+) or zero locale matches raise a clear error rather than guessing. Also added: `--month` CLI override (threaded into `resolveScheduleTab`), and `bannerDir` default changed from `join(ROOT, 'Banner')` to `join(ROOT, '..', 'Banner')` to align with where `upload-promo.js` actually reads staged images from (the repo lives one level below the shared `Banner/` directory).

## New test coverage

Seven standalone scripts under `bin/test-banner-*.mjs`, each directly invoking the relevant pure function(s) with hand-written fixtures/mocks — no live network or BO calls:
- `test-banner-doc-fallback.mjs` — `resolveDocEntry`
- `test-banner-doc-parsing.mjs` — `processDocHtml`
- `test-banner-image-discovery.mjs` — `discoverImages`
- `test-banner-locale-key.mjs` — `docNameToLocaleKey`
- `test-banner-month-tab.mjs` — `resolveMonthTab`
- `test-banner-regex-hardening.mjs` — `extractClickupTaskId`
- `test-banner-upload-file-retry.mjs` — `uploadFile` auto-relogin (via `_deps` injection)

`bin/upload-promo.js`'s module body was wrapped in an `async function main()`, gated behind an `isMainModule` check (`import.meta.url === pathToFileURL(process.argv[1]).href`), so the file can be imported by the test scripts to reach its now-exported pure functions (`discoverImages`, `resolveScheduleTabName`, `docNameToLocaleKey`, `processDocHtml`, `resolveDocEntry`) without triggering a CLI parse, network call, or `process.exit`.

## Verification already performed

```
node --check bin/upload-promo.js              # PASS
node --check bin/pull-banner-from-clickup.mjs # PASS
node --check src/api-client.js                # PASS
node bin/test-banner-doc-fallback.mjs         # PASS
node bin/test-banner-doc-parsing.mjs          # PASS
node bin/test-banner-image-discovery.mjs      # PASS
node bin/test-banner-locale-key.mjs           # PASS
node bin/test-banner-month-tab.mjs            # PASS
node bin/test-banner-regex-hardening.mjs      # PASS
node bin/test-banner-upload-file-retry.mjs    # PASS
```

## Acceptance criteria (assessed retroactively)

- [x] All 4 touched files pass `node --check`.
- [x] Each new pure/exported function has a corresponding standalone test, and all 7 pass.
- [x] No change alters the 2026-07-09 `--commit`/dry-run safety gate (not touched by this diff — confirmed by reading the diff, no changes near the commit-gating logic).
- [x] The B-ID main loop is still a plain sequential loop — confirmed by reading the diff; the only structural change to the loop's surroundings is wrapping the whole script body in `async function main()` behind an `isMainModule` guard for testability, not a concurrency change.
- [ ] **Not yet verified against a real B-ID / real ClickUp task** — all verification above is `node --check` + standalone unit-style tests against hand-written fixtures. The Nextcloud fallback path and the `bannerDir` default-path change (item 8) have not been exercised against a live B-ID/ClickUp task or the actual on-disk `Banner/` directory layout.

## Safety constraints

- No live banner uploads, BO writes, or `--commit` invocations were used to produce the verification above.
- Not yet committed or pushed — pending this plan's approval.

## Verified: item 8's `bannerDir` default change is correct, not just claimed

Confirmed directly against the working tree (not just Codex's comment): `bin/upload-promo.js`'s own `bannerDir` default (line ~1113, untouched by this diff, a separate hardcoded absolute path) is `C:\Users\vdiuser\Downloads\promo-automation\Banner` — i.e. the **outer** `../Banner` relative to the repo root. `pull-banner-from-clickup.mjs`'s old default was `join(ROOT, 'Banner')` — the **inner** `./Banner`, inside the repo itself. These are two genuinely different directories on disk (different inodes, different content — the outer one has 28 entries including older archival folders like `ye55-min`/`ye55-ext` referenced by name in the already-shipped plan; the inner one has 14, mostly newer). Both received fresh campaign-folder writes within the same minute on 2026-07-17, which is live evidence of the exact bug this fix addresses: something was staging into the wrong (`./Banner`) directory while `upload-promo.js` was reading from the right one (`../Banner`) all along. Codex's fix aligns the two. Approved as correct.
