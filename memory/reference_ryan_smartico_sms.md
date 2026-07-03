---
name: reference-ryan-smartico-sms
description: Ryan owns Smartico SMS campaigns (QPRO2-19); BO SMS templates ≠ Smartico blasts — check both when troubleshooting SMS content issues.
metadata: 
  node_type: memory
  type: reference
  originSessionId: 800f6d4f-1aaf-4ad3-93ac-f63592540951
---

Ryan is the contact for Smartico SMS campaign content (QPRO2-19 brands on drive-6.smartico.ai).

BO SMS templates (section 6.6, `message_template_sms_id`) and Smartico campaign blasts are **separate channels**. A member-facing SMS may originate from Smartico, not the BO template. When troubleshooting SMS content mismatches: check both the BO template AND escalate to Ryan for Smartico-side copy.

Discovered 2026-06-09 via QPRO5 WELC_RND3_FS_FOO_260225 — BO SMS didn't mention min transfer at all, but member received an SMS saying RM100; source was Smartico, not BO.

Related: [[project-smartico-shape]], [[project-smartico-api-shapes]]
