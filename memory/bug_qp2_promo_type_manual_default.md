---
name: QP2 promo_type defaulted to 1 (Manual) — fixed 2026-05-20
description: src/api-mapper-qp2.js:promoTypeInt fell through to `return 1` for Deposit, making BO show "Manual - Normal" instead of "Deposit Bonus"
type: project
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
QP2 BO `promo_type` enum (confirmed by operator-saved references 2026-05-20):

| value | label                |
|-------|----------------------|
| 1     | Manual               |
| 2     | Deposit Bonus        |
| 3     | Free Credit          |
| 4     | Free Spin            |

The QP2 mapper's `promoTypeInt()` previously had `return 1` as fallthrough, meaning Deposit promos were getting saved as "Manual - Normal" instead of "Deposit Bonus". Fixed to explicitly map Deposit → 2 and use 2 as the safe default.

**Detection:** Compare your saved promo's `promo_type` against operator-saved references on the same BO. Operator-saved Deposit promos on QP2C all show `promo_type=2`. If your save shows 1, you tripped this bug.

**Fix script:** `bin/_fix-p075-p084-qp2c-promotype.mjs` PUT-updates affected promos. Pattern: re-build the QP2 update body via `buildApiPlan().buildUpdate(...)` (now produces promo_type=2) and PUT.

**Caveats:**
- The `?id=<n>` query param on `/api/bo/popups` does NOT filter — it returns the default page. To find a specific popup, use `perPage=50` and `.find(r => r.id === N)`.
- The QPRO mapper's `promoTypeInt` already had Deposit → 2 — only QP2 was wrong.

**Affected saves recovered 2026-05-20:** P075-P084 on QP2C (IDs 1182-1187, 1189-1192). QPRO4 saves (IDs 353-362) were unaffected.
