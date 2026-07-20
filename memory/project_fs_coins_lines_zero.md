---
name: project_fs_coins_lines_zero
description: "PTI + PP FS Coins/Lines = 0 is QPRO/QP2-specific; IGMP uses AmountPerBet/AmountPerLine instead"
metadata:
  type: project
---

For QPRO and QP2 FS saves (Playtech PTI + Pragmatic Play PP), `Coins` and `Lines` are both set to `0`. This is confirmed correct as of 2026-07-13.

**IGMP (WS1/WS2) is NOT affected.** iGMP's `AddFreeSpinReward` endpoint uses dollar-value fields instead:
- `FreeSpin.AmountPerBet` — bet amount per spin in the site currency
- `FreeSpin.AmountPerLine` — amount per payline

`Coins` and `Lines` are Playtech/QPRO2-QP2 API concepts and do not exist in iGMP's API contract. `src/api-mapper-igmp.js` correctly uses `AmountPerBet`/`AmountPerLine` and has no `Coins`/`Lines` fields.

**Why:** Confirmed by reading `buildAddFreeSpin` in `src/api-mapper-igmp.js` (2026-07-20). No captures exist for IGMP FS saves yet, but the field names follow the BO dropdown/form shape captured during 2026-05-19 API discovery.

**How to apply:** When reviewing IGMP FS saves via Sentinel or pre-QC, do not flag `Coins`/`Lines` as missing — they are intentionally absent. For QPRO/QP2 FS saves, `Coins=0, Lines=0` is correct.
