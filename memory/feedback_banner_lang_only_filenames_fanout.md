---
name: Banner zips with lang-only suffixes need region fan-out
description: Some banner zips from the designer use lang-only filename suffixes (`-en`, `-zh`, `-id`) instead of the upload-promo.js-required `-{country}-{lang}` format. Fan them out into 6 locale-coded copies before running.
type: feedback
originSessionId: a31ede4f-1d05-4976-a033-a57703302ce0
---
When a banner zip's images are named `*-en.jpg` / `*-zh.jpg` / `*-id.jpg` (single lang suffix) and the B-task is on a multi-region brand (e.g. QPRO1 BP9 → MY/SG/ID), `bin/upload-promo.js`'s regex `/-([a-z]{2}-[a-z]{2,3})\.[a-z]+$/i` won't match and the script will fail with "No complete desktop+mobile pairs found".

**Fix:** create a `{brandcode}-min` folder and copy the 3 lang files into 6 locale-coded copies per orientation:
- `*-my-en.jpg` ← `-en.jpg`
- `*-my-zh.jpg` ← `-zh.jpg`
- `*-sg-en.jpg` ← `-en.jpg`
- `*-sg-zh.jpg` ← `-zh.jpg`
- `*-id-en.jpg` ← `-en.jpg`
- `*-id-id.jpg` ← `-id.jpg`

Do this for BOTH desktop (`-up-`, 1920x400) and mobile (`-mup-`, 960x400) → 12 files total per banner. The script's `--banner-dir` discovery prefers `*-min` over `*-ext` so the new folder is auto-picked.

**Why:** designers ship one image per language since the artwork is identical across regions; the multi-region brands need all locale slots filled separately for the BO. Manual fan-out is faster than patching the script's regex to also accept lang-only suffixes (which would need region-list inference from the schedule row).

**How to apply:** check the source zip's filename suffixes before running. If lang-only, fan out first via `cp` then run the standard `node bin/upload-promo.js --range=B##`. First confirmed on B46 (BP9 Mid-Year Spend & Win, 2026-05-21).
