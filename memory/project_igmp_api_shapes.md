---
name: IGMP API shapes (WS1 V3 MY) — Deposit/FC/FS create + edit endpoints
description: Captured wire shapes for /PM/AddBonus + /PM/AddFreeCredit + /PM/AddFreeSpin (and the multi-call FS orchestration). Resolves field formats, enums, and cross-cutting questions (dates, times, days, shift, CSRF).
type: project
originSessionId: 6d96aa3d-b24f-4c40-a2b1-d13f6bfa019d
---
# IGMP API surface — verified 2026-05-20 (all 3 types live-tested)

Captured against **kioskmy.best-in-asia.com** (WS1 V3 MY). Captures saved under `captures/igmp/ws1-v3/MY/{deposit-bonus,free-credit,free-spin}/`.

## Endpoint matrix (3 bonus types)

| Menu | Create endpoint | Style |
|---|---|---|
| 3.1 Deposit Bonus | `POST /PM/AddBonus` | **Single-shot** — full payload incl. rewards + locale T&C |
| 3.4 Free Credit   | `POST /PM/AddFreeCredit` | **Single-shot** (own endpoint, not /PM/AddBonus) |
| 3.15 Free Spin    | `POST /PM/AddFreeSpin` then 2 follow-ups | **Shell + orchestration** (see below) |

### FS multi-call orchestration — CONFIRMED 2026-05-20
```
AddFreeSpin (shell: code/name/dates)
  → GetPromotionInfoByCode (canary lookup — AddFreeSpin returns {success,message} with no PromotionId)
  → AddFreeSpinReward (reward + FreeSpin config)
  → UpdatePromotionSettings ({PromotionId, Settings:[]})
```
**NOT needed:** `BulkAddorUpdatePromotionRewardContents` — locale T&C goes in `AddFreeSpinReward.PromotionReward.PromotionRewardContents`.  
**NOT needed:** `UpdatePromotionDetails` — that's for editing an existing promo, not create flow.

## Edit-page save chain (Deposit Bonus; FC/FS likely mirror)
1. `/PM/UpdatePromotionDetails`     (name/dates/etc.)
2. `/PM/UpdateBonusDetails`         (reward — FC uses `/PM/UpdateFreeCreditDetails`, FS uses `/PM/UpdateFreeSpinDetails`)
3. `/PM/UpdatePromotionRewardDetails`
4. `/PM/UpdatePromotionSettings`
5. `/PM/BulkAddorUpdatePromotionRewardContents`

Status: `/PM/UpdatePromotionStatus` — 4 flavors (Activate/Deactivate/Publish/Unpublish).

## Confirmed field formats (from live save of `TEST_FT_DEP_IGMP_01`)
- **PromotionStartDate / PromotionEndDate** — JS `Date.toDateString()` (e.g. `"Mon Jun 01 2026"`). Timezone = browser local = **GMT+8 (Malaysia Time)** on this BO.
- **RedeemableDay** — comma-joined digits, NO trailing comma. `Sun=0 Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=6`. All-week = `"0,1,2,3,4,5,6"`.
- **RedeemableStartTime / RedeemableEndTime** — int minutes-since-midnight (`HH*60 + MM`). `00:00→0`, `23:59→1439`.
- **PromotionManagementId** — nullable; "NA" dropdown = `null`.
- **RedeemableKYCStatus** values: `"BASIC,ADVANCED,PRO"` (0), `"ADVANCED,PRO"` (1), `"PRO"` (2).

## Step-3 enums (verified live from DOM, JS comments were misleading)

| Field | Page | Options |
|---|---|---|
| `RedemptionType` | Deposit Bonus | only `0` (Deposit Bonus) |
| `RedemptionType` | Free Credit   | **hardcoded `1`** in JS (Claim) |
| `RedemptionType` | Free Spin     | `0`=Deposit, `1`=Claim (use `1`) |
| `RewardType`     | Deposit Bonus | `0`=Percentage, `1`=Fixed Amount |
| `RewardType`     | Free Credit   | `0`=Percentage, `1`=Fixed Amount, `2`=Manual Input (rewrite to `1` + Settings entry on wire) |
| `RewardType`     | Free Spin     | **only `"3"` (Free Spin)** — single option in dropdown |
| `RolloverType`   | all           | `0`=Percentage, `1`=Fixed Amount |

