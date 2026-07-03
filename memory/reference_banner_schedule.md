---
name: Banner Schedule sheet
description: Source of truth for banner upload tasks (B-IDs) — one row per brand-locale-campaign.
type: reference
originSessionId: 44de9df1-3765-407d-9cbf-e86e09b6aeb8
---
Google Sheets ID `1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E` (gid `1055566688`). 16-column schema A through P:

| Col | Header (actual) | Logical name |
|---|---|---|
| A | No. | section_no (groups B-IDs per campaign) |
| B | Banner Task Number | b_id (`B01`, `B02`, … — trigger key) |
| C | Banner / Campaign Title | campaign |
| D | Promo Drafts Link | draft_folder_label (hyperlink stripped — see gotcha) |
| E | Status | status (workflow state) |
| F | Region | regions (CSV: MY, TH, KH, ID, SG, AU) |
| G | Requestor | requestor_class (`Vendor (External)` / `In-house (Internal)`) |
| H | Type of Promotion | promo_type |
| I | Backoffice / Brand | brand (routes to upload skill via `BANNER_BRAND_TO_SITE`) |
| J | Platform / Placement | placement (`Homepage & Promotion Page`, `Homepage Banner`, etc.) |
| K | Start Date | start_date |
| L | End Date | end_date |
| M | Banner Request Submission Date | submitted_at |
| N | Banner Requested By | requested_by (Alysa / Jascinta / Joel / Khaswini / Michelle) |
| O | Banner Ready Date | ready_by |
| P | Remarks / Notes | notes |

**Status workflow:** Banner Requested → QC Completed → Uploaded (plus side states: Pending PSD, Waiting for Translation). Jascinta's local convention after agent upload: set status to `Ready for QC` and leave BO entry in **Draft** mode for her to review.

**Gotcha — column D hyperlinks:** The "Promo Drafts Link" cell is a hyperlinked label like `[MB8] Playtech x MB8 Free Spin Challenge` — the underlying Drive folder URL is **stripped** when read via Drive MCP `read_file_content`. To resolve, search Drive by the label text via `search_files` with `title contains '[MB8] Playtech x MB8 Free Spin Challenge'`.

**Brand mapping:** lives in `src/banner-schedule.js::BANNER_BRAND_TO_SITE`. Spreads `BRAND_TO_SITE` from `src/ingest.js` (QPRO/QP2) and adds:
- `WS1 (MB8)` → site `ws1` (platform `bia`)
- `WS1 (Classic MB8)` → site `ws1-classic-my` (platform `bia`)
- `WS2 (RWS77)` → site `ws2` (platform `bia`)

Brands with directory entries but no `bo-sites.json` config yet: SBO28, WARUNG18, UG02, MENANG7, QPLY. `lookupBrand` returns a `.note` for these instead of silent null.
