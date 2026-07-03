---
name: feedback-validity-field-meaning
description: "QPRO/QP2 API: validity = bonus expiry AFTER claim, reward_validity = claim window BEFORE claim. API mappers are CORRECT; only the MT template text was inverted (now fixed)."
metadata:
  node_type: memory
  type: feedback
  originSessionId: continued-800f6d4f
---

**API field semantics (confirmed 2026-06-10 by tech team, re-verified 2026-06-15):**
- **`validity`** = bonus expiry AFTER claim (days the bonus is valid once claimed)
- **`reward_validity`** = claim window BEFORE claim (days the member has to claim)

Evidence: FT_FC88_12X (validity=3, reward_validity=30) → "claimed within 30 days, expire 3 days after claim"; FT_KYC_FC88_2X (validity=30, reward_validity=7) → "claimed within 7 days, valid for 30 days after claim".

**Sheet columns (authoritative, explicit headers — June 2026 tab):**
- **Col P = "Validity (After Claim)"** → ingest `validity_days` = after-claim expiry
- **Col Q = "Rewards Validity (Before Claim)"** → ingest `rewards_validity_days` = claim window

**The API mappers are CORRECT — do NOT swap them.** `api-mapper-qpro.js:472-473` and `api-mapper-qp2.js` map `validity_days→validity` (after-claim→after-claim) and `rewards_validity_days→reward_validity` (claim-window→claim-window). Verified live 2026-06-15: 9 WCF promos on QPRO1 all have validity=7 (col P, after-claim), reward_validity=30 (col Q, claim-window) = correct (players get 30 days to claim, bonus valid 7 days after).

⚠️ The earlier "code is backwards" claim was a FALSE ALARM: it assumed sheet "Validity" col = claim window, but the explicit header is "Validity (After Claim)" = after-claim expiry. With the correct column meaning, the mappers line up. Anyone who "fixes" the mappers per the old rule will BREAK them.

**The ONE genuine bug (FIXED 2026-06-15 in message-template-renderer.js `renderBody`):** the MT body template placeholders are INVERTED vs the ingest field names — `{{validity_days}}` = CLAIM WINDOW ("claimed within …"), `{{rewards_validity_days}}` = AFTER-CLAIM ("expire … after claim"). The renderer now bridges: `{{validity_days}}` ← `r.rewards_validity_days` (col Q), `{{rewards_validity_days}}` ← `r.validity_days` (col P). MT now reads "claimed within 30 days, expire 7 days after the claim." Verified live on 9 QPRO1 MTs, all 4 locales.

Related: [[project-igmp-api-shapes]], [[project-qpro-promo-content-api]], [[feedback_mt_dialog_per_locale_promo_name]]
