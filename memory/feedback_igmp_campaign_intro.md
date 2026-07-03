---
name: feedback-igmp-campaign-intro
description: "igmp-tnc.js injects per-campaign custom intro text via keyword detection on the `campaign` fixture field. Add a branch for each new campaign type."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d3c34533-7226-490c-9a72-2e0385e4f2d2
---

`src/igmp-tnc.js` has `campaignIntroEn()` and `campaignIntroZh()` functions that inspect `rec.campaign` (col K from the sheet) and return a customised intro sentence.

**Current detection branches:**

| Campaign keyword (any case) | EN intro | ZH intro |
|---|---|---|
| `june` / `check-in` / `checkin` | "You earned it! As a reward for your June Check-In activity, enjoy MYR X free credits on us — no deposit needed." | "您坚持每日签到，我们为您送上奖励！作为六月签到活动的感谢，MYR X 免费分数送给您，无需存款。" |
| *(fallback)* | Generic campaign intro | Generic ZH intro |

**How to apply:** For any new WS1 FC campaign that needs a custom intro, add a new `if` branch in `campaignIntroEn` and `campaignIntroZh` in `igmp-tnc.js`. The `campaign` field is already ingested from col K — no fixture changes needed.

**Why:** The generic fallback intro is too bland for targeted reactivation campaigns. Operator expects the intro to match the campaign context (June Check-In, VM Blast, etc.).
