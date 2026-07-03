---
name: WS1 / WS2 platform versions (probed 2026-05-19)
description: CMS and iGMP platform versions for WS1 (MB8) and WS2 (RWS77) found from direct endpoint probing.
type: project
originSessionId: 18ad51ef-d48a-4887-985e-92c697749242
---
## WS1 (MB8)

| System | URL | Platform | Version |
|---|---|---|---|
| CMS — V4 | `https://cms.best-in-asia.com/admin/login` | **Directus** | **10.8.2** |
| Kiosk — Classic V3 | `https://kioskmy.best-in-asia.com/Login#PM` | **iGMP BO** | ASP.NET Core (build hash `QD6qkfm`) |

## WS2 (RWS77)

| System | URL | Platform | Version |
|---|---|---|---|
| CMS | `https://ws2-cms.best-in-asia.com/admin/login` | **Directus** | **10.8.2** |
| Kiosk | `https://ws2-kioskmy.best-in-asia.com/Login` | **iGMP BO** | Same build as WS1 Classic (identical `Index.js` hash) |

## Key findings

- **Directus 10.8.2** — both CMS instances share the same compiled JS bundle (`index.30e68daf.entry.js`). Same deployment.
- **iGMP BO** — ASP.NET Core MVC. WS1 Classic and WS2 share the same `Index.js` hash (`QD6qkfmDCOueeOc`). Same build.
- iGMP product version is **not exposed** via any public-facing endpoint (Cloudflare masks ASP.NET headers). Internal to BIA.
- `/server/info` on Directus returns project config but not version number unauthenticated — version found from JS bundle grep.

## iGMP BO navigation structure (WS1 Classic / WS2)
1. Workbench | 2. Player | 3. Promotion | 4. Marketing | 6. Game | 7. Payment | 8. Report | 9. Others
  - 9.1 CMS ← **banner upload lives here**
  - 9.2 IP Restriction and Whitelist
  - 9.3 User
  - 9.4 Player Membership Settings
  - 9.5 IGMP Announcement
  - 9.6 iGMP Inbox
  - 9.7 System Settings (9.7.1 Message Template, 9.7.2 System Parameter, 9.7.3 SMS Setting, 9.7.4 Notification Driver)

## Banner upload relevance
- **WS1 V4 + WS2 banners** → Directus CMS (REST API available → automatable)
- **WS1 Classic banners** → iGMP 9.1 CMS (MCP/Chrome-driven, no confirmed REST API yet)

## UICarousel IDs — all confirmed ✅ (probed 2026-05-19)

| Brand | Region | CMS | UICarousel id | Notes |
|---|---|---|---|---|
| MB8 | MY | ws1 | **226** | MYS Homepage |
| MB8 | TH | ws1 | **28** | THA Homepage |
| MB8 | ID | ws1 | **132** | IDN Homepage |
| MB8 | KH | ws1 | **80** | KHM Homepage |
| MB8 | SG | ws1 | **54** | SGP Homepage |
| MB8 | AU | ws1 | **227** | AUS Homepage (low usage) |
| MB8 | PH | ws1 | **158** | `mb8 phl home` — lowercase, "home" not "Homepage" |
| RWS77 | MY | ws2 | **1** | Only region for WS2 — `RWS77 MYS Homepage` |

## Banner form schema (WS1 + WS2 identical)

Drawer: "Creating Item in UI Carousel Images"
- **Start Date** / **End Date**
- **Display Condition** — leave blank (default 1; live records have it empty)
- **Translations** → English only (both WS1 MYS and WS2 MYS)
  - **Link URL**: `/promotion/info/<region-prefix>-<kebab-promo-name>` (e.g. `/promotion/info/my-private-island-getaway-raffle`)
  - **CTA Button Text**
  - **Image** — unused; null on all live records
  - **Files** — actual banner image upload
- **Open New Tab** — off
- **Enabled** — OFF (leave for user QC; they click Submit on parent form)

**Banner size:** 1280×320px (confirmed WS1 MYS + WS2 MYS)
**URL slug:** kebab-case of promo name prefixed by region code (`my-` for MYS)
**Full reference:** `captures/ws1-directus-probe-summary.md`
