---
name: popup-cta-always-claim-reward
description: "Dialog popup CTAs MUST be CLAIM NOW / 立即领取 → /member/reward and READ MORE / 阅读更多 → /member/message — for ALL bonus types (Reload, Free Credit, Free Spin). NEVER use DEPOSIT → /member/deposit."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 01415b09-50cf-4296-a456-1ac2c801f68b
---

Dialog popup CTAs are uniform across ALL bonus types:

| Locale | Button 1 | Link 1 | Button 2 | Link 2 |
|---|---|---|---|---|
| MY_EN / SG_EN | `CLAIM NOW` | `/member/reward` | `READ MORE` | `/member/message` |
| MY_ZH / SG_ZH | `立即领取` | `/member/reward` | `阅读更多` | `/member/message` |

`cta_button_type` = 2 (DUAL) on the popup contents row.

**Why:** Operator rule 2026-05-26 — all bonus types funnel through
`/member/reward` (the unified Rewards page). The earlier canary
behavior of using `DEPOSIT → /member/deposit` when `min_deposit > 0`
is WRONG; it bypasses the reward page where the player actually
claims the bonus. Free Credit was being mislabeled "DEPOSIT" when it
should always be CLAIM NOW. Free Spin sometimes pointed to deposit
flow. All three corrected to the unified pattern on 2026-05-26.

This OVERRIDES the rule in [[feedback_dialog_popup_defaults]] that
said `min_deposit > 0 → DEPOSIT + /member/deposit`. That rule is
deprecated. Always use CLAIM NOW + /member/reward regardless of
min_deposit value.

**How to apply:**
- When building a popup body, set:
  ```
  cta_button_type: 2,
  cta_button_text_1: isZh ? '立即领取' : 'CLAIM NOW',
  cta_button_link_1: '/member/reward',
  cta_button_text_2: isZh ? '阅读更多' : 'READ MORE',
  cta_button_link_2: '/member/message',
  ```
- Never branch on bonus_type or min_deposit for CTA selection.
- This applies to popups across ALL brands (QP2A/B/C/D + QPRO1-17).

See `bin/_fix-cta-all-brands.mjs` for a working CTA-only patcher.

Related: [[feedback_dialog_content_vs_inbox_template]] (the popup
content body — separate concern).
