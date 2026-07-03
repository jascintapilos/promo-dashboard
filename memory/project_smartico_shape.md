---
name: Smartico CRM platform — shape and conventions
description: How Smartico organises CRM blasts for QPRO2–19 brands. Different model from FastTrack. Read before any Smartico automation work.
type: project
originSessionId: 36515dff-d876-4de9-9cc3-3c179e62957d
---
**Instance:** `https://drive-6.smartico.ai/24016` (Environment ENV-6, tenant 24016)
**Auth:** WorkOS-like flow. Username + password (separate from Google Workspace creds) **or** Google SSO via "Sign in as Jascinta". 2FA enforced (6-digit code field always on login page).
**Workspace selector:** top-right "Enigma Games/Winnersoft" label dropdown — switches between brand contexts. Same Smartico instance hosts many labels.

## Top-level nav (Marketing tab)

| Section | Item | Route | Role |
|---|---|---|---|
| **Analysis** | Summary dashboard | `#/ld-report-public-marketing/...` | KPI dashboard |
| **Campaigns** | Journey (58 active) | `#/j_audience_head` | Triggered, automated journeys |
| | **Scheduled (178 active)** | `#/j_audience_scheduled` | One-shot or recurring date-time campaigns — **the equivalent of FT WS1 Activities** |
| | Marketing Calendar | `#/marketing_calendar` | Calendar overlay of all campaigns |
| **Automation Rules** | Realtime | `#/j_automation_rules` | Event-driven triggers |
| | Scheduled | `#/j_automation_rules_scheduled` | Scheduled rules |
| **Segmentation** | Segments | `#/j_segment` | Audience builder |
| | RFM Analysis | (Data Studio embed) | RFM cohort tool |

Other top menus exist (Gamification, Tools, CRM, Reports, Label) — not inspected, likely orthogonal to blast workflow.

## Scheduled Campaigns list — columns

`ID | Name | Status | Execution status | Segment | Duration | CG,% | Conv. 30D`

- **ID** is internal (e.g. 2486351), 7-digit auto-increment.
- **Name** convention (different from FT): `<market> - <brand> - (G<n>) <event> + <days>` e.g. `MYS - QPRO8 - (G3) FTD + 25 Days`. `G1`/`G2`/`G3` are group/control variants. `FTD` = First-Time Deposit. The trailing `+ 25 Days` is journey duration.
- **Segment** is a pre-defined named audience like `QPRO8 All Players` or `QPRO6 WYN8 All MYS Players` — NOT a per-batch tag upload (this differs from FT WS1).
- **CG,%** = Control Group percentage (A/B split).
- **Conv. 30D** = 30-day conversion rate.

Filters at top of list: Name/ID search, Status (Draft / Active / Ended / Disabled), Execution status, Category, custom Filter.

## Campaign detail page — 8 tabs

1. **General** — name, status, category (Marketing), scheduling pattern (e.g. Daily, At 10:00).
2. **Flow** — visual flow builder (drag-drop nodes from a left palette into a canvas with timeout/wait/condition logic).
3. **Campaign Tags** — tagging for filtering/reporting.
4. **Stop/Convert Rules** — automatic stop conditions (e.g. on deposit approval) and conversion events.
5. **Batches** — per-execution batches/runs.
6. **Calendar** — when this campaign fires.
7. **Analytics** — performance, with Live view toggle and date range.
8. **Users** (dropdown) — targeted users / per-user delivery state.

Top-right action buttons: **More**, **Ask AI**, **Clone**. **Edit view** toggle on Flow page.

## Flow builder — channel node palette

`COMMUNICATION` section includes:
- Email
- Popup
- Push
- **SMS**
- **WhatsApp** (native — NOT a callback URL like in FT WS1)
- Viber
- Inbox
- IVR Call
- (more below scroll, not enumerated: Post Channel, etc.)

Flow grammar:
- Start → arrow `Timeout` / `Then` / `When happened` → channel node or wait/condition node
- Conditions like `Wait 1d for Acc: Deposit Approved`
- Terminal nodes: `Convert campaign` (conversion event)
- Edge types observed: `Sent`, `Delivered`, `More` (per-channel disposition routing)

## Key contrasts vs FastTrack WS1

| Aspect | FastTrack WS1 (MB8) | Smartico (QPRO2–19) |
|---|---|---|
| Audience model | Tag-based, CSV upload per batch | Pre-built named audience |
| Channel architecture | Linear action chain (SMS → Bonus → Callback) | Visual multi-step flow with branching |
| WhatsApp | Callback URL to llktech gateway; body external | Native channel node, body in Smartico |
| Multi-step logic | None — fires once | Timeout, wait, condition, convert |
| A/B split | Not visible | Built-in `CG,%` control group |
| Activity scope | One-shot blast | Often multi-day journey (e.g. `25 Days`) |
| Naming convention | `<project><market><promo>×<TO>TO<DDMM>` | `<market> - <brand> - (G<n>) <event> + <days>` |
| Sheet → tool input | One sheet tab = one weekly batch | Sheet tabs likely feed segment/audience definitions, not per-batch uploads |

## How sheet → Smartico bridges
**Confirmed by Jascinta (2026-05-15):** the per-week (Player ID, Username) list in the Mimi sheet is **uploaded as a Custom Audience** inside Smartico for each weekly batch. This is symmetric with the FT WS1 model — the sheet's player-list section feeds a per-batch upload on both platforms, just with different terminology:
- FT WS1: CSV → Segment Upload → tags players → Segment filters by tag
- Smartico: CSV → Custom Audience → Scheduled Campaign references that audience

So the sheet-to-tool translation is **uniform on the player-list side** even though the campaign/journey structure differs.

## Not yet inspected
- SMS template content inside a flow node (couldn't open the detail panel via double-click in BO Access browser; Edit view toggled into Live view by mistake)
- Segments list (`#/j_segment`) — audience builder shape and where Custom Audiences are uploaded
- Templates / message library (Tools menu likely)
- Sheet-tab-to-audience-name convention (does the operator type the audience name fresh or paste from sheet?)
