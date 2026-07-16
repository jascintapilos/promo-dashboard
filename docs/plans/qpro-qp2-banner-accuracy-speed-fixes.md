# QPRO/QP2 banner automation — accuracy & speed fixes

## Background

A strategic-design-advisor review (2026-07-16, root-caused via a 4-agent research fan-out) diagnosed why `bin/upload-promo.js` (the QPRO/QP2 banner + 3.3 promo-content uploader) produces low-accuracy results and runs slowly. Five concrete, code-confirmed root causes were identified, ranked by advisor-assessed impact-per-effort.

This is separate from the 2026-07-09 `--commit` safety fix (already shipped, commit `fcfeadf`) — that fix made the script safe-by-default. This plan is about correctness and speed of the (now-safe) live path.

**Decision (user, 2026-07-16):** ship items 1-4 plus the low-risk half of item 5 (5a sleep removal, 5b/5c caching) now. Bounded concurrency (formerly 5d) is **deferred out of this plan entirely** to a separate, future plan, to be scoped and approved after items 1-4 land and are verified. **The B-ID loop must remain fully sequential in this plan — no concurrency change of any kind.**

## Scope

In scope: `bin/upload-promo.js`, `bin/pull-banner-from-clickup.mjs`, `src/api-client.js`, `.claude/skills/banner-pre-qc/SKILL.md`.
Out of scope: WS1/WS2 (`upload-ws1-banners-api.mjs`) — separate script, not reviewed. `canary-multi-brand.js`'s softer QC-gate-discipline finding — advisor rated that low-urgency, no action recommended.

## Changes

### 1. Stop force-disabling the creative-mismatch guard by default (highest leverage, lowest effort)

