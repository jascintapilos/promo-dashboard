---
name: feedback-igmp-redemption-type-rule
description: "WS1/WS2 RedemptionType rule: no deposit = Claim (1), requires deposit = Deposit (0). Applies to all bonus types."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

**Rule: WS1/WS2 RedemptionType is determined solely by min_deposit.**

- `min_deposit = 0` → RedemptionType = **1 (Claim)** — player claims without depositing
- `min_deposit > 0` → RedemptionType = **0 (Deposit)** — player must deposit to trigger reward

**Why:** Confirmed by operator 2026-07-01. Applies to all IGMP bonus types (Deposit, Free Credit, Free Spin) on both WS1 and WS2.

**How to apply:**
- `src/api-mapper-igmp.js` already derives this correctly from `min_deposit`
- `src/igmp-tnc.js` How to Apply section branches on `minD === 0` for Claim vs Deposit step 1 text
- Pre-QC and Sentinel RedemptionType checks also use `min_deposit` as the source of truth
- When reviewing IGMP bundles: if a no-deposit promo has RedemptionType ≠ 1, or a deposit promo has RedemptionType ≠ 0, that is a mapper bug — flag as FAIL
