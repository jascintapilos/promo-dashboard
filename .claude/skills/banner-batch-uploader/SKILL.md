---
name: banner-batch-uploader
description: Run a batch of banner uploads from the Banner Schedule spreadsheet by Banner Task Number range. Use when the user says "upload B01-B03", "upload B07", "upload B##,B##,B##" or any banner ID range pulled from the Banner Schedule. Reads the schedule, resolves each B-ID's brand → BO site, opens the corresponding BO via Claude-in-Chrome, navigates to the right UICarousel record, and fills a new Images-section drawer in **draft mode (Enabled = off)** so the user QCs and publishes. Covers WS1 (MB8) fully with confirmed carousel IDs; WS2 (RWS77) supported via first-use discovery; QPRO/QP2 brands hand off to the existing qpro-homepage-banner-upload / qp2-homepage-banner-upload skills.
---

# Banner Batch Uploader

Range-based uploader for the iGaming promo team's **Banner Schedule** workflow. One trigger, many B-IDs — the skill reads the schedule, routes each row to the right BO, and fills the per-banner form in draft mode.

## Trigger

User says any of:
- `upload B01-B03` (range)
- `upload B07` (single)
- `upload B01,B03,B07` (comma list)

## Context

- **Schedule source of truth:** Google Sheet `1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E` (gid `1055566688`). 16-column A-P schema in [src/banner-schedule.js](../../../src/banner-schedule.js).
- **BO directory:** Google Sheet `1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68` — lookup BO URLs per brand.
- **Three BO platforms in scope:**
  | Family | Tech | Brands | bo-sites.json |
  |---|---|---|---|
  | QPRO | Angular SPA (custom CMS) | QPRO1–19 | `qpro1`–`qpro19` |
  | QP2 | Angular SPA (custom CMS) | QP2A–D | `ibc22` |
  | **BIA** (Best-in-Asia) | **Directus** | WS1 (MB8), WS1 (Classic MB8), WS2 (RWS77) | `ws1`, `ws1-classic-my`, `ws2` |
- **This skill is the orchestrator.** For QPRO/QP2 brands, it hands off to the existing per-platform banner-upload skills. For BIA brands (the WS1/WS2 family), it drives Directus directly using the field map below.
- **Pilot scope (May 2026):** B01-B30 covers WS1 (MB8), WS1 (Classic MB8), WS2 (RWS77), QPRO1–17, QP2A–D. Classic MB8 is **out of scope** until its kiosk BO is probed.

## Pre-flight

Before touching the BO:
1. Read the schedule via `mcp__d9e74fd6-…-google-drive__read_file_content` with the sheet ID above. Parse the markdown table using the column order in `src/banner-schedule.js` (`SCHEDULE_COLUMN_INDEX`).
2. Resolve the user's range with `parseBannerIdRange()`. Bucket each B-ID via `findByIds()` into found / unsupported / missing.
3. Surface missing and unsupported up front — don't try to plough through. Unsupported means the brand has no `bo-sites.json` entry yet (SBO28, WARUNG18, UG02, MENANG7, QPLY) or is the WS1 Classic MB8 kiosk (out of scope).
4. For each found B-ID, confirm the row's `status` is `QC Completed` — banners in `Banner Requested`, `Pending PSD`, or `Waiting for Translation` are not ready to upload. Surface and skip.
5. Confirm the user has the asset zip ready, or note that you'll prompt per B-ID.
6. **Verify Chrome allowlist.** The `BO Access` Chrome's MCP extension must have allowlisted: `cms.best-in-asia.com` (WS1), `ws2-cms.best-in-asia.com` (WS2 — first-use needs whitelist). QPRO and QP2 hosts are already allowed if those skills work.

## What to gather from the user

Per batch (once):
1. **Asset delivery method** — does the user have one zip per B-ID, one big zip, or a Drive folder?
2. **Confirm draft folder URLs are populated** in column D of the schedule (`Promo Drafts Link`). If a row's column D is blank, ask for the folder URL.

