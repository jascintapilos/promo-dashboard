---
name: QPRO PUT does NOT send promotion_currency (and archive doesn't free the code)
description: Two QPRO BO PUT/DELETE behaviors verified 2026-05-18. (1) PUT echoing the same promotion_currency body that POST used SILENTLY WIPES non-first currency rows. (2) DELETE archives the row but the code stays reserved — re-POST returns "code already taken".
type: project
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
## 1. PUT promotion_currency wipes non-first currencies

On QPRO BOs (any of QPRO1–17), the PUT `/api/bo/promotion/{id}` handler accepts a `promotion_currency: { '0': {...}, '1': {...} }` object. But the BO interprets this as "create new rows" instead of "match existing by currency_id" — the second-and-later entries cause `(promotion_id, settings_currency_id)` collisions that the BO soft-deletes silently, leaving only the first (MYR) row visible.

**Verified 2026-05-18 on QPRO5 P071:**
- POST `/api/bo/promotion` body had `promotion_currency: {0: MYR-block, 1: SGD-block}`. Response showed both rows created (ids 676 + 677, settings_currency_id 1 + 3).
- PUT `/api/bo/promotion/334` body echoed the same `promotion_currency` shape.
- After PUT: `/api/bo/promotioncurrency?promotion_id=334` returns 1 row (MYR). `currencies_ids: [1, 3]` (header still claims both). SGD row id=677 returns 404 on `/promotioncurrency/677`.

**How to apply:**
- `src/api-mapper-qpro.js` `buildUpdateBody` must NOT include `promotion_currency` in the PUT body. POST creates the rows correctly; PUT only needs to update non-currency fields and link the message template + dialog popup.
- QP2's PUT behavior is different — QP2 DOES need `promotion_currency` re-emitted in PUT (with `max_total_applications/bonus` coerced from null→0) or else the BO wipes the rows. See `project_bo_currency_id_catalog.md` for the QP2 POST vs PUT null/0 asymmetry.

## 2. QPRO archive does NOT free the code

DELETE `/api/bo/promotion/{id}` on QPRO returns success ("Successfully archived"), but the code stays reserved. New POST with the same code returns HTTP 422 "The code has already been taken". And the GET endpoint returns 404 for the archived id — there's no way to undo via API.

**How to apply:**
- Treat QPRO codes as one-shot. Once deployed, even if archived, the code can't be reused on that brand.
- For a "redo" scenario: bump the code suffix (`_V2`, `_V3`, etc) or change part of the code (campaign prefix, etc).
- Operator may be able to manually undelete via BO UI if needed — verify with operator before assuming.
- The QPRO API is asymmetric to QP2's: QP2 standalone POST/PUT/DELETE has its own quirks; QPRO's lifecycle is "create then archive, immutable code".
