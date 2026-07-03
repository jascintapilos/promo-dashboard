---
name: QP2 deposit_status — only None or Last Deposit
description: On QP2 (all 4 merchants), Deposit Status field can ONLY be "None" (1) when no deposit required, or "Last Deposit" (2) when min_deposit > 0. Never use "First Deposit", "FTD", or any other option.
type: feedback
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
For every QP2 promo, the BO `deposit_status` field accepts multiple options but only two are ever valid per operator rule: **"None"** when `min_deposit == 0`, **"Last Deposit"** when `min_deposit > 0`. Do not pick other options under any circumstances.

**Why:** Per Jascinta 2026-05-16. Other deposit_status values (e.g. "First Deposit"=3) silently change the eligibility logic — only members whose most-recent recorded deposit matches the criteria get the promo. The operator's promos always run against either no-deposit or any-recent-deposit cohorts, which maps to None / Last Deposit respectively.

**How to apply:**
- **deposit_status int mapping on this BO (verified 2026-05-18 via PUT probe on id=1179):**
  - `1` = None
  - `2` = Before Deposit ❌ never use
  - `3` = First Deposit ❌ never use
  - `4` = Last Deposit ✓
- `src/api-mapper-qp2.js` sends `r.min_deposit > 0 ? '4' : '1'` on POST and `r.min_deposit > 0 ? 4 : 1` on PUT. Earlier code had `2` for Last Deposit which actually saves as "Before Deposit" — corrected after operator caught it on P072 QP2B id=1179.
- Sister rule `feedback_qp2d_allow_deposit_off.md` already covers `allow_deposit = 0` for the same merchants.
