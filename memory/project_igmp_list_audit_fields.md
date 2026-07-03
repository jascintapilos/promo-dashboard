---
name: project_igmp_list_audit_fields
description: IGMP GetPromotionsList returns null audit fields; change dates only in per-promo detail. Login creds + body shape.
metadata: 
  node_type: memory
  type: project
  originSessionId: 0f035779-571c-45a0-8713-73d7d824886d
---

Auditing "what changed when" on WS1/WS2 (IGMP) requires per-promo **detail** calls — the list grid omits audit data.

- **`/PM/GetPromotionsList?pageNum=N&rowPerPage=200`** — body REQUIRED: `{PromotionCode:'',PromotionName:'',PromotionType:0,IsActive:'',IsPublished:''}` (empty `{}` → HTTP 500). `PromotionType` 0=Bonus(Deposit/FC/FS), 1=SmsRecovery, 2=LuckyDraw. In list rows `LogTimeStamp`, `ModifiedTimeStamp`, `ModifiedBy`, `CreatedBy` are all **null** — only `PromotionStartDate` (validity, `DD/MM/YYYY`) is populated.
- **`/PM/GetBonusInfo` {PromotionId}** returns `data.Promotion.LogTimeStamp` (=created) + `.ModifiedTimeStamp` (=last edit) + `.ModifiedBy.ActorLogin`. Format `DD-MM-YYYY HH:MM:SS`. Works as general detail for Type-0; fall back to GetFreeCreditInfo / GetFreeSpinPromotionInfo if both null.
- Session = browser cookie (expires ~days). Re-auth: `node bin/_igmp-capture-all.mjs promo_testbot 123456` (auto-login all 6; login form ids `#Username`/`#Password`, button text "Login", lands on `/Home`). Sweep script: `bin/_scan-igmp-changes-lastweek.mjs`.
- Scan 2026-06-08 for window 2026-06-01..07: 0 changes across all 6 IGMP BOs (1,044 Type-0 promos). See [[project_igmp_api_shapes]], [[project_ws1_ws2_platforms]].
