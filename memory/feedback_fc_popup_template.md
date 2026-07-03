---
name: feedback-fc-popup-template
description: "Free Credit promos use a distinct \"How to Apply\" popup template — no deposit step, claim from Rewards page."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 82477a57-d4ec-4d6b-a25e-ecac80954716
---

Free Credit (FC) dialog popups must use the FC-specific 3-step "How to Apply" template, NOT the deposit-flow template used for Deposit/Reload promos. Two distinct templates exist:

**Deposit promos (min_deposit > 0)** — keep existing template:
- EN: "1. Go to the [Transfer] page and select your game provider. 2. Enter amount RM{min} and above 3. Choose [<name>] under "Promotion" and click SUBMIT."
- CTA: DEPOSIT / 存款 → /member/deposit

**Free Credit promos (min_deposit == 0)** — use FC template:
- EN: "1. Login to your account and go to the [Rewards] page. 2. Find [<name>] in the available promotions list. 3. Click CLAIM NOW to receive your free credit instantly."
- ZH: "1. 登录账户并前往[奖励]页面。2. 在可用促销列表中找到 [<name>]。3. 点击立即领取以即时获得您的免费体验金。"
- CTA: CLAIM NOW / 立即领取 → /member/reward

Both templates end with the inbox redirect line: *"For full promotion terms & conditions, please check your Inbox."* / *"有关完整的促销条款和条件，请查看您的收件箱。"*

**Why:** Original "How to Apply" template hardcoded deposit-flow language ("Enter amount RM X and above"). For FC promos with min_dep=0, that line read as "Enter amount RM0 and above" which is semantically wrong — FC has no deposit. The FC template removes the deposit step and routes the player through the Rewards page where the CTA links.

**How to apply:** Branch popup body by bonus_type at mapper time. Deposit/Reload → existing template (now CTA-aware DEPOSIT label). Free Credit → FC template above. Free Spin treatment TBD. First codified in `bin/_fix-p104-p105-fc-popup-body.mjs` for P104/P105 (8 popups, QPRO3/4/5/9). Mapper integration still pending — until then, every FC save needs the fix script applied retroactively.

See also [[feedback-dialog-popup-cta-label-link]], [[feedback-dialog-popup-how-to-apply-template]].
