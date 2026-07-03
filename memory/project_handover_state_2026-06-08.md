---
name: handover-state-promo-canary-2026-06-08-current
description: End-of-day snapshot superseding 2026-05-27. QP2 dialog popup content overhauled — new short-body templates + auto_reward_activation fix. Verified live on all 3 bonus types. Read this first when picking up.
metadata: 
  node_type: memory
  type: project
  originSessionId: 9261e5d7-0ac9-4bc6-801a-3f4ca8df2ed2
---

## The operator workflow (unchanged)

```
node bin/ingest-requests.js                           # 1. ALWAYS first
node bin/resolve-refer-source.mjs P###-rNN --commit   # 2. If "Pls refer" or sparse fixture
node bin/canary-multi-brand.js P### --commit          # 3. Run on all brands
```

## What changed 2026-06-08

### 1. QP2 Dialog Popup — new short-body templates

Previously `buildDialogPopupBody` called `renderBody` (full 3-section inbox body). Now it calls `renderDialogBody` which loads from `src/dialog-popup-bodies/<slug>/<docKey>.html`.

| File | Content |
|------|---------|
| `src/dialog-popup-bodies/deposit/EN.html` | "How to Apply:" bold heading + 3 numbered steps |
| `src/dialog-popup-bodies/deposit/ZH.html` | Chinese equivalent |
| `src/dialog-popup-bodies/free-credit/EN.html` | Congrats line + bold T&C heading + turnover line |
| `src/dialog-popup-bodies/free-credit/ZH.html` | Chinese equivalent |
| `src/dialog-popup-bodies/free-spin/EN.html` | "How to Claim:" bold heading + 3 steps |
| `src/dialog-popup-bodies/free-spin/ZH.html` | Chinese equivalent |

**T&C disclaimer line** on all 6 templates: `<strong><em><span style="color:#FF0000;">*For full...</span></em></strong>` — bold + italic + red.

**Dialog popups now EN+ZH only** (ID locale excluded from `allowed` set in `buildDialogPopupBody`).

### 2. `renderDialogBody()` added to `src/message-template-renderer.js`

- Loads from `src/dialog-popup-bodies/` instead of `src/message-template-bodies/`
- Vars available: `currency_symbol`, `min_deposit`, `min_deposit_formatted` (comma-formatted), `turnover`, `promotion_name_en`, `spin_count`, `game_provider` (prefix-stripped), `game_name`
- No conditionals, no T&C section — intentionally brief
- Exported as `renderDialogBody`; imported in `api-mapper-qp2.js`

### 3. `auto_reward_activation` fixed to `1`

Both `buildPromotionBody` (POST) and `buildUpdateBody` (PUT) in `src/api-mapper-qp2.js` now send `auto_reward_activation: 1` (was `0`).

### 4. Blacklist Template on QP2 — separate session

Confirmed implemented in a prior session (not this one).

## Live verification — 2026-06-08

All 3 bonus types saved on QP2A (IBC22) with popup linked:

| Bonus | Code | Promo ID | Template ID | Popup ID |
|-------|------|----------|-------------|----------|
| Deposit | `TEST_QP2A_DEP_45PCT_POPUP_V3` | 1228 | 1157 | 1469 |
| Free Credit | `TEST_QP2A_FC_88_POPUP_V3` | 1229 | 1158 | 1470 |
| Free Spin | `TEST_QP2A_FS_28SPIN_POPUP_V3` | 1230 | 1159 | 1471 |

Popup linkage verified via `GET /api/bo/promotion?code=...&list` → `dialog_popup_list[0].promotion_id` set correctly. Note: `GET /api/bo/promotion/{id}` does NOT return `dialog_popup_list` — use list endpoint to QC.

## What's automated end-to-end (cumulative)

Everything from 2026-05-27 handover still holds. Additions:

| Capability | Status |
|---|---|
| QP2 dialog popup short-body templates (Dep/FC/FS EN+ZH) | ✅ DONE 2026-06-08 |
| `renderDialogBody()` in message-template-renderer.js | ✅ DONE 2026-06-08 |
| `auto_reward_activation: 1` on QP2 POST + PUT | ✅ DONE 2026-06-08 |
| Blacklist Template resolver (QPRO + QP2) | ✅ DONE prior session |

## What needs manual operator action (carry-forward)

- Inbox refer with code (`Pls refer X inbox code PROMOTIONS.MESSAGE.<NAME>`) — one-off script per promo
- Cashback — no T&Cs; operator handoff prompt
- TH locale — body renderer skips silently
- QPRO redo after archive — bump suffix or change campaign portion
- Blacklist Template sub-category linkage — manual via BO UI

## What changed 2026-06-16 (WS1 FC June Check-In)

10 WS1 MY FC promos created, QC'd, activated, sheet updated (rows 90–99, "QC Completed"):

| Code | ID | FC | TO |
|---|---|---|---|
| FT_JUNE_BR_D1_FC50 | 3704 | 50 | 15x |
| FT_JUNE_BR_D2_FC30 | 3705 | 30 | 15x |
| FT_JUNE_BR_D3_FC30 | 3706 | 30 | 15x |
| FT_JUNE_BR_D4_FC20 | 3707 | 20 | 15x |
| FT_JUNE_BR_D5_FC20 | 3708 | 20 | 15x |
| FT_JUNE_SIL_D1_FC100 | 3709 | 100 | 15x |
| FT_JUNE_SIL_D2_FC70 | 3710 | 70 | 15x |
| FT_JUNE_SIL_D3_FC50 | 3711 | 50 | 15x |
| FT_JUNE_SIL_D4_FC50 | 3712 | 50 | 15x |
| FT_JUNE_SIL_D5_FC30 | 3713 | 30 | 15x |

Code format: `FT_JUNE_<TIER>_D<DAY>_FC<AMOUNT>` (tier = BR / SIL).

**igmp-tnc.js changes (2026-06-16):**
- Withdrawal clause now conditional — omitted when `maxXfer=0`, remaining clauses renumber 1–5.
- June Check-In campaign intro added via keyword detection on `campaign` field.
- `ExpiryMinutes` derived from `rewards_validity_days × 1440` (default 10080).

## Open items / carryover

- Task #11: Add SGD currency to P113-P115 QP2A via BO UI — still in-progress
- P069/P070: MYR-only on QPRO4–17 (soft-deleted SGD/IDR rows) — operator decided BO UI fix, not automated
- TEST_* accumulation: run `bin/deactivate-test-promos.mjs` periodically
- `freespin_check` field on QP2: operator refs show `1`, bot still saves `0` — needs live probe to confirm correct value
