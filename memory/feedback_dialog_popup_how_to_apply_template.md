---
name: Dialog popup content = "How to Apply" 3-step (not full T&C)
description: Dialog popup body must use the short "How to Apply" template — NOT the full message-template T&C body
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
The dialog popup body must NOT be a copy of the message template body. The popup is a short call-to-action; the full T&C lives in the Inbox (which the user opens via the popup's "READ MORE" CTA → `/member/message`).

**Why:** Jascinta 2026-05-20: operator-preferred popup shape is action-focused (a 3-step "How to Apply" with currency-aware min-deposit value and a redirect footnote pointing back to the Inbox for full T&C). Currently `buildDialogPopupBody` in `src/api-mapper-qpro.js` and `src/api-mapper-qp2.js` shares `renderBody(...)` with the message template, so popup + inbox were byte-identical — wrong.

**Reference popup probed 2026-05-20 (QPRO4 / YE55):**
- id=91 / code=8RTOM, label="30% Reload Bonus - AM Exclusive Offer"
- Contents present for locales 1, 3, 6, 7
- Per-locale currency: RM for MY (locales 1, 3), S$ for SG (locales 6, 7)

**Per-locale templates (verbatim from operator template):**

**MY_EN (locale_id 1):**
```html
<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount RM<MIN_DEP> and above<br>3. Choose [<strong><PROMOTION_NAME_EN></strong>] under "Promotion" and click SUBMIT.<br><br><i><strong>*For full promotion terms &amp; conditions, please check your Inbox.</strong></i></p>
```

**MY_ZH (locale_id 3):**
```html
<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 RM<MIN_DEP> 以上<br>3. 在"促销"下选择 <strong>[<PROMOTION_NAME_ZH>]</strong> 并点击提交。</p><p><strong>*有关完整的促销条款和条件，请查看您的收件箱。</strong></p>
```

**SG_EN (locale_id 6):**
```html
<p><strong>How to Apply:</strong><br><br>1. Go to the [Transfer] page and select your game provider.<br>2. Enter amount S$<MIN_DEP> &amp; Above<br>3. Choose [<strong><PROMOTION_NAME_EN></strong>] under "Promotion" and click SUBMIT.<br><br><i><strong>*For full promotion terms &amp; conditions, please check your Inbox.</strong></i></p>
```

**SG_ZH (locale_id 7):**
```html
<p><strong>如何申请：</strong></p><p>1. 点击 [转账] 页面并选择您的游戏提供商。<br>2. 输入金额 S$<MIN_DEP> 以上<br>3. 在"促销"下选择 <strong>[<PROMOTION_NAME_ZH>]</strong> 并点击提交。</p><p><strong>*有关完整的促销条款和条件，请查看您的收件箱。</strong></p>
```

**Slot substitutions (per promo):**
- `<MIN_DEP>` = `parsed.min_deposit` (no thousand separators in operator's existing popups — keep raw integer).
- `<PROMOTION_NAME_EN>` = `record.promotion_name_en` (e.g. "VIP 100% Reload Bonus").
- `<PROMOTION_NAME_ZH>` = `record.promotion_name_zh_id` (e.g. "VIP 100% 充值奖励").

**Per-locale currency rule:** MY → RM, SG → S$, ID → Rp, TH → THB, KH → KHR, AU → A$. Each locale uses its own currency (per `feedback_status_column_qc_is_operator_only.md`'s sibling rule — locale-aware currency on popup body).

**Counter-rule for FS / FC:** Free Spin and Free Credit are reward-grants, not deposit-bonuses. Their popups need a different template:
- FS: step 2 says "Open your Inbox to claim X Free Spins" — no min-deposit reference
- FC: similar to FS but for Free Credit
- (To be probed and templated separately when an FS/FC promo lands.)

**CTA buttons stay as before:**
- DUAL CTA (cta_button_type: 2)
- Button 1: "CLAIM NOW" / "立即领取" → `/member/deposit` (deposit) or `/member/reward` (no min-dep)
- Button 2: "READ MORE" / "阅读更多" → `/member/message`

**Applies to:** QPRO + QP2 only. IGMP/WS1 doesn't use a separate dialog popup (it's baked into the bonus content).
