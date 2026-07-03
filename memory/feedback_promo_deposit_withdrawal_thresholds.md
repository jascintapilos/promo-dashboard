---
name: feedback_promo_deposit_withdrawal_thresholds
description: Promo BO fields + MT copy + Dialog popup amounts must stay within platform deposit/withdrawal thresholds per currency
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 00b1136b-e675-4151-b735-d0eef5d6016e
---

Always validate promo `min_deposit` and max bonus/cap amounts against the platform deposit/withdrawal limits per currency before saving.

Limits are stored in `promo-automation/data/deposit-withdrawal-limits.json` (source: Google Doc 1ll2EEdlcHhfzc4Z637YN1oibhaQ6LQPomclUD-HfApA).

| Currency | Min Deposit | Max Deposit | Min Withdrawal | Max Withdrawal |
|----------|-------------|-------------|----------------|----------------|
| MYR | 30 | 50,000 | 50 | 50,000 |
| SGD | 50 | 30,000 | 200 | 30,000 |
| IDR | 25,000 | 100,000,000 | 50,000 | 100,000,000 |
| THB | 50 | 300,000 | 300 | 300,000 |
| USD | 5 | 10,000 | 10 | 10,000 |

**Why:** Any amount visible to players — whether in BO settings, MT inbox copy, or Dialog popup body — must stay within platform limits. Out-of-range figures mislead players and may cause failed transactions.

**How to apply:** Check all three surfaces before saving:
1. **BO promo code** — `min_deposit` ≥ platform min; max bonus/cap ≤ platform max withdrawal.
2. **MT (Message Template)** — any deposit/bonus amounts mentioned in subject or body must be within range for that locale's currency.
3. **Dialog popup** — same check on any amounts shown in the popup title or content body.

Flag and correct before committing to any platform (QPRO, QP2, WS1).
