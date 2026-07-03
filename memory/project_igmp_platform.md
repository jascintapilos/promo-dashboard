---
name: IGMP platform — WS1/WS2 BO ecosystem
description: IGMP is the internal name for the WS1/WS2 kiosk + CMS Back Office stack on best-in-asia.com. Covers WS1 V3 (per-country), WS1 V4 (unified CMS), and WS2.
type: project
originSessionId: 6d96aa3d-b24f-4c40-a2b1-d13f6bfa019d
---
"IGMP" is Jascinta's name for the WS1/WS2 BO platform (the `best-in-asia.com` stack). Brands and BO URLs (from Directory → BO & Brands):

**WS1 V4 (MB8, unified)**
- Single BO: https://cms.best-in-asia.com/admin/login — handles MY/SG/ID/TH/KH
- Website: https://mb8mys.net (et al)

**WS1 V3 (MB8 Classic, per-country) — PROMO CODE AUTOMATION SCOPE**
- MY: https://kioskmy.best-in-asia.com/Login#PM — http://classic.mb8mys.com
- SG: https://kiosksg.best-in-asia.com/ — https://classic.mb8sgs1.com
- ID: https://kioskid.best-in-asia.com/ — https://classic.mb8ids1.com
- TH: https://kioskth.best-in-asia.com/ — https://classic.mb8th.com
- KH: https://kioskkh.best-in-asia.com/ — https://classic.mb8smart.net

**WS2 (RWS77)**
- Promo code BO: https://ws2-kioskmy.best-in-asia.com/Login
- Banner CMS: https://ws2-cms.best-in-asia.com/admin/login
- Website: https://rws77.com

**WS3 (MB8 AUD)** — `kioskau.best-in-asia.com` — not live, out of scope.

**FastTrack (CRM):** https://mb8.ft-crm.com/ — shared for WS1 + WS2.

## Current automation status (2026-05-19)
None. Scoping promo-code automation across V3 kiosk BOs + WS2 kiosk BO for the 3 bonus types (Deposit, FC, FS). API shapes not yet captured. Mirrors the QPRO/QP2 API-direct approach.

## How to apply
- Any IGMP / WS1 / WS2 / MB8 / RWS77 promo task → start here for BO URL.
- WS1 V4 (cms.best-in-asia.com) is a separate BO with a separate API surface — don't assume V3 captures apply.
- Per-country V3 BOs are likely the same software with different deployments; expect uniform API shapes, but verify per locale.