Per B-ID (as needed):
3. **The unzipped banner image(s)** — agent prompts the user to drop the zip when reaching that B-ID. Filename convention varies by project; agent inspects what's in the zip and asks if the mapping is ambiguous.

## BIA platform (WS1 / WS2) — the new bit

Everything below applies to BIA brands. For QPRO/QP2, jump to [Routing](#routing).

### Field map — UICarousel record (top level)

This is the carousel container; one record per (brand × country × placement). The agent does **not** edit these — they're pre-existing. The agent navigates to the right one.

| Field | Type | Notes |
|---|---|---|
| Component Name | text | `<BRAND> <ISO3> Homepage` — naming convention |
| Status | dropdown | top-level on/off; leave alone |
| Mobile Desktop Display | toggle | usually `both` |
| Images | M2M repeater | **agent adds new items here** |

### Field map — Images sub-form (the drawer the agent fills)

Drawer opens on clicking `Create New` under Images. Heading: **"Creating Item in UI Carousel Images"**.

| Field | Type | Source | Agent / User |
|---|---|---|---|
| Start Date | datetime | Schedule col K | **Agent** types `YYYY-MM-DD HH:mm:ss` |
| End Date | datetime | Schedule col L | **Agent** types |
| Display Condition | rule select | leave blank (default) | **Agent** skips |
| Translations → Link URL (per locale) | text | promo doc | **Agent** types `/promotion/info/<region>-<kebab-slug>` |
| Translations → CTA Button Text | text | promo doc, often empty | **Agent** types if specified |
| Translations → Image | file upload | from zip | **Agent** `file_upload` MCP |
| Translations → Files | file upload | **same file as Image** | **Agent** `file_upload` MCP (confirmed same) |
| Open New Tab | toggle | usually off | **Agent** leaves off |
| **Enabled** | toggle | **off** | **Agent leaves OFF — this is the draft / Ready for QC state** |

The agent does NOT click Submit on the parent carousel record — that's the user's QC gate.

### Carousel ID lookup

| Site | Brand | Region | UICarousel id | Items (May 2026) |
|---|---|---|---|---|
| `ws1` | MB8 | MY | **226** | 39 |
| `ws1` | MB8 | TH | **28** | 40 |
| `ws1` | MB8 | ID | **132** | 38 |
| `ws1` | MB8 | KH | **80** | 39 |
| `ws1` | MB8 | SG | **54** | 16 |
| `ws1` | MB8 | AU | **227** | 1 |
| `ws1` | MB8 | PH | TBD | 4 (lowercase `mb8 phl home` — different convention) |
| `ws2` | RWS77 | * | **discover on first use** (see below) |
| `ws1-classic-my` | Classic MB8 | MY | **out of scope May 2026** |

**First-use discovery flow** (run when a (site, brand, region) lacks an ID above):
1. Verify the BO host is in the Chrome extension allowlist; if not, ask user to add it.
2. Navigate to `<site.baseUrl>/admin/content/UICarousel`.
3. Find the row whose Component Name matches `<BRAND> <ISO3> Homepage` (case-insensitive).
4. Click into it; capture the URL `/admin/content/UICarousel/<id>` and record it.
5. Update this skill's lookup table for future runs (manual edit).

### Link URL slug convention

From live MB8 records: `/promotion/info/<region>-<kebab-slug>`.

Examples seen:
- `my-golden-escape-raffle-promo` (MY region, "Golden Escape Raffle Promo")
- Pattern: region prefix → 2-letter lowercase, slug → kebab-case lowercase

**The slug is usually a field on the `promotionData` collection** (which is readable via API). When in doubt, fetch from `<site.baseUrl>/items/promotionData?filter[…]&fields[]=slug` to confirm the slug, OR ask the user.

If the brief gives a slug, use that verbatim. Don't invent slugs from the campaign title without confirmation.

### Workflow — BIA per B-ID

```
1. Resolve b_id → record (brand, region, dates, draft_folder_label, campaign)
2. Resolve brand → site_id via BANNER_BRAND_TO_SITE (src/banner-schedule.js)
3. Resolve (site_id, region) → carousel_id (table above; discover if missing)
4. Resolve draft folder URL: mcp__d9e74fd6-…-google-drive__search_files
     query: title contains '<draft_folder_label>'
   Surface the brief doc; extract slug, CTA, dates if different from schedule.
5. Ask user: drop the zip of compressed banners for <b_id>.
   Unpack; identify per-locale per-size files by filename pattern.
6. Switch to BO Access browser:
     mcp__Claude_in_Chrome__list_connected_browsers
     mcp__Claude_in_Chrome__select_browser <deviceId for "BO Access">
   Create or reuse MCP tab via tabs_context_mcp.
7. Navigate: <site.baseUrl>/admin/content/UICarousel/<carousel_id>
8. Click button with exact text "Create New" inside the Images section:
     const btns = [...document.querySelectorAll('button')].filter(b => (b.textContent||'').trim() === 'Create New');
     btns.find(b => b.getBoundingClientRect().width > 0)?.click()
9. Wait for drawer "Creating Item in UI Carousel Images" to open.
10. Fill drawer fields per locale (see field map above). For each:
    - Start Date / End Date: setNativeValue on the datetime input
    - Translations: switch tab to the right locale, then type Link URL + CTA, file_upload Image + Files (same file)
    - Open New Tab: leave off
    - Enabled: leave OFF
11. Do NOT click Submit. Tell the user: "Drawer filled for <b_id>. Review and Submit on the carousel record."
12. After user confirms Submit, advance to next b_id.
13. After whole batch: tell user to update Banner Schedule column E to `Ready for QC` for each completed b_id.
```

## Tech notes (snippets that work)

### Set Directus / Vue input

```js
const setNativeValue = (el, value) => {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
};
```

### Find input by adjacent label (inside the active drawer)

```js
const drawers = [...document.querySelectorAll('[class*="drawer" i]')];
const widest = drawers.sort((a,b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
const findField = (labelText) => {
  const fields = [...widest.querySelectorAll('.field, .v-form-row')];
  const f = fields.find(x => (x.querySelector('.field-label, label')?.textContent || '').trim().includes(labelText));
  return f ? f.querySelector('input, textarea') : null;
};
// Use: findField('Start Date'), findField('Link URL'), findField('CTA Button Text')
```

### Switch translation locale tab

Translations is a repeater per locale (e.g. `English`). Click the locale's tab in the drawer's translation section.

```js
const localeTabs = [...widest.querySelectorAll('[role="tab"], .nav-link, .v-tab')];
const target = localeTabs.find(t => (t.textContent||'').trim() === 'English');
target?.scrollIntoView({ block: 'center' });
target?.click();
```

For MB8 MYS the locale set is English only — no tab switching needed. Other regions may have more.

### File upload to Files / Image slot

Directus uses a "Drag & Drop a File Here" dropzone backed by a hidden `<input type="file">`. Use MCP `find` to get a ref, then `file_upload` with the absolute Windows path. **Both Image and Files take the SAME image** (confirmed live; uploading to only one is fine but Files is the slot actually consumed by the carousel renderer — populate it; Image is sometimes left null in live records).

### Drawer-close (without saving)

Directus drawers have no Cancel button visible by default. Press Escape:

```js
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
```

This dismisses the topmost drawer.

## Routing

| Brand on schedule (col I) | Action |
|---|---|
| `QPRO1`…`QPRO19` | Hand off to `qpro-homepage-banner-upload` skill — pass brand, locales, draft folder. |
| `QP2A` / `QP2B` / `QP2C` / `QP2D` | Hand off to `qp2-homepage-banner-upload` skill. |
| `WS1 (MB8)` | Use BIA flow above against site `ws1`. |
| `WS1 (Classic MB8)` | **Skip** — out of scope until kiosk BO is probed. Surface as unsupported. |
| `WS2 (RWS77)` | Use BIA flow above against site `ws2`. Discover carousel ID on first use. |
| `SBO28` / `WARUNG18` / `UG02` / `MENANG7` / `QPLY` | **Skip** — BOs known in directory but not yet configured in `bo-sites.json`. Surface as unsupported, point to the relevant BO URL from the [directory sheet](https://docs.google.com/spreadsheets/d/1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68/). |

## Status writeback

After each B-ID's drawer is filled and the user has clicked Submit on the parent carousel record:
- Tell the user to set Banner Schedule col E for that b_id to **`Ready for QC`** (manual edit — the Drive MCP doesn't support cell writes).
- Don't set it to `Uploaded`. `Uploaded` is Jascinta's term for AFTER QC has passed and the banner is published. The skill leaves Enabled OFF so the banner is staged-not-published.

## Division of labor

| Action | Who |
|---|---|
| Read Banner Schedule | Agent (Drive MCP) |
| Parse range + route brands | Agent (in chat) |
| Resolve draft folder URL | Agent (Drive search by label) |
| Read brief doc for slug/CTA | Agent |
| Receive asset zip | User drops in chat |
| Unzip + map files to locales | Agent (in chat) |
| Open BO via Claude-in-Chrome | Agent |
| Navigate to UICarousel record | Agent |
| Click Create New under Images | Agent |
| Fill drawer fields (text, dates, links, CTA) | Agent |
| Upload images via `file_upload` MCP | Agent |
| Leave Enabled = OFF | Agent (default) |
| Click Submit on parent carousel | **User** — never the agent |
| Update Banner Schedule col E | **User** — manual edit |

## Hard rules

- **Never click Submit on the parent carousel.** User QCs first.
- **Always leave Enabled OFF** on new banner items. The Enabled toggle is the gate between "drafted" and "live"; only the user flips it after QC.
- **Never write the password.** For BO logins, the user is expected to be logged in already in the BO Access browser. If they're logged out, prompt them; don't auto-fill the password.
- **Don't probe Directus APIs.** Jascinta's role permissions are tight and aggressive API probing can invalidate the cookie session. DOM-drive only.
- **One B-ID at a time per tab.** Don't open multiple drawers in parallel.

## Gotchas

1. **Domain allowlist** — each Directus host (`cms.best-in-asia.com`, `ws2-cms.best-in-asia.com`) must be in the Claude-in-Chrome extension's allowed sites. First-use of `ws2-cms` will need user-side allowlist.
2. **Session expiry** — if a JS fetch probe fails, don't loop; that's a sign the session is dying. Switch back to DOM-only.
3. **Banner image dimensions** — confirmed MB8 MYS uses **1280×320** per locale (single image per slot, English only). Other MB8 regions TBD; confirm with user once per region.
4. **`promotionData` is readable** via API (`/items/promotionData?...`) — use it to look up the slug for Link URL when the brief is unclear. Fields seen: `promotionCode`, `promotionId`, `promotionName`, `regionCode`, `id`.
5. **No status field per banner item** — there's only `Enabled`. The carousel record has a `Status` field but it controls the whole carousel, not individual banners.

## Reference

- Probe summary: [captures/ws1-directus-probe-summary.md](../../../captures/ws1-directus-probe-summary.md)
- Brand → site map: [src/banner-schedule.js](../../../src/banner-schedule.js) :: `BANNER_BRAND_TO_SITE`
- BO config: [bo-sites.json](../../../bo-sites.json) (sites `ws1`, `ws1-classic-my`, `ws2`)
- Password store: [bo-sites.local.json](../../../bo-sites.local.json) :: `passwords.jascinta`

## When to use this vs. the per-platform skills

- **Single banner, brand explicitly named** ("upload banner to QPRO5", "set up banner on SPADE66") → use `qpro-homepage-banner-upload` or `qp2-homepage-banner-upload` directly.
- **B-ID(s) from the Banner Schedule** ("upload B07", "upload B01-B03") → use this skill. It resolves the brand from the schedule and routes appropriately.
- **Many banners across mixed brands in one go** → this skill is the right entry point; per-brand skills get called as needed.