### AddFreeSpinReward — confirmed wire shape (live capture 2026-05-20)
```json
{
  "PromotionId": 3417,
  "PromotionReward": {
    "RewardName": "...",
    "RedemptionType": "1",
    "RewardType": "3",
    "MinimumActionAmount": "0",
    "BonusPercentage": 0,
    "RolloverMultiplier": "8",
    "FixedBonusAmount": 0, "FixedRolloverAmount": 0,
    "PhysicalGiftDescription": "",
    "RedeemableQuantity": "0", "RemainingQuantity": "0",
    "IsActive": true, "RolloverType": "0", "CapBonusAmount": 0,
    "RedeemableKYCStatus": "BASIC,ADVANCED,PRO",
    "PromotionRewardContents": [{ "Locale": "en", "PromotionRewardName": "...", "Content": "..." }],
    "WithdrawalCap": "0", "MaximumBalance": "0"
  },
  "FreeSpin": {
    "RedeemableDay": "0,1,2,3,4,5,6",
    "RedeemableCount": "0",
    "ProductId": "208",
    "GameId": "9937",
    "StartTimeStamp": "Wed May 20 2026",
    "EndTimeStamp": "Sat Jun 20 2026",
    "FreeSpinCode": "TEST_IGMP_FS_V3",
    "FreeSpinName": "",
    "FreeSpinRounds": "10",
    "AmountPerBet": "0.2",
    "AmountPerLine": null,
    "ValidityTimeStamp": null,
    "AdditionalSettings": {}
  },
  "MaxFreeSpinDayDuration": 365
}
```
Key gotchas:
- `AdditionalSettings` is `{}` (object), not `[]` (array)
- `FreeSpinRounds`, `AmountPerBet`, `RedeemableCount` are **strings** on the wire
- `AmountPerBet` is a **select dropdown** in the UI (fixed valid values: 0.2, 0.4, etc.)
- FS date fields use `Date.toDateString()` format (same as DEP/FC) — `"Wed May 20 2026"`
- UI enforces "30 day minimum" span for FS dates — API does NOT enforce this
- `ProductId` and `GameId` come from `/VIM/GetAllProductOfferings` and `/VIM/GetGames` catalogs; must be resolved per-site before creating reward

## Cross-cutting (operational)
- **Auth:** cookie session only. No CSRF / anti-forgery header. `Content-Type: application/json; charset=utf-8`.
- **Shift gate:** "Shift not started" warning in profile menu does **NOT** block promo creation. (Likely only gates transaction processing.)
- **Submit semantics:** save creates an **inactive, unpublished** promo. Separate `/PM/UpdatePromotionStatus` calls activate + publish.
- **Locale T&C:** server auto-creates an EN row on save if none provided. For real promos, send `PromotionRewardContents: [{Locale, PromotionRewardName, Content}]` per locale.

## Inbox / Notification
**Not part of /PM/* surface.** iGMP keeps inbox in the Notification Manager module (`#NM/Inbox`, bell icon). Separate API capture required if we want to automate inbox alongside promos. Currently a manual step.

## Cross-BO uniformity (verified 2026-05-19)
MD5-identical `CreateBonus.js`, `CreateFreeCredit.js`, `CreateFreeSpinCampaign.js` across:
- `kioskmy.best-in-asia.com` (WS1 V3 MY)
- `kiosksg.best-in-asia.com` (WS1 V3 SG)
- `ws2-kioskmy.best-in-asia.com` (WS2)

Same software deployment. Per-BO differences are server-side only: currency derived from BO identity (MYR / SGD / IDR / THB / KHR), and locale enums on the T&C dropdown. Wire shapes are identical — one mapper covers all WS1 V3 BOs + WS2.

ID/TH/KH (`kioskid`, `kioskth`, `kioskkh.best-in-asia.com`) untested but expected to match the same pattern.

## How to apply
- Any iGMP/WS1/WS2 promo-code automation work starts here.
- WS1 V4 (`cms.best-in-asia.com`) is a separate BO — these shapes do NOT apply (V4 = modern unified BO, not the V3 kiosk software).
- Live test artifacts (ws1-v3-my, inactive/unpublished):
  - `TEST_IGMP_DEP_V1` PromotionId=3412 — Deposit Bonus ✓
  - `TEST_IGMP_FC_V1`  PromotionId=3413 — Free Credit ✓
  - `TEST_IGMP_FS_V3`  PromotionId=3417, RewardId=14583 — Free Spin ✓ (V1=3414/shell+manual, V2=3416/shell+reward, V3=3417/full canary)
