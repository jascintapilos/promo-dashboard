---
name: Banner upload automation — handover state (2026-05-19 end, updated part 2)
description: Read first when picking up banner upload work. Complete state of bin/upload-promo.js, confirmed API shapes, open items, and next steps.
type: project
originSessionId: af5bbde1-a568-45f3-a8e7-ae00350c1a3b
---
## What's production-ready

### bin/upload-promo.js
Full pipeline CLI: reads Banner Schedule from Sheets → discovers local images → API-direct QPRO 3.3 + 14.2.

**Usage (all flags require `=` syntax):**
```
node bin/upload-promo.js --range=B16
node bin/upload-promo.js --range=B13-B25
node bin/upload-promo.js --range=B16 --skip-content          # 14.2 only (3.3 already exists)
node bin/upload-promo.js --range=B16 --promo-code=MYCODE     # link banner to existing code
node bin/upload-promo.js --range=B16 --dry-run               # plan only, no BO calls
node bin/upload-promo.js --range=B16 --banner-dir=D:\Banners # custom image root
```

**Verified end-to-end:** B16 (QPRO16) and B17 (QPRO17) — Microgaming Road to Glory, 3.3 content + 14.2 banners fully complete (see session_2026-05-19_b16_b17_fetchdochtml_fixes.md).
Earlier smoke-test note: QPRO4/YE55 test banner id=43 was a TEST record (not a real B-task).

### Confirmed QPRO 14.2 Banner POST body
```json
POST /api/bo/banner
{
  "label": "...",
  "link": "/promotion?code=<ContentCode>",
  "start_datetime": "YYYY-MM-DD HH:mm:ss",
  "end_datetime":   "YYYY-MM-DD HH:mm:ss",
  "position": 99,
  "status": 0,
  "session": 1,
  "platform_type_id": 1,
  "images": [
    { "settings_locale_id": 1, "image_desktop": "<url>", "image_mobile": "<url>" }
  ]
}
```

**Critical field names (previously wrong):**
- `platform_type_id` NOT `platform_type` (422 if wrong)
- `images` NOT `details` (500 if wrong)
- `image_desktop` / `image_mobile` NOT `desktop_image` / `mobile_image` (500)
- `session: 1` = "All" (NOT 3 = "After Login" which is for dialog popups)
- Locale endpoint: `/api/bo/locale` NOT `/api/bo/settings/locale` (404 if wrong)

### Image discovery logic
- Looks in `Banner/` root for subfolders starting with `{loginMerchantCode.lower()}`
- e.g. qpro4 → loginMerchantCode=YE55 → looks for `ye55*` folders, prefers `ye55-min`
- Desktop: `{code}-up-*-{locale}.jpg`, Mobile: `{code}-mup-*-{locale}.jpg`
- Locale suffix `my-en` → code MY_EN → settings_locale_id from `/api/bo/locale`
- Date formats accepted from Sheets: `DD-Mon-YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`

### Rate limits (hardcoded delays in upload-promo.js)
- 5s before each desktop upload
- 3s before each mobile upload
- ~8s per locale pair → 2-locale banner ~20s for file uploads alone
- Additional 1.5s before 3.3 create and 14.2 create

## Schedule B-ID → site mapping (May 2026 tab)
⚠️ B-IDs are sequential banner task IDs from the Banner Schedule sheet — NOT qpro instance numbers.
B01–B12: BIA (WS1/WS2) → auto-skipped (MCP-driven only)
B13: qpro1 (BP9)
B14: qpro2 (12HUAT)
B15: qpro15 (E688) ✅ COMPLETE (Microgaming Road to Glory — 3.3 EVEMRTG id=53)
B16: qpro16 (ED98) ✅ COMPLETE (Microgaming Road to Glory — 3.3 EVEMRTG id=53, banner id=42)
B17: qpro17 (XE38) ✅ COMPLETE (Microgaming Road to Glory — 3.3 EVEMRTG id=52, banner id=40)
B18–B26+: check sheet for site mapping

**Banner image folders available:**
- `Banner/Microgaming Road to Glory/ibc22-min/` → QP2A ✅ COMPLETE (EVEMGRTGA — 3.3 id=210, banner id=209)
- `Banner/daily-win-s8l7-compressed/` → WS1 MB8 (B-ID TBD) — BIA

## T&C hyperlink rules (confirmed)

Drive docs use plain text `General :brandname terms and conditions apply.` — must be injected post-process.

| Platform | Placeholder | target="_blank" | URL pattern |
|---|---|---|---|
| QPRO | `:brandname` | no | `{domain}/en-my/info-center/terms-and-conditions` (same all locales) |
| QP2  | `:merchantname` | yes | `{domain}/terms-conditions?lang={LOCALE}` (per-locale) |

**Finding QPRO frontend domain:** probe code `EVEMGLMPCR` on the site → extract `href` from T&C link.
⚠️ Pattern guessing is unreliable (bp9**mys**.com vs e688**my**.com vs xe38**.com**). Always probe.

**QP2A (IBC22):** `https://ibc22myr.com`
**QPRO15 (E688):** `https://e688my.com`
**QPRO16 (ED98):** `https://ed98my.com`
**QPRO17 (XE38):** `https://xe38.com`

