---
name: banner-pre-qc
description: Pre-upload banner plan review. Checks (1) the banner staging plan — brand mapping, images staged on disk, dimensions, dates; AND (2) the linked canary promo plan — promo code valid, bonus configured, dates consistent. Runs after pull-banner-from-clickup and upload-promo.js --dry-run, BEFORE --commit. Trigger on `/banner-pre-qc B16`, `/banner-pre-qc B13-B25`, "check banner before upload", "banner pre-qc B##".
---

# Banner Pre-QC — plan completeness gate before upload

Checks the banner staging plan **and** the linked canary promo QC plan together. A banner that links to a broken or missing promo is a dead link — catch it here before committing.

**Position in QC chain:**

```
pull-banner-from-clickup → upload --dry-run → [/banner-pre-qc] → compress-banners → upload --commit → [/banner-deep-qc]
                                               ↑ THIS skill        ↑ Step 3.5
```

> **After this skill gives PASS/WARNING** → run compress before committing:
> ```
> node bin/compress-banners.mjs Banner/{brand}-{campaign} Banner/{brand}-{campaign}-min
> ```
> The upload script auto-selects the `-min` folder (prefers it over the raw folder). If you skip compression, the raw folder is uploaded instead.

## Trigger

- `/banner-pre-qc B16`
- `/banner-pre-qc B13-B25`
- "check banner before upload"
- "banner pre-qc B##"

## Pre-requisite

Plan bundles must exist: `upload-promo.js --dry-run` writes `captures/banner-qc-plans/{b_id}__{site_id}.json`. If none found, tell the user to run the dry-run first.

> **WS1/WS2 Directus banners**: the dry-run command is different — `node bin/upload-ws1-banners-api.mjs --range=<B-ID>` (dry-run is the default; no flag needed). This script only prints the plan to the console — it does **not** write a `captures/banner-qc-plans/{b_id}__ws1__{region}.json` file the way the QPRO/QP2 path does. So `banner-qc-fanout.mjs --plans` will always report "no plans found" for a WS1/WS2 B-ID today. Do not treat that as a FAIL or as evidence the images/dates are wrong — it means there is no persisted pre-upload artifact yet for this platform. Tell the user to run the dry-run command above and read its console output directly (image found/missing per locale, carousel ID resolved, dates) instead of expecting a bundle file. Full deep-QC (`/banner-deep-qc`) still works normally post-`--commit`, since that script writes `captures/banner-qc-bundles/{b_id}__ws1__{region}.json`.

## Steps

### 1. List plan bundles

```sh
node bin/banner-qc-fanout.mjs <B-ID|range> --plans --pretty
```

If output says "No plans found", stop and tell the user to run `upload-promo.js --dry-run` first.

### 2. For each bundle — run these checks in parallel

Read `captures/banner-qc-plans/{b_id}__{site_id}.json` for each brand.

> **WS1/WS2 field model** — if a plan bundle does exist (future-proofing, or a manually captured one), its shape follows `upload-ws1-banners-api.mjs`'s in-memory plan, NOT the QPRO/QP2 `banner-qc-plans` schema. Do not look for `banner_id`, `staged_images[].desktop/mobile` paths in a flat list, or `content_id` — those are QPRO/QP2-only. Instead expect: `carouselId` (per region — flag WARNING if `CAROUSEL_IDS[siteId][region]` has no entry, since the upload script skips that region silently), `region` (MY/TH/ID/KH/SG/AU/PH, not a currency code), `locales` + `localeImages[locale].desktop/mobile`, `linkUrl`, `cta` (button text — QPRO/QP2 banners don't have a separate CTA field, WS1/WS2 do), `startDate`/`endDate` (Directus ISO format). There is **no 3.3-equivalent content check** for WS1/WS2 banners — skip section D's "canary plan bonus_type/content" checks and only check the promo code exists (see below).

**A. Image checks (read local disk):**

| Check | Pass condition |
|---|---|
| Desktop image exists | `staged_images[].desktop` path exists on disk |
| Mobile image exists | `staged_images[].mobile` path exists on disk |
| Both present per locale | At least 1 locale has both desktop + mobile |
| Brand code in filename matches site | Filename starts with `site.loginMerchantCode.lower()` |

**A2. Image content visual check (open and look at each image):**

For every staged image file, use the **Read tool to open the image** — Claude can see images directly. Check two things:

*Brand identity* — does the banner show the correct brand for the BO it's being uploaded to?

| Verdict | Condition |
|---|---|
| PASS | Brand name or logo in the image clearly matches the target brand |
| WARNING | No brand identifier visible — purely graphical; cannot confirm |
| FAIL | A different brand name or logo is visibly shown — wrong creative |

*Locale language* — does the image text match the locale it's filed under?

| Locale | Expected language in image |
|---|---|
| `-en` | English |
| `-zh` | Chinese / Traditional Chinese (繁體中文) |
| `-id` | Bahasa Indonesia |
| `-th` | Thai script |
| `-km` / `-kh` | Khmer script |

| Verdict | Condition |
|---|---|
| PASS | Visible text matches the locale |
| WARNING | No visible text — graphic-only banner; cannot verify |
| FAIL | Text is clearly in a different language than the locale suffix |

Flag FAIL if a single `-en` image is being reused for a `-zh` slot — Chinese members would see an English-only banner.

Report per-file findings in `checks.image_content.per_file[]`.

**B. Date checks:**

| Check | Pass condition |
|---|---|
| Start date not in the past | `start_datetime` ≥ today (or warn if < 7 days ago — may be intentional) |
| End date in the future | `end_datetime` > today |
| Duration reasonable | end − start between 3 days and 18 months |

**C. Position check (infer from campaign name in label):**

