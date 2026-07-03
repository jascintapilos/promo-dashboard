---
name: Free Credit inbox template — structure and per-promo rules
description: Operator-confirmed structure for Section 6.6 Free Credit Message Template content. Captured from QP2A live templates (FT_VIP_30FC_10X, VIP_15FC_0X, VIP_30FC_5X, VIP_50FC_5X). Use this as ground truth — earlier authored bodies were missing the intro line, the How to Redeem section, the inverse-category clause, and the :url/terms-conditions footer.
type: feedback
originSessionId: bdcf6e25-b81a-451e-9f65-d950b7db70f8
---
Confirmed 2026-05-14 against the operator's live templates in QP2A BO.

## Structure (3 sections + footer)

```
1. Intro line: "Congratulations! You have been rewarded with a free credit!"
2. How to Redeem:
     1. Head over to the [Reward] page.
     2. Search for [{{reward_name}}] reward and click CLAIM.
3. Terms and Conditions:
     1. Deposit + max-transfer-out clause (both conditional)
     2. Turnover requirement
     3. Validity (claim + bonus expiry)
     4. Time-limited promo codes
     5. Inverse-category clause (see below)
     6. Refresh button reminder
     7. General <brand-placeholder> T&C apply. :url/terms-conditions
```

## Subject pattern

| Targeting | EN | ZH | ID |
|---|---|---|---|
| **VIP-targeted** (VM blast, VIP_*FC_*) | `VIP Exclusive Offer - {amount} Free Credit` | `VIP 专属优惠 - {amount} 免费彩金` | `Penawaran Eksklusif VIP - {amount} Kredit Gratis` |
| **Non-VIP** (public, FT_*FC_*) | TBC — default `Exclusive Offer - {amount} Free Credit` until operator confirms | TBC default `专属优惠 - {amount} 免费彩金` | TBC |

Detect VIP via `resolved.is_vip === true` OR `promo_code` matches `/^VIP_|_VIP_/`.

**Why:** the QP2A BO list shows ONLY VIP-targeted FC templates (`VIP_*FC_*` and `FT_VIP_*FC_*`). Non-VIP convention not yet captured — ask the operator when a non-VIP FC request lands.

## Category exclusion clause (inverse language)

FC bodies say "All game categories are eligible for this promotion **except** X" instead of listing eligible categories positively. The exclusion list depends on what IS eligible:

| Eligible categories include… | Excluded clause |
|---|---|
| Slot / Slots | "Arcade and Table games" |
| Sports only (alone) | "Virtual Sports and Number games" |
| Live Casino + Sports (no Slots) | "Blackjack and Virtual Sports" _(default fallback)_ |

ZH equivalents:
- Slots in eligible → `街机和桌面游戏`
- Sports only → `虚拟体育和数字游戏`
- Live Casino + Sports default → `二十一点和虚拟体育`

ID equivalents:
- Slots in eligible → `Arkade dan Permainan Meja`
- Sports only → `Olahraga Virtual dan Permainan Angka`
- Default → `Blackjack dan Olahraga Virtual`

**Why:** matches Inbox T&C conventions; operator confirmed 2026-05-14.

## Max transfer out — conditional

When the request has no withdrawal cap (operator-targeted VIP FC typically), the body says: **"There is no maximum transfer out from the game wallet."**
When the request HAS a cap (FastTrack public FC), the body says: **"Max transfer out from the game wallet is {{currency_symbol}} {{max_transfer_out}} only."**

Renderer flag: `flags.max_transfer_out = maxTransferOut > 0`.

## ID locale — when to fill

Required for brands with Indonesian-speaking players:
- QPRO1 (BP9)
- WS1 (MB8)
- QP2 (IBC22 / KING333 / ACE66 / SPADE66)

For other QPRO brands, ID can be skipped. For test/canary purposes, the bot fills ID anyway (BO doesn't complain about extra tabs being filled).

## Footer placeholders — BOTH literal

`General :merchantname Terms and Conditions apply. :url/terms-conditions`
(or `:brandname` on QPRO platform — see `feedback_promo_template_placeholders.md`)

`:url/terms-conditions` is a second BO-substituted literal: the brand's T&C URL path. Never substitute client-side.
