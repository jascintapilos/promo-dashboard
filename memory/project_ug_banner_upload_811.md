---
name: project_ug_banner_upload_811
description: "How to upload a banner on the UG BO (3MPLAY-NS3, SBO28/MENANG7) via module 8.11 Banner Setting — form fields, URLs, and the AdsPower+Playwright access path."
metadata: 
  node_type: memory
  type: project
  originSessionId: e9a6aabf-a973-47b3-aa38-cd0b0c61a372
---

UG01 (SBO28) + UG02 (MENANG7) share BO host `https://3m-ns3-admin.com/` (3MPLAY-NS3 whitelabel). IDR brands. Login has a CAPTCHA ("Validation" field) so fresh login must be done by a human. See [[project_brand_ecosystem]].

**Access path that works (no CAPTCHA):** the AdsPower profile "[AI] Gabrielle Tiffany" (user_id `k1bt9w43`) carries a live BO session. Launch AdsPower app → log into AdsPower account + enable Local API (port 50325) → `GET http://127.0.0.1:50325/api/v1/browser/start?user_id=k1bt9w43` returns a CDP endpoint (e.g. `ws://127.0.0.1:<port>`). Connect Playwright via `chromium.connectOverCDP('http://127.0.0.1:<port>')`, reuse `contexts()[0].pages()[0]`, and drive the already-authenticated session. Project has `playwright` installed.

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
- Content editor: Summernote rich-text; hidden textarea `banner_MultipleImgtxtEditor` id=txtEditor (per-language content). Use `</>` code view to paste HTML. T&C modal editors: `tc_eng_modal`, `tc_otherLang_modal`.
- Submit: **Create** button.

**Notes / gotchas**
- A Notification popup overlay can auto-open on the dashboard and intercept clicks — dismiss or navigate by URL instead of clicking menu items.
- The left-menu top-level "8. Website" element's innerText contains ALL submenu labels; don't match menu items by container text — use anchor hrefs (`/Website/BannerSetting` etc.).
- Reference Google doc: `14frPSZ1D87paZjKPPjAdRLFRl2V7pYtqWqaBPAAWGNw`.