| Campaign type | Expected position |
|---|---|
| Label contains "pragmatic", "PP", "playtech", "microgaming", "fastspin", "evolution" | 3 or 4 |
| In-house / brand own campaign | 1 or 2 |
| Other vendor | 5 |

Note: position is set at upload time (upload-promo.js defaults to 99 — flag as WARNING that position must be corrected post-upload).

**D. Canary promo plan check:**

For each bundle's `promo_code`:
1. Glob `captures/qc-plans/*__{BRAND}.json` where BRAND is the uppercase site label (e.g. `QPRO16` for `qpro16`). **For WS1/WS2, the label is region-suffixed, not the bare site id** — use `WS1_MY`, `WS1_SG`, `WS1_TH`, etc. (site_id + `_` + region), or bare `WS2` for WS2 (single-region). Globbing `*__WS1.json` or `*__ws1.json` will find nothing — always append the region for WS1.
2. Read each matching file and look for `promo_code === bundle.promo_code`
3. If found:
   - Check `status` field — PASS/WARNING/FAIL from the canary pre-qc
   - Check `bonus_type` is a banner-compatible type (Deposit or FS or FC — not internal-only)
   - Check dates in canary plan roughly match banner dates (within ±3 days)
   - Report: `✓ canary plan found — P### PASS`
4. If not found:
   - Check if the promo code actually exists in BO by reading any available captures
   - Report: `⚠ no canary QC plan found for code {promo_code} — verify promo exists in BO before uploading`

**E. Canary plan freshness check (only when D found a matching plan):**

A canary plan file is a snapshot from whenever `canary-multi-brand.js` was last dry-run for that handle. If the requester edited the source row afterward (e.g. changed the bonus %, dates, or brand list) and nobody re-ran the dry-run, this plan is stale — Pre-QC would confidently report "canary plan found — PASS" against numbers that no longer match the sheet.

1. Extract `{handle}` from the matched filename (`captures/qc-plans/{handle}__{BRAND}.json`).
2. Compare file modification times: `captures/requests/{handle}.json` (written fresh every time `node bin/ingest-requests.js` pulls that row) vs the matched `captures/qc-plans/{handle}__{BRAND}.json`.
3. If `captures/requests/{handle}.json` is newer than the canary plan file → the row was re-ingested after this plan was generated:
   - Report: `⚠ canary plan is STALE — captures/requests/{handle}.json was refreshed {X} after the plan was generated. Re-run: node bin/canary-multi-brand.js {handle} --parallel, then re-check.`
   - Do not report canary-plan status as a clean PASS in this case even if `status` inside the plan says PASS — downgrade to WARNING and note staleness explicitly.
4. If `captures/requests/{handle}.json` doesn't exist or is missing/unreadable, skip this check silently (INCONCLUSIVE, not a finding) — don't guess at freshness with no reference point.
5. If the canary plan file is newer or the same age, no staleness note needed.

Fold this into the same "Canary Plan" table column as a suffix, e.g. `✓ P073 PASS (stale — recheck)`, rather than adding a new column.

### 3. Aggregate verdict table

```
BANNER PRE-QC — B16

| B-ID | Brand  | Files        | Brand ID     | Locale lang    | Dates | Position | Canary Plan | Status  |
|------|--------|--------------|--------------|----------------|-------|----------|-------------|---------|
| B16  | QPRO16 | ✓ my-en ×2   | ✓ QPRO16 OK  | ✓ EN confirmed | ✓     | ⚠ pos 99 | ✓ P073 PASS | WARNING |
| B15  | QPRO15 | ✓ my-en ×2   | ✓ QPRO15 OK  | ✗ zh has EN text| ✓    | ⚠ pos 99 | ⚠ not found | FAIL    |
| B13  | QPRO1  | ✗ no desktop | INCONCLUSIVE | INCONCLUSIVE   | ✓     | ⚠ pos 99 | ✓ P073 PASS | FAIL    |
```

For each WARNING/FAIL, expand with specific finding + recommended action.

### 4. Recommendation

- **All PASS or WARNING-only** → proceed to upload:
  ```
  node bin/upload-promo.js --range=<B-IDs> --allow-creative-mismatch
  ```
  Remind: position must be set manually in BO after upload (14.2 Banner → Edit → Position field).

  **WS1/WS2**: use `node bin/upload-ws1-banners-api.mjs --range=<B-IDs> --commit` instead — position/carousel placement is fixed by the `CAROUSEL_IDS` mapping at upload time, no manual position step needed.

- **Any FAIL on images** → fix staging first. Re-run `pull-banner-from-clickup.mjs` or manually copy images.

- **Any FAIL/WARNING on canary plan** → ensure the promo code is set up in BO before uploading the banner. A banner linking to a non-existent promo = dead link for members.

- **Canary plan flagged STALE** → re-run `node bin/canary-multi-brand.js {handle} --parallel` to regenerate the plan from the latest sheet row, then re-run `/banner-pre-qc` before uploading. Do not proceed on a stale plan's numbers.

## Notes

- Read-only. Does not modify the BO, Banner folder, or plan bundles.
- Position WARNING is expected — upload-promo.js always creates banners at position 99 (draft staging). Correct position is set post-upload when activating.
- Canary plan lookup uses Glob — it only finds plans from runs done in this session/machine. If the promo was set up on another machine, the plan won't be found → WARNING, not FAIL.
- **WS1/WS2 has no persisted plan-bundle file today** — `upload-ws1-banners-api.mjs` dry-run only prints to console. Report this explicitly as "no pre-upload bundle available for this platform yet — verify manually from dry-run console output" rather than a generic FAIL/WARNING that implies something is actually wrong with the banner.

## Pairs with

- `/banner-deep-qc B##` — post-upload verification including front-end check.
