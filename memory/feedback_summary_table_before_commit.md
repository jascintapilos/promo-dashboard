---
name: Pre-run summary table mandatory before --commit
description: Every batch run must show a per-row summary table (code, names, mechanics, dates) before the live --commit confirmation. No save proceeds without operator seeing and confirming it.
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
Before every live `--commit` run (QPRO, QP2, IGMP), always print a summary table from dry-run output. The operator confirms the table before any POST/PUT hits the BO.

**Why:** Prevents wrong codes, wrong names, wrong mechanics from landing in the BO without review. Caught MIN-suffix issues, promo name format errors, and EffectiveMinutes=1440 before they hit live.

**How to apply:** After `--dry-run` parses fixtures, emit the table. Do not print just "N rows ready — run with --commit?". Always show the table first.

## QPRO / QP2 table columns

| RN | Platform | Brand | Region | Code | Promo Name (EN) | Promo Name (ZH) | Bonus | Min Dep | TO | Max Bonus | Game Categories |

## IGMP (WS1/WS2) table columns

| RN | Brand | Regions | Code | Promo Name (EN) | Promo Name (ZH) | Bonus | Min Dep | TO | Max Bonus | Redeem Limit | EffectiveMinutes | Start | End |

## Notes

- For IGMP, EffectiveMinutes must show in the table (expected value: 1).
- Regions for IGMP are comma-separated (MY, SG, ID, TH, KH) — one row per RN, not per region.
- For QPRO/QP2, one row per platform × RN combination (so P075 on QPRO4 and QP2C each get a row).
- Code column must show the final resolved code including any auto-prefix (VIP_, FT_, GLD_, etc.) and MIN suffix.
- Promo Name must match column M descriptor after mechanics have been stripped.
