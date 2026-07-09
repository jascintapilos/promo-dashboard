---
name: QP2 promotion_currency — Max Total Applications / Withdraw / Amount stay NULL = Unlimited
description: On QP2 promotion_currency rows, max_total_applications, max_total_bonus (BO label "Max Total Amount"), and max_withdraw must remain null. BO renders blank = Unlimited. Never sentinel-value them.
type: feedback
originSessionId: 6baee7b0-ead2-43e6-a52c-73cd53df7d6e
---
On QP2 (all merchants), the promotion_currency rows have three "cap" fields that the operator wants left BLANK in the BO UI — which renders as "Unlimited":

- **`max_total_applications`** — BO label "Max Total Applications"
- **`max_total_bonus`** — BO label "Max Total Amount"
- **`max_withdraw`** — BO label "Max Withdraw"

API representation: `null`. Never use 0, "" (empty string), or sentinel values like 999999999 — those show as a literal number in the BO Edit form, not "Unlimited".

## Validator quirks (asymmetric between endpoints)

Both POST endpoints accept `null` for these fields:
- `POST /api/bo/promotion` with embedded `promotion_currency` block ✓

The PUT endpoints disagree:
- `PUT /api/bo/promotion/<id>` with embedded `promotion_currency` block — validator REJECTS null ("must be an integer"). However, the BO **does NOT propagate** the embedded promotion_currency values to existing currency rows on PUT. So the validator block forces non-null in the body, but the actual stored values remain whatever POST set them to (i.e., null). The mapper coerces null→0 in `src/api-mapper-qp2.js buildUpdateBody` solely to pass validation — the values are functionally discarded.
- `PUT /api/bo/promotioncurrency/<id>` (standalone) — accepts null **when `bonus_type` is set in the body**. FS rows naturally have `bonus_type=null` post-POST; if a standalone PUT needs to touch them, include `bonus_type: row.bonus_type ?? 1` to satisfy the validator.

Required field alias on standalone PUT: `currency_id` (POST/PUT body field) ↔ `settings_currency_id` (GET response field).

## What this means in practice

- **Canary runs** (`canary-multi-brand`, `canary-api-qp2`) — naturally leave these three fields at null on QP2. No change needed. The step 5 PUT's validator pass with 0s is harmless because the values don't propagate.
- **Recovery scripts that PUT promotioncurrency** — must use `null`, not sentinels. `bin/fix-p074-min-deposit.mjs` was originally written with 999999999 and corrected to null per operator rule 2026-05-18.
- **QPRO** — has different field names + schema. This rule is QP2-only. QPRO FS rows currently store `max_total_applications=0` and `max_total_bonus=0` from the mapper; no operator instruction to change those.

**Why:** P074 saves on QP2B initially landed with the 999999999 sentinel — operator flagged it should be blank (= Unlimited in BO). Investigation showed null works on standalone PUT once `bonus_type` is also set; on inline PUT the validator rejects null but doesn't actually update the rows anyway.

## deposit_status mapping (corrected 2026-07-09)

The old rule "min_dep 0 → None(1), else Last Deposit(2)" is WRONG about the integer for Last Deposit. Verified live on ibc22 (P026, promo 1345 + 5 healthy CRM_ADHOC siblings): the mapper's plan value **`"4"` persists and renders as "Last Deposit"** — the semantically correct setting for min_deposit > 0. Also: the QP2 **detail** endpoint does not return `deposit_status` at all; only the **list** endpoint carries it, as a human label ("None" / "Last Deposit").

**How to apply:** QC gates must judge deposit_status by the `list_row.deposit_status` label, never by expecting a literal integer `2`, and never FAIL on the field being absent from detail. A Pre-QC "deposit_status=4 should be 2" finding is a false positive.
