---
name: banner-batch-uploader
description: Run a batch of banner uploads from the Banner Schedule spreadsheet by Banner Task Number range. Use when the user says "upload B01-B03", "upload B07", "upload B##,B##,B##" or any banner ID range pulled from the Banner Schedule. Reads the schedule, resolves each B-ID's brand → BO site. WS1/WS2 (BIA/Directus) uses the API-direct script bin/upload-ws1-banners-api.mjs (promo_testbot credentials, no Chrome needed). QPRO/QP2 brands hand off to the existing qpro-homepage-banner-upload / qp2-homepage-banner-upload skills.
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

## QPRO / QP2 platform — API-direct

For QPRO1–19 and QP2A–D use **`bin/upload-promo.js`** — same pipeline as WS1/WS2 but posting to the QPRO/QP2 BO API (`/api/bo/banner`). Credentials from `bo-sites.local.json`.

### Quick commands

```bash
# Dry-run — shows plan, no BO writes
node bin/upload-promo.js --range=B16

# Commit — uploads images + creates 14.2 banner + links 3.3 content
node bin/upload-promo.js --range=B16 --commit

# Skip 3.3 content creation (banner only, promo already exists)
node bin/upload-promo.js --range=B16 --commit --skip-content
```

### Workflow — QPRO/QP2 per B-ID

Same 5-step flow as BIA:

```
Step 1 — Confirm images staged in Banner/{brand}-{campaign}/
Step 2 — Dry-run:  node bin/upload-promo.js --range=<B-ID>
Step 3 — /banner-pre-qc <B-ID>  (visual + plan check)
Step 3.5 — Compress: node bin/compress-banners.mjs Banner/{folder} Banner/{folder}-min
Step 4 — Commit:   node bin/upload-promo.js --range=<B-ID> --commit
Step 5 — /banner-deep-qc <B-ID>
```

---

## BIA platform (WS1 / WS2) — API-direct

For BIA brands (WS1/WS2) use **`bin/upload-ws1-banners-api.mjs`** — fully automated via Directus REST API using `promo_testbot` credentials from `cms-creds.local.json`. No Chrome/browser required. Permissions verified 2026-06-25: POST /files + POST /items/UICarousel_images + POST /items/UICarousel_images_translations all succeed.

### Quick commands

```bash
# Dry-run (default) — shows plan, resolves images, no writes
node bin/upload-ws1-banners-api.mjs --range=B50

# Commit — uploads images + creates Directus records
node bin/upload-ws1-banners-api.mjs --range=B50 --commit

# Custom CTA, test tag
node bin/upload-ws1-banners-api.mjs --range=B50 --commit --cta="Claim Now" --tag=TEST

# Override image folder (bypass Banner/ detection)
node bin/upload-ws1-banners-api.mjs --range=B50 --commit --image-dir="C:\path\to\images"
```

### Image staging (before --commit)

Images must be in `Banner/{mb8|rws77}-{campaign}/` or a subfolder.
Filename pattern: `mb8-{desc}-{region}-{locale}.jpg` e.g. `mb8-campaign-my-en.jpg`, `mb8-campaign-my-zh.jpg`.
For desktop/mobile split: suffix with `-up-` (desktop 1920×) and `-mup-` (mobile 960×).
If only one file per locale, it's used for both desktop (`image` field) and mobile (`files` field).

### What the script does on --commit

1. Reads Banner Schedule tab (current month, auto-detected)
2. Discovers images in `Banner/{brand}-*/` by region-locale suffix
3. For each region:
   - `POST /files` → uploads desktop image → UUID
   - `POST /files` → uploads mobile image → UUID (or same if no separate mobile)
   - `POST /items/UICarousel_images` → creates slide row (dates, carousel FK)
   - `POST /items/UICarousel_images_translations` per locale → links image UUIDs + linkUrl + CTA
4. Writes QC bundle to `captures/banner-qc-bundles/{b_id}__{site}__{region}.json`

### After commit

- Verify in Directus CMS that records appear in the carousel's Images section
- Check start/end dates and link URL are correct
- **Activate the carousel item** when ready for production (toggle Enabled ON in Directus admin)
- Run `/banner-deep-qc B##` for post-upload QC

