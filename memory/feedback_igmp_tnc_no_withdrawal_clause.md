---
name: feedback-igmp-tnc-no-withdrawal-clause
description: "WS1 FC T&C — when maxXfer=0 (no cap), omit withdrawal clause entirely and renumber remaining clauses 1–5."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d3c34533-7226-490c-9a72-2e0385e4f2d2
---

When a WS1 FC promo has **no max withdrawal cap** (`WithdrawalCap: 0` / `maxXfer=0`), the withdrawal clause must be **omitted entirely** — do not render "Maximum withdrawal is MYR 0 only."

Remaining clauses renumber dynamically from 1:

| # | EN clause | ZH clause |
|---|---|---|
| 1 | Bonuses are valid for X days upon issuance unless stated otherwise. | 红利自发放之日起 X 天内有效，除非另有说明。 |
| 2 | Each member can claim this promotion only once. | 每位会员仅限领取一次此优惠。 |
| 3 | This promotion is valid across all game categories (excluding Blackjack and Virtual Sports). | 本优惠适用于所有游戏类别（二十一点和虚拟体育除外）。 |
| 4 | Promotion codes are time-limited and cannot be extended once expired. | 优惠码有时间限制，一旦过期将无法延长。 |
| 5 | General MB8 terms and conditions apply. | 适用 MB8 一般条款与条件。 |

**Why:** Operator removed clause 1 ("No maximum withdrawal") from the June Check-In T&C. The old default included it unconditionally as clause 1. Fixed in `src/igmp-tnc.js` — `buildFcEn` and `buildFcZh` now use a conditional push.

**How to apply:** `igmp-tnc.js` already handles this correctly (checks `maxXfer > 0`). When reviewing FC T&C output, always verify clause count and numbering matches cap presence.
