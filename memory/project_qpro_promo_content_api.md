---
name: QPRO 3.3 Promotion Content — API-direct shape captured
description: Wire shapes for POST /api/bo/file (promotions) + POST /api/bo/promotioncontent + /api/bo/banner. Use the helpers in src/api-client.js, not the form-driving skill, for batch operations.
type: project
originSessionId: 44de9df1-3765-407d-9cbf-e86e09b6aeb8
---
Live-captured 2026-05-18 from the QPRO4 SPA via window.fetch interceptor. Codified in `src/api-client.js::uploadFile`, `::createPromotionContent`, `::emptyPromoContentDetail`, `::localToUtcBoDate`. End-to-end verified on QPRO4 — `TEST_API_408318` saved Inactive via pure Node.

## /api/bo/file (multipart)

```
files: <binary>         ← PLURAL, not "file" or "image"
type:  "promotions" | "banners"   ← string discriminator
```

Response: `{ data: { files: [<cdn_url>, ...] } }` — URLs are an ARRAY, even for a single file. Extract via `data.files[0]`.

CDN URLs look like `https://04638c82.quickcdn.org/<type>/<hash>.<ext>`. Pass them through to the create body's `image` (3.3) or `desktop_image` / `mobile_image` (14.2) fields.

## /api/bo/promotioncontent (JSON)

Quirky Laravel-via-Angular shape — these are NOT arrays:
- `category_id`: object `{ "0": <id>, "1": <id>, ... }` (stringified-int keys)
- `content_type`: object `{ "1": true, "2": true }` (1=Desktop, 2=Mobile)
- `details`: object keyed by `settings_locale_id` stringified; **every locale present**, unused ones as all-null stubs

Required scalars:
- `code` (≤15 chars), `member_visibility: 0`, `position`, `apply_action: 0`, `max_application: 0`

Per-locale detail (for filled locales):
- `settings_locale_id` (number, matches the key)
- `title`, `description`, `content`
- `start`, `end`, `publish_at`, `expire_at` — **UTC strings** (SPA converts local→UTC; use `localToUtcBoDate(local, '+08:00')`)
- `image` — CDN URL from /api/bo/file
- 7 more nullable fields: `promotion_type`, `promotion_amount`, `form_title`, `form_content`, `form_button_text`, `main_button_text_before`, `main_button_text_after`

Empty-stub shape (required for every unused locale): see `emptyPromoContentDetail()` in api-client.js.

## /api/bo/banner

Endpoint confirmed via earlier 200 save. **Body shape captured TBD** — rate-limited twice during probe. Inferred fields from the form: `label`, `link`, `start_datetime`, `end_datetime`, `position`, `status`, `session`, `platform_type`, `details: { <locale>: { settings_locale_id, desktop_image, mobile_image } }`. Run the smoke once when rate window resets to lock the shape.

## Rate limiting

QPRO BO has a per-key rate limit (Laravel throttle middleware). Quick succession of POSTs returns:
```
HTTP 422 / 429 — { success: false, message: ["Too Many Request, Please Try Again"] }
```

Add `await new Promise(r => setTimeout(r, 1500))` between consecutive create/upload calls. Don't run more than ~3 multipart uploads + 1 create per ~5 seconds on the same brand.

## QPRO4 locale catalog (sample)

| `settings_locale_id` | Locale |
|---|---|
| 1 | MY_EN |
| 2 | MY_ZH |
| 3 | US_EN |

Other QPRO brands expose more locales (TH_EN, TH_TH, SG_EN, SG_ZH, ID_EN, ID_ID). Discover per brand by reading the form's locale tabs.

## Helpers in src/api-client.js

- `uploadFile(site, fileBuffer, filename, { type, mimeType })` — multipart
- `createPromotionContent(site, body)` — POST /api/bo/promotioncontent
- `createBanner(site, body)` — POST /api/bo/banner
- `emptyPromoContentDetail()` — null-stub for unused locales
- `localToUtcBoDate(local, zone='+08:00')` — convert GMT+8 local to UTC string
- `uploadBannerFile` — backward-compat alias for `uploadFile(.., { type: 'banners' })`

## TEST records on QPRO4 (cleanup at convenience)

| Section | Code / Label | Status |
|---|---|---|
| 3.3 | `TEST_EVMGPUE1` (MCP-driven) | Inactive |
| 3.3 | `TEST_SPY_082745` (spy capture) | Inactive |
| 3.3 | `TEST_API_408318` (API-direct smoke) | Inactive |
| 14.2 | "Microgaming Playboy Ultimate Extravaganza (TEST)" | Inactive |
