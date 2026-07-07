# IGMP (WS1) edit + status endpoints — API-direct (no UI)

Hard-won 2026-06-09. All editing of existing WS1 (kiosk{my,sg}.best-in-asia.com)
promotions is done via these JSON POST endpoints from the **live authenticated
browser page context** (the saved cookie file `igmp-sessions.local.json` goes
stale fast → Node `igmpPost` 500s; the live BO tab session works).

## Standing rules (operator, stated firmly) — WS1 / IGMP ONLY
These apply ONLY to WS1 (IGMP kiosk BOs). They do NOT apply to QPRO or QP2 —
those platforms have their own publish/activation semantics; do not assume.
- **NEVER publish (WS1).** Do not call any publish action. Leave `IsPublished:false`.
- **Final API step is ALWAYS activate (WS1)** (`UpdatePromotionStatus IsActive:true`),
  never publish. WS1 create/edit flows end with activation only.
- **EffectiveMinutes = 1 (WS1).** Operator standard for ALL WS1 promos (every
  campaign, not just TLEO): set EffectiveMinutes to 1 (deposit via
  UpdateBonusDetails, FC via UpdateFreeCreditDetails). Apply on create + edit.
- `IsActive` (Status: Activate/Deactivate) and `IsPublished` (Publish Status) are
  DISTINCT. Activating does NOT publish — verified: activated codes stay
  `IsPublished:false`.

## List / detail
- List all promos: `POST /PM/GetPromotionsList?pageNum=N&rowPerPage=200` body `{}`
  → `data.rows` (or array). Newest-first. Each row: PromotionId, PromotionCode,
  PromotionType ("Bonus"|"FreeCredit"), IsActive, IsPublished, dates.
- Quick code lookup: `POST /PM/GetPromotionInfoByCode {PromotionCode}` → `data`
  (PromotionId, IsActive, IsPublished; **PromotionRewards empty** in this view).
- Deposit detail: `POST /PM/GetBonusInfo {PromotionId}` → `data` = {Promotion,
  RedeemableCount, RedeemableDay, RedeemableStartTime, RedeemableEndTime,
  **EffectiveMinutes**}. Reward at `data.Promotion.PromotionRewards[0]` (RewardId…).
  Returns **empty `{}` for FreeCredit promos** — use GetFreeCreditInfo instead.
- Free Credit detail: `POST /PM/GetFreeCreditInfo {PromotionId}` → `data` =
  {Promotion, ExpiryMinutes, AutoRedemption, **EffectiveMinutes**}.

## Edit (the "Save Changes" tab fires 4 calls; pick the one you need)
- **Deposit bonus details** (schedule + effective minutes):
  `POST /PM/UpdateBonusDetails {PromotionId, RedeemableCount, RedeemableDay,
  RedeemableStartTime, RedeemableEndTime, EffectiveMinutes}` (values as strings
  except the two times which are ints; read current values from GetBonusInfo and
  change only the field you want).
- **Free Credit details**: `POST /PM/UpdateFreeCreditDetails {PromotionId,
  ExpiryMinutes, AutoRedemption, EffectiveMinutes}` (read current from
  GetFreeCreditInfo).
- Other tab calls (not usually needed): `/PM/UpdatePromotionDetails` (name/dates),
  `/PM/UpdatePromotionRewardDetails` (RewardName/qty/cap/KYC/withdrawal-cap/max-balance
  ONLY — it silently IGNORES MinimumActionAmount, BonusPercentage, RolloverMultiplier;
  those are CREATE-ONLY on deposit bonuses, see feedback_igmp_min_deposit_create_only,
  verified live 2026-07-07), `/PM/UpdatePromotionSettings`,
  `/PM/BulkAddorUpdatePromotionRewardContents` (per-locale T&C, body
  `{RewardId, PromotionRewardContents:[{Locale,PromotionRewardName,Content}]}`).
- **Activate/deactivate**: `POST /PM/UpdatePromotionStatus {PromotionId, IsActive:true|false}`.
  Captured from a real Activate click. Used by the Status column toggle.

## EffectiveMinutes note
EffectiveMinutes is the total minutes (UI shows split Day/Hours/Minutes + a
read-only "Effective Period"). 1440 = 1 day. **Operator standard = 1 for ALL WS1
promos** (not just TLEO). Create-via-AddBonus stored 1 even when body sent 1440 on
the 6 new codes; old codes were 1440 — so always edit explicitly to be sure.

## Bodies are JSON (not form-encoded). Content-Type: application/json; charset=utf-8.
Cookie auth only, no CSRF. Response `{success:bool, message}` (+ a "… successfully"
SweetAlert in the UI). Browser JS-tool output filter blocks raw form/query-ish
strings — parse to field names/values before returning.
