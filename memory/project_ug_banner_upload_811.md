---
name: project_ug_banner_upload_811
description: "How to upload a banner on the UG BO (3MPLAY-NS3, SBO28/MENANG7) via module 8.11 Banner Setting — form fields, URLs, and the session-persistence access path."
metadata: 
  node_type: memory
  type: project
  originSessionId: e9a6aabf-a973-47b3-aa38-cd0b0c61a372
---

UG01 (SBO28) + UG02 (MENANG7) share BO host `https://3m-ns3-admin.com/` (3MPLAY-NS3 whitelabel). IDR brands. Login has a CAPTCHA ("Validation" field) so fresh login must always be done by a human — cannot be scripted. See [[project_brand_ecosystem]].

**Access path (current): local session persistence, no AdsPower needed.** `src/ug-session.js` + `bin/ug-login.mjs` + `bin/upload-ug-banner.mjs` use a locally-installed Playwright Chromium (`playwright` already had its browser binary at `~/AppData/Local/ms-playwright/`, no AdsPower/CDP required). First run: `getUgPage({brand})` launches a HEADED browser, waits for a human to log in (poll for dashboard URL/`Welcome Agent` text, up to 10 min), then saves cookies+localStorage via `context.storageState()` plus sessionStorage (captured manually via `page.evaluate` since Playwright's storageState does not include it) to `<brand-lowercase>-session.local.json` at repo root — matches the existing `*.local.json` gitignore rule. Every later run restores that file into a fresh context (`newContext({storageState})` + `context.addInitScript` to replay sessionStorage) and skips the login screen entirely. If the restored session is expired (redirects to `/login`), it auto-falls-back to the headed interactive flow and re-saves. Run `node bin/ug-login.mjs --brand=UG01` (or `UG02`) to seed the session ahead of time; `--force` deletes an existing file first.

**Deprecated access path (AdsPower+CDP):** was used earlier in the same session before switching to the above. AdsPower's Local API (port 50325) proved unreliable — repeated `debug_port` empty responses, "[user_id] is being used by [account] and is not allowed to open" lockouts after GUI-vs-API ownership conflicts, and CDP handshakes timing out after the underlying browser process went stale. Kept only as historical context; do not reintroduce unless the local-Chromium approach breaks.

**Module 8.11 Banner Setting**
- Menu: top nav **8. Website → 8.11 Banner Setting**. Listing URL: `/Website/BannerSetting`. New form: green **New Banner** btn → `/Website/BannerSetting/create/`.
- Form POSTs (multipart) to `/Website/BannerSetting`, method POST, hidden `_token` (Laravel CSRF).

**Create-form fields (name → meaning):**
- `status` (select): Show In Promotion | Pop Up Home Page (BEFORE/AFTER LOGIN) | Inactive | Show In Jackpot | Pop up Deposit Page | Pop up Withdraw Page. Default "Show In Promotion".
- `platform` (select): ALL PLATFORM | APK ONLY | DESKTOP / MOBILE ONLY.
- `language` (select id=sel_lang_banner): Please Choose | Bhs Indonesia | English. Pick language FIRST — drives Event Title + Content labels.
- `title` (text) = Event Title (per language). Required.
- `promo_code` (text, disabled unless) + `no_limit` checkbox id=promoCheckBox = "Generate Promo Code".
- `pop_up_url` (text) = Banner Pop up URL, required (absolute path e.g. `/slug`).
- `sequence` (number, required) — lower shows first.
- `category[]` (multi-select id=sel_category): ALL | Special | Sports | Slots | Casino | Others.
- `img_type` (select): Single | Multiple.
- `date_start` (date, required), `date_until` (date, required), `no_limit` checkbox id=no_limit = "No expired time".
- `bannerImage` (file input id=input-file-now-custom-1) = drag-drop image. **Required size 360x160px** (NOT 360x160 per the Google doc's stray "system prompt" note — live form says 360x160px).
- Content editor: Summernote rich-text. **Misleading names** — `#txtEditor` (`banner_MultipleImgtxtEditor`) is the HIDDEN Multiple-image editor, NOT what you see on screen. The visible "Content (\<language\>)" editor is backed by `#langTxtEditor` (`tc_eng_modal`). Always target whichever textarea's `.note-editor` sibling is actually visible (`offsetParent !== null`), and verify via `summernote('code')` read-back. T&C modal editors (unrelated to the main content box): `tc_otherLang_modal` / `txtEditorEng`.
- Submit: **Create** button.

**Notes / gotchas**
- A Notification popup overlay can auto-open on the dashboard and intercept clicks — dismiss or navigate by URL instead of clicking menu items.
- The left-menu top-level "8. Website" element's innerText contains ALL submenu labels; don't match menu items by container text — use anchor hrefs (`/Website/BannerSetting` etc.).
- Persisted records can have BLANK `pop_up_url` and empty `category[]` despite the form marking both with a required-field asterisk (confirmed on live banner id 20 / B23) — `upload-ug-banner.mjs` supports `--url=` (empty) and `--category=NONE` to replicate that.
- Reference Google doc: `14frPSZ1D87paZjKPPjAdRLFRl2V7pYtqWqaBPAAWGNw`.
