---
name: dialog-content-vs-inbox-template
description: "Dialog popup content is NOT the same as the inbox message template content. Popup = short \"How to Apply\" / \"Congratulations\" + Inbox-footer. Inbox template = the long Promo Details table + full T&C. The canary mistakenly uses the inbox template body for the popup; popups need their own short-format renderer."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 01415b09-50cf-4296-a456-1ac2c801f68b
---

The QPRO/QP2 BO has two visually-similar but DISTINCT content slots:

1. **Inbox message template** (`/api/bo/messagetemplate`): the long-form
   on-site/inbox article shown when the player clicks READ MORE. Contains:
   - "Promo Details:" table (Min Dep, Max Bonus, TO multiplier)
   - "Bonus Condition Example" calculation
   - Full 8-clause Terms & Conditions block

2. **Dialog popup content** (`/api/bo/popups`): the small popup that
   shows when the player logs in. Short-format only, MUST be:

   **Reload (Deposit):**
   ```
   Title:   Time Limited Exclusive Offer - <RATE>% Reload Bonus
   Body:    How to Apply:
            1. Go to the [Transfer] page and select your game provider.
            2. Enter amount <CURRENCY> <MIN_DEP> and above
            3. Choose [<TITLE>] under "Promotion" and click SUBMIT.
            *For full promotion terms & conditions, check your Inbox. (red)
   CTAs:    DEPOSIT / READ MORE
   ```
   ZH equivalents: "限时独家优惠", "如何申请", "请查看您的收件箱".

   **Free Credit:**
   ```
   Title:   Time Limited Exclusive Offer - Free Credit <AMOUNT>
   Body:    Congratulations! You have been rewarded with a free credit!
            Terms and Conditions
            1. Turnover is <TO> times.
            *For full terms & conditions, check your Inbox. (red)
   CTAs:    CLAIM NOW (or DEPOSIT) / READ MORE
   ```
   ZH equivalents: "恭喜！您已获得了免费分数！", "条款与条件", "流水要求为 <TO> 倍".

   **Free Spin** (gold reference: QPRO1 popup id=427 code=5MXRY):
   ```
   Title:   CONGRATULATIONS, YOU HAVE <SPINS> FREE SPINS!
            恭喜您，您获得了<SPINS>次免费旋转！
   Body:    How to Claim: (red heading)
            1. Go to Account > Rewards and claim the reward [<REWARD_NAME>]
            2. After successfully claiming the reward, go to Home > Game >
               Slots > <PROVIDER> and select the game [<GAME>]
            3. Redeem all your <SPINS> free spins!
            *For full promotion terms & conditions, check your Inbox. (red)
   CTAs:    CLAIM NOW / 立即领取 → /member/reward (or /member/rewards on QPRO1)
            READ MORE / 阅读更多 → /member/message
   ```
   ZH equivalents: "如何领取：", "前往帐户 > 奖励并领取奖励", "兑换 X 次免费旋转".

   NOTE: Earlier reference (QPRO2 popup 163) used a longer 5-step
   deposit + transfer flow with 8-clause inline T&C — that format is
   WRONG. Use the QPRO1 5MXRY short-claim format above. The
   distinction: FS popup body must NOT include the long T&C; it
   points to the inbox like Reload and FC.

**Why this matters:** The canary's `buildDialogPopupBody` in
src/api-mapper-qpro.js calls `renderBody()` (the inbox template
renderer), then uses that HTML as the popup `content`. Result: 195
P124-P163 popups all shipped with the LONG-form Promo Details table
instead of the short How-to-Apply popup. Player UX is wrong — the
popup is a wall of text instead of a quick "click here to apply".
Reference templates are on QPRO2 (operator-created) popups 146
(Reload) and 138 (FC).

**How to apply:**
- When creating a dialog popup, build the SHORT content directly from
  parsed fields (rate, min_deposit, free_credit_amount, to_multiplier)
  + locale-specific currency mapping. Do NOT reuse the inbox template's
  HTML.
- Title for popup is ALWAYS "Time Limited Exclusive Offer - <name>" /
  "限时独家优惠 - <name>". This is different from the promo's
  `promotion_name_en` (which is just "<rate>% Reload Bonus" without
  the TLEO prefix).
- Inbox footer must be present in red: `<span style="color:hsl(0,75%,60%);"><strong>*For full ...</strong></span>`.
- See `bin/_fix-dialog-content-qpro-195.mjs` for a working
  implementation that recovered the 195 wrongly-created popups.

**Canary patch needed:** `src/api-mapper-qpro.js` `buildDialogPopupBody`
should call a NEW renderer (e.g. `renderPopupBody`) instead of the
inbox `renderBody`. Until that lands, every batch needs a post-hoc
dialog content fix pass.

Also note: popup PUT body needs date format `Y-m-d H:i:s` (strip
timezone) — see [[feedback_put_body_field_renames]].