For QPRO/QP2, jump to [Routing](#routing).

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

### Workflow — BIA per B-ID (API-direct)

**Run every step in order. Do not skip or reorder.**

```
Step 1 — Confirm images are staged
  Images must be in Banner/{mb8|rws77}-{campaign}/ (flat folder, no subfolders).
  Filename pattern: {brand}-{desc}-{size}px-{locale}.jpg  e.g. mb8-dream-vacation-1280x320px-en.jpg
  If missing: run pull-banner-from-clickup first, or tell user to stage them manually.

Step 2 — Dry-run (no writes)
  node bin/upload-ws1-banners-api.mjs --range=<B-ID>
  Check output: all images ✔, regions/carousel IDs correct, dates match schedule, linkUrl slug right.
  Note the folder name printed on the "[images] folder:" line — you'll need it for Step 3.5.

Step 3 — /banner-pre-qc <B-ID>
  Spawn /banner-pre-qc. It visually inspects each staged image (brand identity + locale language)
  and validates dates, position, and the linked canary promo plan.
  → PASS or WARNING: proceed to Step 3.5.
  → FAIL: stop. Fix the flagged issue (wrong creative, missing locale, bad dates) before continuing.

Step 3.5 — Compress images (AUTOMATED — run this yourself, do not ask the user)
  Determine the raw staging folder from Step 2's "[images] folder:" output, e.g. mb8-dream-vacation-raffle.
  Then run:
    node bin/compress-banners.mjs "Banner/<raw-folder>" "Banner/<raw-folder>-min"
  Example:
    node bin/compress-banners.mjs "Banner/mb8-dream-vacation-raffle" "Banner/mb8-dream-vacation-raffle-min"
  The upload script auto-selects the -min folder in Step 4 — no flag needed.
  Wait for the compression summary (file sizes + %) before continuing.
  If compress-banners.mjs exits with "No JPG/PNG files found": the raw folder has a subfolder —
  descend one level and adjust the src path accordingly.

Step 4 — Commit upload
  node bin/upload-ws1-banners-api.mjs --range=<B-ID> --commit
  The script picks up Banner/<raw-folder>-min/ automatically (prefers -min over raw folder).
  QC bundles written to captures/banner-qc-bundles/{b_id}__{site}__{region}.json

Step 5 — Post-upload verification
  Run /banner-deep-qc <B-ID> — verifies what actually landed in Directus.
  Tell user to activate the carousel item in Directus admin (toggle Enabled ON) when ready for production.
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

| Brand on schedule (col I) | Script | Notes |
|---|---|---|
| `QPRO1`…`QPRO19` | `node bin/upload-promo.js --range=<B-ID>` | API-direct via `/api/bo/banner`. No Chrome needed. |
| `QP2A` / `QP2B` / `QP2C` / `QP2D` | `node bin/upload-promo.js --range=<B-ID>` | Same script — recognises QP2 site IDs (ibc22, king333, ace66, spade66). |
| `WS1 (MB8)` | `node bin/upload-ws1-banners-api.mjs --range=<B-ID>` | Directus API via `cms-creds.local.json`. |
| `WS2 (RWS77)` | `node bin/upload-ws1-banners-api.mjs --range=<B-ID>` | Same Directus script against `ws2`. |
| `WS1 (Classic MB8)` | **Skip** | Out of scope until kiosk BO is probed. |
| `SBO28` / `WARUNG18` / `UG02` / `MENANG7` / `QPLY` | **Skip** | Not yet configured in `bo-sites.json`. Surface as unsupported. |

**Do NOT use the Anthropic `qpro-homepage-banner-upload` or `qp2-homepage-banner-upload` skills** — those drive the BO via Chrome and are not wired to this project's pipeline. `upload-promo.js` is the correct API-direct path for all QPRO and QP2 banner uploads.

## Status writeback

After each B-ID's drawer is filled and the user has clicked Submit on the parent carousel record:
- Tell the user to set Banner Schedule col E for that b_id to **`Ready for QC`** (manual edit — the Drive MCP doesn't support cell writes).
- Don't set it to `Uploaded`. `Uploaded` is Jascinta's term for AFTER QC has passed and the banner is published. The skill leaves Enabled OFF so the banner is staged-not-published.

## Division of labor

| Action | Who |
|---|---|
| Read Banner Schedule | Script (Sheets API) |
| Parse range + route brands | Script |
| Stage images in Banner/{brand}-{campaign}/ | **User** (or pull-banner-from-clickup) |
| Dry-run to verify plan | Agent (runs script) |
| Pre-QC visual + plan check | Agent (/banner-pre-qc) |
| Compress images to -min folder | **Agent** (runs compress-banners.mjs automatically after PASS) |
| Commit upload via Directus API | Agent (runs script with --commit) |
| Verify records in Directus admin | **User** |
| Activate carousel item (Enabled ON) | **User** — after QC |
| Update Banner Schedule col E to "Ready for QC" | **User** — manual edit |
| Post-upload QC | Agent (/banner-deep-qc) |

## Hard rules

- **WS1/WS2: always use `upload-ws1-banners-api.mjs`.** Never drive Directus via Chrome MCP for WS1/WS2 — the API-direct script is faster, deterministic, and leaves an audit trail (QC bundles).
- **Stage images first, then commit.** Always run dry-run (`--range=B##`) first to confirm all images are found before running `--commit`.
- **Never write the CMS password in chat.** Credentials live in `cms-creds.local.json` only.
- **QPRO/QP2: hand off to the per-platform skills.** Don't use this script for QPRO or QP2 banners.
- **One B-ID range at a time.** Don't commit multiple unrelated campaigns in one command — keeps QC bundles clean.

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
