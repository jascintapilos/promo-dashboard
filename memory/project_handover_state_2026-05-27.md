---
name: handover-state-promo-canary-2026-05-27-current
description: "End-of-day snapshot superseding 2026-05-20. P106-P121 fully complete across QP2A, QPRO2/6/8, WS1 MY+SG. New QC rule added. Read this first when picking up."
metadata: 
  node_type: memory
  type: project
  originSessionId: 39cc7bb6-4a30-4216-9730-1f49e46c330b
---

## The operator workflow (unchanged)

```
node bin/ingest-requests.js                           # 1. ALWAYS first
node bin/resolve-refer-source.mjs P###-rNN --commit   # 2. If "Pls refer" or sparse fixture
node bin/canary-multi-brand.js P### --commit          # 3. Run on all brands
# After save — QC all platforms in scope:
# - BO config, MT, WS1 reward T&C, Dialog — all brands × all regions
```

## What's automated end-to-end (additions since 2026-05-20)

Everything from 2026-05-20 handover still holds. Additions:

| Capability | Status |
|---|---|
| P106–P121 MT bodies (streak/congrats/Pick Your Boost) — QP2A + QPRO2/6/8 | ✅ DONE 2026-05-27 |
| P106–P115 WS1 reward tab T&C amended (MY + SG) | ✅ DONE 2026-05-27 |
| Fix script: `bin/fix-p106-p121-message-templates.mjs` | ✅ available |
| Fix script: `bin/fix-ws1-reward-tnc-p106-p115.mjs` | ✅ available |

## What needs manual operator action (unchanged from 2026-05-20)

- Inbox refer with code (`Pls refer X inbox code PROMOTIONS.MESSAGE.<NAME>`) — one-off script per promo
- Cashback — no T&Cs; operator handoff prompt
- TH locale — body renderer skips silently
- QPRO redo after archive — bump suffix or change campaign portion
- Blacklist Template sub-category linkage — manual via BO UI; bot handles Layer-1 provider exclusions only

## P106–P121 save state (COMPLETE)

### QP2A (IBC22) + QPRO2/6/8

| P# | Group | Bonus | QP2A tmpl | QPRO2 | QPRO6 | QPRO8 | MT status |
|---|---|---|---|---|---|---|---|
| P106 | A | FS | 1065 | — | — | — | ✅ streak |
| P107 | A | FC | 1066 | — | — | — | ✅ streak |
| P108 | A | FS | 1067 | — | — | — | ✅ streak |
| P109 | A | FC | 1068 | — | — | — | ✅ streak |
| P110 | B | FC | 1069 | — | — | — | ✅ congrats |
| P111 | B | FC | 1070 | — | — | — | ✅ congrats |
| P112 | C | Dep | 1071 | — | — | — | ✅ Pick Your Boost |
| P113 | C | Dep | 1072 | — | — | — | ✅ Pick Your Boost |
| P114 | C | Dep | 1073 | — | — | — | ✅ Pick Your Boost |
| P115 | C | Dep | 1074 | — | — | — | ✅ Pick Your Boost |
| P116 | D | Dep | — | 400 | 529 | 571 | ✅ Pick Your Boost |
| P117 | D | Dep | — | 401 | 530 | 572 | ✅ Pick Your Boost |
| P118 | D | Dep | — | 402 | 531 | 573 | ✅ Pick Your Boost |
| P119 | D | Dep | — | 403 | 532 | 574 | ✅ Pick Your Boost |
| P120 | D | Dep | — | 404 | 533 | 575 | ✅ Pick Your Boost |
| P121 | D | Dep | — | 405 | 534 | 576 | ✅ Pick Your Boost |

### WS1 reward T&C (P106–P115 only; P116–P121 not on WS1)

| P# | WS1 MY rewardIds | WS1 SG rewardIds | T&C status |
|---|---|---|---|
| P106 | 14592/14593/14594 | 12440/12441/12442 | ✅ streak |
| P107 | 14595/14596/14597 | 12443/12444/12445 | ✅ streak |
| P108 | 14598/14599/14600 | 12446/12447/12448 | ✅ streak |
| P109 | 14601/14602/14603 | 12449/12450/12451 | ✅ streak |
| P110 | 14604 | 12452 | ✅ congrats |
| P111 | 14605 | 12453 | ✅ congrats |
| P112 | 14606 | 12454 | ✅ Pick Your Boost (MYR30/SGD50 minDep) |
| P113 | 14607 | 12455 | ✅ Pick Your Boost |
| P114 | 14608 | 12456 | ✅ Pick Your Boost |
| P115 | 14609 | 12457 | ✅ Pick Your Boost |

## WS1 reward T&C technical notes (NEW 2026-05-27)

- Reward contents endpoint: `POST /PM/GetPromotionRewardContents { RewardId }`
- Update endpoint: `POST /PM/BulkAddorUpdatePromotionRewardContents { RewardId, PromotionRewardContents: [{RewardId, Locale:'en'|'zh', Content}] }`
- RewardId obtained: FS→`/PM/GetFreeSpinPromotionInfo`, FC→`/PM/GetFreeCreditInfo` (rewards at `data.Promotion.PromotionRewards`), Dep→`/PM/GetBonusInfo`
- Injection point: split existing HTML at `</h4><h4` (always exactly one — between summary table h4 and T&C h4)
- TnC link format: `mb8mys.com/{lang}/info-center/tnc` (MY), `mb8sg.com/{lang}/info-center/tnc` (SG)
- WS1 NM module (`/NM/GetTemplates`) is NOT used for promo-specific inbox — that's a separate general notification system

## Known edge cases (carry-forward from 2026-05-20 + additions)

All 20 from 2026-05-20 handover carry forward. Additions:

21. **WS1 reward T&C lives in `PromotionRewardContents`, not NM inbox.** The NM module (`#NM/Inbox`, `/NM/GetTemplates`) is for general platform notifications, not promo-specific content. Promo-level T&C text is in `PromotionRewardContents` under the reward row.
22. **WS1 GetPromotionInfoByCode returns empty `PromotionRewards: []`.** Must call type-specific endpoint (`GetFreeCreditInfo`/`GetFreeSpinPromotionInfo`/`GetBonusInfo`) to get reward IDs. FC rewards path is `data.Promotion.PromotionRewards` (nested under Promotion object).
23. **P112 minDep differs by site: MYR 30 (MY) vs SGD 50 (SG).** `per_currency_overrides` in fixture has `MYR.min_deposit` and `SGD.min_deposit` — always use site-specific values when building WS1 content.

## Open items / carryover

- Task #11: Add SGD currency to P113-P115 QP2A via BO UI — still in-progress
- P069/P070: MYR-only on QPRO4–17 (soft-deleted SGD/IDR rows) — operator decided BO UI fix, not automated
- TEST_* accumulation: run `bin/deactivate-test-promos.mjs` periodically
