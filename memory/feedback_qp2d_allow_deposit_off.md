---
name: QP2 (all merchants) — never tick Allow Deposit; use Deposit Status = Last Deposit / None
description: Operator rule confirmed 2026-05-15. On ALL QP2 merchants (IBC22 / KING333 / ACE66 / SPADE66), allow_deposit stays OFF. Use Deposit Status dropdown instead — "Last Deposit" when deposit is required (min_deposit > 0), "None" when not.
type: feedback
originSessionId: bdcf6e25-b81a-451e-9f65-d950b7db70f8
---
Rule (2026-05-15) — applies to **all QP2 merchants** (QP2A/B/C/D = IBC22/KING333/ACE66/SPADE66):

1. **NEVER tick `allow_deposit`** checkbox — keep it unchecked for ALL bonus types on QP2.
2. **Set Deposit Status dropdown based on deposit requirement:**
   - `min_deposit > 0` (Deposit promo, Cashback, FS with transfer) → `"Last Deposit"`
   - `min_deposit == 0` (Free Credit, no-deposit promos) → `"None"`

Form fields involved:
- `<input type="checkbox" formcontrolname="allow_deposit">` — keep unchecked
- `<select formcontrolname="deposit_status">` — defaults `val="1"` (Active). Pick "Last Deposit" or "None" depending on min_deposit.

**Why:** QP2 BO config requires this pattern. (Operator: "promo logic uses Last Deposit signal to gate eligibility rather than the allow_deposit checkbox.")

**How to apply:**
- In `bo-mapper-qp2.js`, set the `allow_deposit` check action's `state: false` unconditionally (all bonus types).
- Push a `select` action for `deposit_status`:
  ```js
  const depositRequired = (r.min_deposit ?? 0) > 0;
  push({
    kind: 'select',
    selector: 'select[formcontrolname="deposit_status"]',
    optionLabel: depositRequired ? 'Last Deposit' : 'None',
    label: 'Deposit Status',
    scope: 'form',
  });
  ```

**Already-saved TEST_ promos** (TEST_QP2A_REL_*, TEST_QP2A_FS_*, TEST_QP2B_*, TEST_QP2C_*, TEST_QP2D_*) all have `allow_deposit=true` + `deposit_status=Active` — operator should delete and re-test under the new rule, OR live with the mismatch since they're test fixtures.

**Open question:** what's the exact label of the "Last Deposit" option in the BO dropdown? Confirm via screenshot if it differs (e.g., "Last_Deposit" / "LastDeposit").