**Problem:** `upload-promo.js` has a guard (L509-544, invoked L602-615) that blocks upload when campaign-title keywords share nothing with staged-filename keywords — it has already caught one real incident (`memory/project_banner_health_check.md`: B07, June campaign label + May's stale images, blocked). But `.claude/skills/banner-pre-qc/SKILL.md` (~L155-158, the "Recommendation" section) bakes `--allow-creative-mismatch` into the standard "proceed to upload" command shown after every PASS/WARNING verdict — so the guard is disabled on every routine run, not just when a mismatch is actually flagged.

**Fix:**
- `.claude/skills/banner-pre-qc/SKILL.md`: remove `--allow-creative-mismatch` from the default recommended command. Only mention it as an explicit override to reach for if the guard fires and a human confirms the "mismatch" is a false positive (e.g. a single-image brand whose filename genuinely doesn't share campaign keywords).
- Also fix two real bugs in the guard itself while touching this code, since both directly undermine the exact fix this item is making:
  - `keywordsFromFilenames` (`bin/upload-promo.js` L527-535): the comment says the brand-prefix token is "handled below" (implying dropped) but the filter never removes index 0 — the brand code stays in the keyword set. If the campaign title also contains the brand name, this creates a false match on the brand token alone with zero real content overlap. Fix: actually drop the first path segment (brand-prefix token) from each filename's word list before returning.
  - `checkCreativeMatch` (L536-544): `ok: campKw.length === 0 || overlap.length > 0` — a campaign title made entirely of stopwords (L517-520 includes "new", "now", "bonus", "promo", "campaign") yields an empty keyword set and auto-passes with no warning. Fix: when `campKw.length === 0`, return `ok: true` but also set a `weak: true` field, and have the caller (L602-615) print a visible warning (not silent pass) so a human notices the guard couldn't meaningfully evaluate this campaign title, rather than believing it actively confirmed a match.

**Do not touch:** `bin/pull-banner-from-clickup.mjs`'s own `--allow-creative-mismatch` suggestion (L465, L469 in the pre-fix line numbering) was reviewed — it is a "next step" hint pointing at the *next command to run*, and since it's a bare dry-run suggestion (no `--commit`), running it as printed is safe; it does not bypass the guard at commit time. Leave as-is.

### 2. Thread `content_details` into the saved QC bundle

**Problem:** `uploadBanner()` computes the full 3.3 content object as `detailsObj` (`bin/upload-promo.js` L725-776) but never includes it in the function's return value (L827-831) or the saved bundle (L992-994, the `type: 'saved'` branch). `banner-deep-qc/SKILL.md` (L56, L63) explicitly reads `content_details` from the bundle for every 3.3-content check (T&C hyperlink placement, brand placeholder, HTML-entity artifacts, locale completeness) and marks the whole section **INCONCLUSIVE** whenever it's absent. Since it's structurally never written, these checks are INCONCLUSIVE on every single QPRO banner, unconditionally — deep-QC cannot ever catch a bad 3.3 page (including the image-only-stub case in item 3 below).

**Fix:**
- `bin/upload-promo.js` L827-831 (`uploadBanner`'s return object): add `contentDetails: skipContent ? null : detailsObj`.
- L992-994 (bundle-writing, `type: 'saved'` branch): add `content_details: r.contentDetails || null`.
- No change needed to the `dry-run`/`type: 'plan'` branch — content isn't generated during dry-run.

### 3. Fix the image-only-stub root cause partially — surface it instead of hiding it

**Problem:** When no Google Doc resolves (column D blank, no same-tab campaign-name fallback match, or Drive folder has no native Docs), `detailsObj` falls back to a bare `<p><img...></p>` with no title/description/T&C (L733-739, L751-772). Combined with item 2 (previously always-INCONCLUSIVE), this shipped silently. Item 2 alone fixes the *visibility* of this (deep-QC can now see the content and flag it). This item adds one more signal so pre-QC can catch it **before** upload too, not just after.

**Fix:**
- `bin/upload-promo.js`: in the branch where the fallback stub is used (around L739/L771), set a `contentIsStub: true` flag alongside the fallback content (e.g. on the per-locale `detailsObj[locId]` entry, or as a top-level flag returned from `uploadBanner`).
- Return this flag from `uploadBanner()` and include it in the `type: 'plan'` (dry-run) bundle too, not just the saved one — this is knowable before the live write happens (Doc resolution already runs during dry-run per L683-706).
- `.claude/skills/banner-pre-qc/SKILL.md`: add a check — if the plan bundle's `contentIsStub` is true, report a WARNING: "no promo draft doc found — 3.3 content will be an image-only stub with no title/description/T&C. Confirm this is intended or supply `--promo-folder`."

### 4. Fix the pull-banner-from-clickup.mjs → upload-promo.js folder-path mismatch

**Problem:** `bin/pull-banner-from-clickup.mjs` stages QPRO/QP2 images at `Banner/{campaign}/{brandCode}-min/` (L327 WS1 branch, L346 QPRO/QP2 branch) — nested one level under a campaign folder, and named `-min` at *download* time, before any compression has run. `bin/upload-promo.js`'s `discoverImages()` (L103-132) only scans **direct children** of `--banner-dir` (default `Banner/`) whose name starts with the brand code, and treats any `-min`-suffixed folder as "already compressed, prefer it" (L128). Net effect: the documented default invocation (`node bin/upload-promo.js --range=<B-ID>`, no `--banner-dir` override) cannot find what the documented Step 1 tool (`pull-banner-from-clickup.mjs`) just staged, without an undocumented manual folder move — and because the puller's folder is already named `-min`, the documented compression step (`compress-banners.mjs`) has no distinct raw-vs-compressed pair to work from, so real compression is easy to skip by accident.

**Fix (QPRO/QP2 branch only, in `pull-banner-from-clickup.mjs`):**
- Change `destFolder` construction (L346, and the corresponding dest-filename references) from `join(bannerDir, campaign, \`${brandCode}-min\`)` to `join(bannerDir, \`${brandCode}-${campaignSlug}\`)` — i.e. a direct child of `bannerDir`, matching what `discoverImages()` already scans for, and matching the existing convention already used elsewhere in this codebase (e.g. `ye55-min`, `ye55-ext`, and the WS1 script's own `Banner/{brand}-{campaign}/` convention).
- Do **not** append `-min` at staging time — that name is reserved for the *output* of `compress-banners.mjs`, per the documented Step 3.5 (`node bin/compress-banners.mjs "Banner/<raw-folder>" "Banner/<raw-folder>-min"`). The raw staged folder should be named without `-min` so the compress step has a real source to read from and a real, distinct destination to write.
- `campaignSlug`: reuse whatever sanitization already makes `campaign` filesystem-safe today (it's already used as a path segment at L327/346, so this must already exist somewhere in the file — locate and reuse it, don't invent a new one).
- Leave the WS1 branch's own folder convention alone (out of scope per this plan; WS1/WS2 uses a separate uploader script not covered here).
- Update the printed "Next step" hint (around L465 pre-fix numbering) if the folder name it references changes.

**Verification for this item specifically:** after the fix, run `pull-banner-from-clickup.mjs --bid=<a real B-ID with a resolvable ClickUp task>` (if a safe test B-ID is available) or trace the logic by hand against a synthetic filename set, and confirm the resulting folder path is one `discoverImages()` would actually find (dry-run only — do not `--commit`).

### 5. Remove one indefensible sleep; cache what's obviously cacheable (low-risk performance only)

**5a. Remove the pre-first-attempt sleep.** `bin/upload-promo.js` L781: `await delay(1500)` fires before *every* 3.3-create attempt inside the 5-attempt retry loop (L779-803), including attempt 1, where nothing has been sent yet and there is nothing to protect against. Fix: move the delay so it only fires before attempts 2-5 (i.e., after a caught retriable failure, before retrying) — not before the first attempt.

**5b. Cache `getAllCategories`.** `src/api-client.js` L258-261 has no caching, unlike the sibling `getLocaleMap` (`bin/upload-promo.js` L82-92, already `Map`-cached by `site.id`). Fix: add the identical caching pattern (`Map` keyed by `site.id`) to `getAllCategories`, mirroring the existing `getLocaleMap` implementation exactly (same file structure, same cache-check-then-fetch-then-store shape).

**5c. Cache `getDocContentMap` by resolved folder ID.** `bin/upload-promo.js` L469 (`getDocContentMap`) re-lists and re-exports the same Google Docs once per B-ID even when `campaignFolderMap` (L924, populated ~L924-930 in current numbering) explicitly groups multiple B-IDs under one shared Drive folder in a multi-brand campaign. Fix: add a `Map` cache keyed by the resolved folder URL/ID at the call site (~L695), populated on first resolution and reused for subsequent B-IDs in the same run that resolve to the same folder.

**Explicitly do not change:** the main B-ID loop's control flow (`bin/upload-promo.js` L946-959) — **it must remain a plain sequential `for...of` + `await`, exactly as it is today.** No concurrency, no `Promise.all`, no bounded-limiter of any kind in this plan. (Bounded concurrency was considered and is deferred — see "Deferred" section below.) Also do not change: the login-endpoint rate-limit/backoff logic in `src/api-client.js` L26-114; the draft-first/manual-activation design (`position: 99, status: 0` at L814-815/809 in current numbering) — a deliberate publish-safety gate per `memory/feedback_banner_position_and_activation.md`, not a bug; the existence or scope of `/banner-pre-qc` / `/banner-deep-qc` themselves.

## Acceptance criteria

- Running `node bin/upload-promo.js --range=<nonexistent-B-ID>` (no `--commit`) still behaves as a safe dry-run with no BO calls (regression check against the 2026-07-09 fix).
- Running the same with `--commit` still requires the flag to be honored (regression check — confirms this plan didn't touch the safety gate).
- The main B-ID loop is confirmed, by reading the diff, to still be a plain sequential `for...of` + `await` with no concurrency introduced — this is a hard pass/fail check on the diff itself, not just a runtime observation.
- `getAllCategories` and `getDocContentMap` are confirmed, by reading the diff, to use a cache-check-then-fetch-then-store pattern mirroring `getLocaleMap`'s existing shape; a temporary call-counter or log added for manual verification must be removed before the diff is considered done (or left as a clearly-marked debug aid only if the plan reviewer — Claude — explicitly asks to keep it).
- `banner-pre-qc/SKILL.md`'s default recommended command no longer includes `--allow-creative-mismatch`.
- The `contentDetails`/`content_details` field is confirmed present in `uploadBanner()`'s return object and the saved-bundle write, by reading the diff (no live `--commit` run needed to verify this — it's a static code check plus, if safe fixture data is available, a dry-run/unit-style check that the field is populated when expected).
- The `contentIsStub` flag is confirmed present in both the dry-run/plan bundle and the saved bundle, by reading the diff.
- `node --check bin/upload-promo.js`, `node --check bin/pull-banner-from-clickup.mjs`, and `node --check src/api-client.js` all pass.

## Verification commands (safe — no live BO writes, no mutation of any kind)

```
node --check bin/upload-promo.js
node --check bin/pull-banner-from-clickup.mjs
node --check src/api-client.js
node bin/upload-promo.js --range=B999999          # nonexistent B-ID — confirms dry-run-safe + no crash, no real writes possible (B999999 cannot resolve against the schedule)
node bin/upload-promo.js --range=B999999 --commit # nonexistent B-ID — confirms --commit path still gated correctly, still no real writes possible
```

These two `upload-promo.js` invocations are safe specifically because `B999999` cannot resolve to any real schedule row — they exercise flag-parsing and mode-selection only, never reach live API calls. This is the same technique already used to verify the 2026-07-09 fix. Where a real fixture, mock BO response, or a captured sample bundle is needed to verify a specific item (e.g. confirming `content_details` actually gets populated correctly), construct one locally (a hand-written JSON fixture, or a small standalone test invoking the relevant function directly with fake inputs) rather than exercising the real API.

## Safety constraints

- **Codex must not perform any live banner uploads, BO writes, `--commit` invocations against a real/resolvable B-ID, git commits, or git pushes at any point during implementation or verification of this plan.** All verification must use the safe nonexistent-B-ID commands above, `node --check` syntax checks, hand-written fixtures/mocks, or direct code reading — no exceptions, regardless of how confident the change looks.
- No change in this plan may alter the 2026-07-09 `--commit`/`dry-run` safety gate behavior — verify the acceptance-criteria dry-run check above explicitly.
- The B-ID loop must remain fully sequential — no concurrency, no `Promise.all`, no worker pool, no bounded limiter. This is explicit, not an oversight: bounded concurrency was considered for this plan and deliberately deferred (see below).
- Do not modify `.claude/skills/banner-deep-qc/SKILL.md` or `.claude/skills/banner-batch-uploader/SKILL.md` under this plan — only `banner-pre-qc/SKILL.md` per item 1 and item 3.
- Leave the working tree free of any other uncommitted, unrelated changes untouched (several exist in this repo from other in-progress work — do not stage, commit, or modify them).

## Deferred (separate future plan — not part of this one)

Bounded concurrency on the B-ID loop (reusing `src/api-client.js`'s existing login-retry/backoff mechanism, proven safe by `canary-multi-brand.js --parallel`'s ~20-way concurrent bursts) was scoped in an earlier draft of this plan and removed per user decision. It should be proposed as its own plan, after items 1-4 and 5a-5c here have shipped and been verified in real use — not bundled into this one.
