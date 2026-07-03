---
name: feedback_bulk_edit_only_bot_created
description: Bulk SMS/message-template amendments must target only bot-created (created_by=yh_bot) templates matching the in-scope code prefix; never modify human-created ones.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cfef704e-f75e-4f8d-a92c-0727a011cf6f
---

When bulk-amending message/SMS templates (or similar BO artifacts), restrict the target set to rows that are BOTH (a) the in-scope code prefix (e.g. `CRM.SMS.*`) AND (b) `created_by == "yh_bot"` (the auto-generated bot batch). Do not touch templates a human created.

**Why:** human-created templates are curated/intentional; only the bot's bulk-generated batch is safe to mass-edit. A human (e.g. waiyip) may *update* a bot-created template as the hand-fixed "reference" — that one is still `created_by=yh_bot` and is skipped by CODE (it's already correct), not by created_by.

**How to apply:** the list endpoint `GET /api/bo/messagetemplate?perPage=200&page=N` returns `created_by` as a plain username string on each row — filter on it before any bulk PUT. Verified 2026-06-07 on ibc22: all 49 `CRM.SMS.*` were `created_by=yh_bot`, so the 48-template `ACE66`→`:merchantname` amend touched zero human-authored rows. Related: [[project_qp2_messagetemplate_api]], [[feedback_always_qc_after_save]].
