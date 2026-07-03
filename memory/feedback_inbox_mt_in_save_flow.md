# Feedback: Inbox MT creation is part of the save flow

If the request template specifies inbox messaging, the inbox MT must be created and linked during the same save session — not as a followup. This includes:
- QPRO: POST /api/bo/messagetemplate → PUT with locale details → PUT promotion with message_template_id
- QP2: same endpoint pattern
- WS1/IGMP: BulkAddorUpdatePromotionRewardContents

If a live promo already exists without an MT, create it immediately when identified — do not wait to be reminded. The only exception is when promo parameters are ambiguous or the promo is in an anomalous state (inactive, mismatched config) — in that case, flag for operator input before creating.
