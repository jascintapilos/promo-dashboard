---
name: project_ug_banner_upload_811
description: "How to upload a banner on the UG BO (3MPLAY-NS3, SBO28/MENANG7) via module 8.11 Banner Setting — form fields, URLs, and the session-persistence access path."
metadata: 
  node_type: memory
  type: project
  originSessionId: e9a6aabf-a973-47b3-aa38-cd0b0c61a372
---

UG01 (SBO28) + UG02 (MENANG7) share BO host `https://3m-ns3-admin.com/` (3MPLAY-NS3 whitelabel). IDR brands. Login has a CAPTCHA ("Validation" field) so fresh login must always be done by a human — cannot be scripted. See [[project_brand_ecosystem]].

**Access path (current): AdsPower Local API + Playwright CDP.** `src/adspower-session.js` + `bin/ug-login.mjs` + `bin/upload-ug-banner.mjs`. Required — a plain local Chromium was tried and rejected: the BO's backend does IP + browser-fingerprint detection tied to the proxy configured per AdsPower profile, so uploads must go through AdsPower, not a vanilla browser. AdsPower owns the proxy, fingerprint, AND the BO login session (cookies persist on AdsPower's side) — the script does **no** local cookie/session storage.

Flow: `startProfile(brandOrId)` → `GET /api/v1/browser/start?user_id=<id>` (reuses via `/browser/active` if the GUI already has it open) → `chromium.connectOverCDP(ws.puppeteer)` → drive the page → `stopProfile(userId)` → `GET /api/v1/browser/stop?user_id=<id>` (closes + syncs AdsPower's cloud data). `startProfile` retries through the failure modes hit in practice: cold-API "server not working well" hiccups, "[id] is being used by [account]" GUI-lock (falls back to `/browser/active`), and stale CDP endpoints from a crashed/closed browser (does one stop+start cycle). If the BO session inside a profile has expired, a human must log in once inside that AdsPower browser window (password + CAPTCHA — not scriptable); AdsPower remembers it after that. `node bin/ug-login.mjs --brand=UG01` opens/warms a profile and waits (up to 10 min) for that manual login if needed, then reports back.

Profile IDs: `BRAND_PROFILES` in `src/adspower-session.js` maps brand → AdsPower `user_id`. Known: `UG01` (SBO28) = `k1bt9w43` ("[AI] Gabrielle Tiffany", agent login `gaby`). **UG02 (MENANG7) profile id not yet captured** — pass `--profile=<id>` directly or add it to the map / an `adspower-profiles.local.json` override once known.

**Rejected approach — local Chromium + saved storageState:** briefly built (would have used `context.storageState()` + manual sessionStorage capture) but does not satisfy the IP/fingerprint requirement above — a local browser hits the BO from the VDI's own IP/fingerprint, not the profile's proxy, and would fail (or get flagged) regardless of valid cookies. Do not reintroduce.

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
