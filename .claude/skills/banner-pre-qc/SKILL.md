---
name: banner-pre-qc
description: Pre-upload banner plan review. Checks (1) the banner staging plan — brand mapping, images staged on disk, dimensions, dates; AND (2) the linked canary promo plan — promo code valid, bonus configured, dates consistent. Runs after pull-banner-from-clickup and upload-promo.js --dry-run, BEFORE --commit. Trigger on `/banner-pre-qc B16`, `/banner-pre-qc B13-B25`, "check banner before upload", "banner pre-qc B##".
---

# Banner Pre-QC — plan completeness gate before upload

Checks the banner staging plan **and** the linked canary promo QC plan together. A banner that links to a broken or missing promo is a dead link — catch it here before committing.

**Position in QC chain:**

```
pull-banner-from-clickup → upload-promo.js --dry-run → [/banner-pre-qc] → upload-promo.js --commit → [/banner-deep-qc]
                                                         ↑ THIS skill
```

## Trigger

- `/banner-pre-qc B16`
- `/banner-pre-qc B13-B25`
- "check banner before upload"
- "banner pre-qc B##"

## Pre-requisite

Plan bundles must exist: `upload-promo.js --dry-run` writes `captures/banner-qc-plans/{b_id}__{site_id}.json`. If none found, tell the user to run the dry-run first.

## Steps

### 1. List plan bundles

```sh
node bin/banner-qc-fanout.mjs <B-ID|range> --plans --pretty
```

If output says "No plans found", stop and tell the user to run `upload-promo.js --dry-run` first.

### 2. For each bundle — run these checks in parallel

Read `captures/banner-qc-plans/{b_id}__{site_id}.json` for each brand.

**A. Image checks (read local disk):**

| Check | Pass condition |
|---|---|
| Desktop image exists | `staged_images[].desktop` path exists on disk |
| Mobile image exists | `staged_images[].mobile` path exists on disk |
| Both present per locale | At least 1 locale has both desktop + mobile |
| Brand code in filename matches site | Filename starts with `site.loginMerchantCode.lower()` |

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
1. Glob `captures/qc-plans/*__{BRAND}.json` where BRAND is the uppercase site label (e.g. `QPRO16` for `qpro16`)
2. Read each matching file and look for `promo_code === bundle.promo_code`
3. If found:
   - Check `status` field — PASS/WARNING/FAIL from the canary pre-qc
   - Check `bonus_type` is a banner-compatible type (Deposit or FS or FC — not internal-only)
   - Check dates in canary plan roughly match banner dates (within ±3 days)
   - Report: `✓ canary plan found — P### PASS`
4. If not found:
   - Check if the promo code actually exists in BO by reading any available captures
   - Report: `⚠ no canary QC plan found for code {promo_code} — verify promo exists in BO before uploading`

### 3. Aggregate verdict table

```
BANNER PRE-QC — B16

| B-ID | Brand    | Images       | Dates  | Position | Canary Plan     | Status  |
|------|----------|--------------|--------|----------|-----------------|---------|
| B16  | QPRO16   | ✓ my-en ×2   | ✓      | ⚠ pos 99 | ✓ P073 PASS     | WARNING |
| B15  | QPRO15   | ✓ my-en ×2   | ✓      | ⚠ pos 99 | ⚠ not found     | WARNING |
| B13  | QPRO1    | ✗ no desktop | ✓      | ⚠ pos 99 | ✓ P073 PASS     | FAIL    |
```

For each WARNING/FAIL, expand with specific finding + recommended action.

### 4. Recommendation

- **All PASS or WARNING-only** → proceed to upload:
  ```
  node bin/upload-promo.js --range=<B-IDs> --allow-creative-mismatch
  ```
  Remind: position must be set manually in BO after upload (14.2 Banner → Edit → Position field).

- **Any FAIL on images** → fix staging first. Re-run `pull-banner-from-clickup.mjs` or manually copy images.

- **Any FAIL/WARNING on canary plan** → ensure the promo code is set up in BO before uploading the banner. A banner linking to a non-existent promo = dead link for members.

## Notes

- Read-only. Does not modify the BO, Banner folder, or plan bundles.
- Position WARNING is expected — upload-promo.js always creates banners at position 99 (draft staging). Correct position is set post-upload when activating.
- Canary plan lookup uses Glob — it only finds plans from runs done in this session/machine. If the promo was set up on another machine, the plan won't be found → WARNING, not FAIL.

## Pairs with

- `/banner-deep-qc B##` — post-upload verification including front-end check.