Fix scripts (all already run, all idempotent/re-runnable):
- `bin/fix-qpro-evemrtg-tnc.mjs` — QPRO15/16/17 MY_EN T&C hyperlink ✅
- `bin/fix-qpro-evemrtg-zh-tnc.mjs` — QPRO15/16/17 MY_ZH T&C hyperlink ✅ (Chinese pattern, /zh-my/ path)
- `bin/fix-qpro-evemrtg.mjs` — QPRO15/16/17: remove LIVE CASINO category + MY_ZH title/desc/content ✅
- `bin/fix-qp2a-evemgrtga.mjs` — QP2A id=210: promotion_type, :brandname→:merchantname, MY_ZH content ✅
- `bin/fix-qp2a-evemgrtga-zh.mjs` — QP2A id=210 MY_ZH: decode HTML entities in title/desc + ZH T&C link ✅

## Open items (priority order)

1. **Run remaining B-IDs** — B13–B15, B18+ still pending. Need image folders + correct site mapping from sheet.
   - Check Banner Schedule sheet for B-ID → site mapping before running
   - `node bin/upload-promo.js --range=B13` etc.

2. **QP2 banner** — ✅ DONE for QP2A (IBC22). Shape confirmed: `site_id`, `promotion_type:0`, `promotion_amount:0` in details. Script: `bin/create-qp2a-rtg.mjs`. QP2B/C/D can be adapted from same script if needed.

3. **WS1/WS2 BIA** — ✅ ALL COMPLETE (saved 2026-05-20)
   - B01 (WS1 MB8): UICarousel 226 (MY) ✅, 28 (TH) ✅, 80 (KH) ✅, 132 (ID) ✅
   - B03 (WS2 RWS77): UICarousel 1 (MY) ✅
   All items: Start=2026-06-07 00:00:00, End=2026-07-12 23:59:59, Enabled=OFF (draft)
   - B02 (Classic MB8) = out of scope (iGMP BO, not Directus — script skips automatically)
   **Images confirmed at:**
   - `Banner/Microgaming Road to Glory/mb8-microgaming-road-to-glory/` (B01 WS1)
   - `Banner/Microgaming Road to Glory/rws77-microgaming-road-to-glory/` (B03 WS2)
   **MY locale = EN only** (UICarousel 226 has only English translation tab; ZH tab does not exist)
   
   ⚠️ **Files field upload — key finding (2026-05-20):**
   - The `Files` field in the UICarousel item drawer is a **many-to-one file relationship** — it has NO `<input type="file">` in the DOM.
   - The `Image` field DOES have a hidden file input (opacity:0) but is **unused** on all live records — do NOT upload there.
   - The `Files` field row shows "No File Selected" with a folder icon (left) and paperclip icon (right).
   - **Correct approach:** Click the row area or paperclip icon → this should open the **Directus file browser modal** → then upload from there. Previous attempt clicked wrong coordinates. In new session: scroll to Files field, get accurate screenshot, click the paperclip button at the right edge of the "No File Selected" row.
   - **Alternative:** Pre-upload images via Directus Files API (`POST /files` with multipart), get file UUID back, then POST to the translation relationship endpoint directly.
   - Browser: `https://cms.best-in-asia.com/admin/content/UICarousel/226` — already on this page, just click "+ Create New" again.

4. **3.3 id response shape** — `createPromotionContent()` returns `id=undefined` (cosmetic bug, content saves OK). Low priority.

5. **fetchDocHtml in sync** — THREE files carry inlined copies: `bin/upload-promo.js` (canonical), `bin/fix-b16-b17-content.mjs`, `bin/create-qp2a-rtg.mjs`. Any pipeline fix must be applied to all three.

## Key files
- `bin/upload-ws1-banners.mjs` — WS1/WS2 Directus UICarousel banner planner + Chrome runbook (BIA platform). Run: `node bin/upload-ws1-banners.mjs --range=B01` (dry-run) or `--live` (needs images). **Does NOT execute Chrome itself — outputs step-by-step runbook for the Claude agent to follow via MCP.**
- `bin/upload-promo.js` — main CLI (written + verified); fetchDocHtml canonical source
- `bin/create-qp2a-rtg.mjs` — one-shot: QP2A (IBC22) EVEMGRTGA 3.3 + 14.2 ✅ already run
- `bin/fix-qpro-evemrtg-tnc.mjs` — QPRO15/16/17 MY_EN T&C ✅ re-runnable
- `bin/fix-qpro-evemrtg-zh-tnc.mjs` — QPRO15/16/17 MY_ZH T&C (Chinese pattern) ✅ re-runnable
- `bin/fix-qpro-evemrtg.mjs` — QPRO15/16/17 category + MY_ZH title/desc/content ✅ re-runnable
- `bin/fix-qp2a-evemgrtga.mjs` — QP2A id=210 promotion_type + :brandname + MY_ZH content ✅ re-runnable
- `bin/fix-qp2a-evemgrtga-zh.mjs` — QP2A id=210 MY_ZH entity decode + ZH T&C ✅ re-runnable
- `bin/fix-b16-b17-content.mjs` — one-shot: re-uploads 3.3 HTML for qpro16/17 (historical; content now correct)
- `bin/compress-banners.mjs` — `sharp`-based image compression: `node bin/compress-banners.mjs <src> <dest>`
- `bin/upload-promo-smoke.js` — single-brand API smoke test
- `src/api-client.js` — `createBanner()`, `createPromotionContent()`, `uploadFile()`
- `src/banner-schedule.js` — schedule row parser, BANNER_BRAND_TO_SITE map, parseBannerIdRange()
- `captures/qpro-3-3-actual-body.md` — confirmed 3.3 POST body
- `captures/qpro-14-2-form-schema.md` — 14.2 form DOM map (banner body now confirmed separately)

## Why: The upload-promo.js is for Jascinta's promo team to batch-upload banners from the Banner Schedule sheet without manual BO work.
