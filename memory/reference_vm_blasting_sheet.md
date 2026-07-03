---
name: VM Workflow - Blasting 2026 sheet pointer
description: Pointer to Mimi's weekly VM blast plan workbook for MB8 (WS1). Source-of-truth for the FastTrack WS1/WS2 blast pipeline — bonus codes, SMS/WA copy, campaign IDs, player segments.
type: reference
originSessionId: 36515dff-d876-4de9-9cc3-3c179e62957d
---
**File:** `VM Workflow - Blasting 2026`
**ID:** `1apxqld9fvSxIInym8hRK1KBoHV5qgJcVDJW5RUGPfhE`
**URL:** https://docs.google.com/spreadsheets/d/1apxqld9fvSxIInym8hRK1KBoHV5qgJcVDJW5RUGPfhE/edit
**Owner:** vun.mimi@seahubasia.com
**Scope:** This single workbook is the **source of truth for all VM blast tasks**, spanning multiple platforms:
- **WS1 (MB8) + WS2 (RWS77) tabs** → configured in **FastTrack WS1/WS2** instance
- **QPRO2 through QPRO19 tabs** → configured in **Smartico**
- (QPRO1 → FastTrack QPRO1 — likely a separate sheet or tab set, to confirm)

## Tab pattern
Per-batch tab named `( <MARKET> ) WS<N> - <DD/MM>` (e.g. `( MY ) WS1 - 19/02`). Tab inventory not yet enumerated — XLSX export was over 10 MB so full tab list requires browser access. Each tab is one weekly blast batch.

## Layout inside a tab (NOT a flat row-per-campaign table)
- **Top — campaign directory:** campaigns sit side-by-side as columns. Each campaign has a Bonus Code, a Campaign ID (FastTrack), an SMS body row, and a WA body row.
- **Bottom — player segments:** under each campaign column, a (Player ID, Username) list. The Username column is what the FastTrack Segments uploader consumes.

## Bonus Code grammar
`FT_VM_<type>_<details>` where:
- `FT` = FastTrack platform
- `VM` = VIP Manager segment
- `DEP<X>_GET<Y>_<N>X` = deposit X, get Y, turnover N×
- `FC_VARIABLE_<N>X` = free credit, turnover N×, amount appended as ` - <CCY> <amt>`

## Campaign ID grammar
`<BRAND2><MARKET2><DDMM>V<N>` — e.g. `MBMY1902V1` = MB8 / MY / Feb 19 / variant 1.

**Confirmed by Jascinta (2026-05-12):** The sheet's `CAMPAIGN ID` value IS pasted into FT as the Segment Name and Activity Name when the operator creates them. Some live FT segments use a different-looking format (e.g. `WS1SGFC388×8TO1105` for the 11/05 batch) — likely a later convention shift that may also exist in newer sheet tabs.

## Known gaps in the sheet (no column for):
- send time (only date in tab name)
- currency filter value (derivable from market, not written)
- language tag
- callback JSON body
- promo / TO validity dates
- task status, approver, blast owner
- per-campaign player count
- duplicate-check across campaigns

## Downstream pipeline (mapped to my skills)
1. CSV bundling per campaign — `vm-blasting-csv-bundler`
2. Upload to FastTrack Segments — `vm-blasting-fasttrack-uploader`
3. Add `Currency = <derived>` filter — `vm-blasting-currency-setup`
4. Build Activity skeleton (date/time, callback shell) — `vm-blasting-activity-setup`
5. Manual: paste BO callback JSON, activate blast.

## WA blasting — out of CRM team scope
The team's responsibility for WA is **only setting up the WhatsApp callback URL** inside the Activity (URL pattern: `https://fasttrack-crm-gateway.llktech-solutions.com/whatsappcallback/<activity-name>/<player_id>`). The actual WhatsApp blast — composing/sending the WA message — is handled by a **separate PIC** whom the CRM operator informs after the Activity is set up. So: WA body never has to live in FT or be automated from this sheet; just the callback wiring.

## Platform-specific notes
- **Smartico (QPRO2–QPRO19)** uses **different login credentials** from the Google Workspace SSO. The `jascinta.pilos@thebrandingpeople.co` / `Jcalpha123!` pair does not work for Smartico. Smartico has its own username + password, plus optional "Sign in with Google" and "Sign in with Microsoft" buttons.
