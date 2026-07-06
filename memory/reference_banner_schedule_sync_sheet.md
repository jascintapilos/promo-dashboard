---
name: Banner Schedule sync sheet columns
description: Telegram-sync Banner Schedule (sheet 1YqxgQ...) column map — a DIFFERENT sheet from the 16-col B-ID tracker; C=Status, D=Requestor, E=PIC.
metadata:
  type: reference
---

The Telegram banner sync (`bin/telegram-monitor.mjs` → `src/banner-schedule-client.js`) writes to a **separate** Google Sheet from the B-ID upload tracker described in [[Banner Schedule sheet]]. Do NOT reuse the other sheet's 16-column schema here — that is what caused an off-by-one bug (values written one cell to the right; "Bot" landed in PIC).

Sheet: `1YqxgQ0x1KtDgdJd9I7E6dc2Lf24yPKtBKYNrdN4griQ`, tab `Sheet1`. It has **NO** "Promo Drafts Link" column. Confirmed live header row `A1:L1`:

| Col | Header | Value the bot writes |
|---|---|---|
| A | Banner ID | `B27`, `B28`, … |
| B | Banner / Campaign Title | campaign_title |
| C | Status | `Requesting` |
| D | Requestor | `Bot` |
| E | PIC | *(blank — never written for bot rows)* |
| F | Type of Promotion | `Vendor` |
| G | Backoffice / Brand | `UG01` / `UG02` |
| H | Platform / Placement | `Homepage & Promotion` |
| I | Start Date | e.g. `9-Jul-2026` |
| J | End Date | e.g. `16-Jul-2026` |
| K | Banner Link | banner download URL |
| L | T&C Link | T&C URL |

Each event = **2 rows**: UG01 (SBO28) + UG02 (MENANG7). Requestor = `Bot`, PIC left blank.

**Gotcha (fixed 2026-07-06):** the old `COL` map in `banner-schedule-client.js` assumed a hidden "Promo Drafts Link" column C (borrowed from the other sheet), shifting every write +1 — Status→D, Requestor→E(=PIC), Type→G, dates/links all off. `readAllEntries` used the same shifted indices, so read/write round-trips looked self-consistent and hid it. If rows ever look shifted again, dump the live header row (`A1:L1`) and match `COL` + `readAllEntries` to it — never to the other sheet.

**Why:** there are two Banner Schedule sheets with different schemas; conflating them puts values in the wrong cells.
**How to apply:** for telegram-sync writes, C=Status, D=Requestor, E=PIC(blank), F=Type, G=Brand, H=Platform, I=Start, J=End, K=Banner, L=T&C.
