---
name: TBP brand & platform ecosystem
description: Map of the 30+ iGaming brands TBP manages, grouped by wallet/platform family, and which CRM tool each family uses. Use to interpret any sheet that names a brand, project, or WS/QPRO/QP2 code.
type: project
originSessionId: 36515dff-d876-4de9-9cc3-3c179e62957d
---
**Source of truth:** the "Directory" Google Sheet (id `1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68`). Re-read when in doubt — this map can drift.

## Platform families → CRM tool mapping

| Family | Project codes | Brands | CRM tool |
|---|---|---|---|
| Deposit Wallet | WS1, WS2, WS3 | MB8 (V4), MB8 Classic (V3), RWS77, MB8 AU (WS3 — not live) | **FastTrack WS1 & WS2** |
| Transfer Wallet | QPRO1–QPRO19 | BP9 (QPRO1), 12HUAT (QPRO2), BX99 (QPRO3), YE55 (QPRO4), U388 (QPRO5), WYN8 (QPRO6), MBS66 (QPRO7), WILD33 (QPRO8), MINT33 (QPRO9), UO8 (QPRO10), MSB66 (QPRO11, not live), SBO18 (QPRO12), QPRO13/14 (not live), E688 (QPRO15), ED98 (QPRO16), XE38 (QPRO17), Pokies Palace (QPRO18 AU), OzPokies77 (QPRO19 AU) | **FastTrack QPRO1** (BP9 only); **Smartico** for QPRO2 onwards |
| Seamless Wallet — QP2 | QP2A, QP2B, QP2C, QP2D | IBC22, KING333, ACE66, SPADE66 | **FastTrack QP2** |
| Seamless Wallet — other | NX01, NX02, UG01 | WARUNG18, UNTUNG28, SBO28 | varies (Indonesian/Thai/IDR brands) |
| Seamless Wallet — uncoded | (no project code) | NAM889 (THB), IBC9 (IDR) | varies |

## BO URL patterns (so you can identify a brand from a URL)

- `cms.best-in-asia.com` / `kiosk{xx}.best-in-asia.com` → MB8 family (WS1/WS3)
- `ws2-kioskmy.best-in-asia.com` / `ws2-cms.best-in-asia.com` → RWS77 (WS2)
- `bo.mei707.com` → QPRO1 (BP9)
- `qpro{N}bo.mei707.com` → QPRO N (single shared BO host for all QPRO except QPRO1)
- `ibc22.qtp777.com` → QP2 (shared BO host for QP2A–D)
- `manage.happyclub88.com` → NAM889
- `ib9.premium-bo.com` → IBC9
- `bo-wa1.nex2wlb.com` → WARUNG18 (NX01)
- `3m-ns3-admin.com` → SBO28 (UG01)

## CRM tool login URLs (Directory CRM tab)

1. Fastrack WS1 & WS2 — `https://mb8.ft-crm.com/` — WS1/WS2 only
2. Fastrack QPRO1 — `https://alpha-iota-qp1.ft-crm.com/` — QPRO1 only
3. Fastrack QP2 — `https://alpha-iota-qp2.ft-crm.com/v2/` — QP2A–D only
4. Remove Extra Spaces — helper utility, for FT QPRO1/QP2 use
5. Objgen — helper utility, for FT QPRO1/QP2 use
6. JSON Validator — helper utility, for FT QPRO1/QP2 use
7. Smartico — `https://drive-6.smartico.ai/24016#/login` — QPRO2 onwards
8. `https://www.voipl.co/segment.html` — SMS template segment checker
9. `https://freetools.textmagic.com/unicode-detector` — SMS template unicode/non-GSM checker

**Domain patterns:**
- All FT instances use the `.ft-crm.com` domain, one subdomain per project family.
- Smartico is on the `drive-6.smartico.ai` shard with tenant ID `24016`.

## PIC / stakeholder ownership (CRM)

- **PIC for CRM = Claudia:** MB8/WS1, MB8 Classic, WYN8 (QPRO6), WILD33 (QPRO8), 12HUAT (QPRO2), QP2A (IBC22), QP2D (SPADE66), Pokies Palace (QPRO18)
- **PIC for CRM = Ryan:** RWS77 (WS2), BP9 (QPRO1), BX99 (QPRO3), YE55 (QPRO4), U388 (QPRO5), QP2B (KING333), QP2C (ACE66), QPRO9, ZG1, UG01, JK01, JK02, NX01
- **Stakeholders:** Cedric/Abigail, Kien, YH, Angus, Joe, Bryan, Jiaco, Kah Kee, Wei Zhe (Media Buyer)

## How to apply
- When a sheet says "WS1" → it means MB8 brand on the Deposit Wallet platform, CRM is via FastTrack WS1 & WS2 instance.
- When a sheet says "QPRO1" → BP9, FastTrack QPRO1 instance.
- When a sheet says "QPRO2" through "QPRO19" → Smartico (not FastTrack).
- When a sheet says "QP2A/B/C/D" → FastTrack QP2 instance.
- Tools 4–6 (Remove Extra Spaces, Objgen, JSON Validator) only matter for FastTrack QPRO1 and QP2 callback-JSON workflows.
