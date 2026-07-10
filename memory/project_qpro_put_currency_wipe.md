---
name: QPRO PUT does NOT send promotion_currency (and archive doesn't free the code)
description: Two QPRO BO PUT/DELETE behaviors verified 2026-05-18, PLUS a 2026-07-10 recurrence proving the client-side omit-fix doesn't fully solve it. (1) PUT echoing promotion_currency SILENTLY WIPES non-first currency rows — client fix is to omit the field, but the row can still get soft-deleted server-side even when omitted (12/15 QPRO brands hit this on P028); confirm via retry-POST → HTTP 422 "already exists" = real platform bug needing vendor/manual fix. (2) DELETE archives the row but the code stays reserved — re-POST returns "code already taken".
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

## 1b. Recurred 2026-07-10 (P028) despite the omit-fix — root cause is deeper than the PUT body

The 2026-05-18 fix (omit `promotion_currency` from `buildUpdateBody`) is confirmed still correctly implemented in `src/api-mapper-qpro.js` as of 2026-07-10 — verified by reading the function body directly (no `promotion_currency` key anywhere in the returned object). Yet 12 of 15 QPRO brands in the P028 batch still lost their SGD currency row.

**Ground truth (QPRO4, promotion_id=501):** the initial `POST /api/bo/promotion` response showed BOTH rows created correctly (`promotion_currency: [{id:971, settings_currency_id:"1"}, {id:972, settings_currency_id:"3"}]`). After the subsequent PUT (which does NOT touch currency), row 972 (SGD) had vanished: `GET /api/bo/promotioncurrency?promotion_id=501` returns only 1 row (MYR). `GET /api/bo/promotioncurrency/972` → 404. A fresh `POST /api/bo/promotioncurrency` with `currency_id=3` → HTTP 422 "This currency already exists." A `PUT /api/bo/promotioncurrency/972` (by id) reports `"Successfully updated Promotion Currency"` with correct values — but the row is STILL invisible afterward (still 404 on GET-by-id, still absent from the list).

**Conclusion:** this is a genuine BO platform-level soft-delete bug (row exists enough to block re-creation and accept updates, but is filtered from every read path), not something fixable via the documented client-side workaround, and not something the API exposes a working undo path for. It happens even when the client does everything the 2026-05-18 fix prescribes — the omit-fix reduces frequency but does not eliminate the underlying platform bug. Affected brands in P028: QPRO4,5,6,7,8,9,10,11,12,15,16,17 (12 of 15; QPRO1/2/3 were unaffected in this same batch, cause of the split is unknown).

**How to apply:** whenever a QPRO Sentinel bundle shows `detail.currencies` missing a region that `list_row.currencies`/MT content clearly expects, do NOT assume it's a detail-endpoint display quirk — run a direct retry-POST against `/api/bo/promotioncurrency` for that promotion_id/currency_id. HTTP 422 "already exists" confirms this exact soft-delete bug (real defect, needs BO vendor/admin-UI escalation — API-only remediation is blocked). A clean POST success would indicate a simpler, different gap (currency row genuinely never created) with an easy backfill fix. See the new Sentinel/promo-qc Suppressions-adjacent guardrail added 2026-07-10 for the agent-facing version of this rule. Fix script used for the ground-truth probe: ad-hoc, see `bin/_fix-p028-qpro-sgd-currency.mjs` (POST-only backfill; correctly errors 422 on the 12 broken brands, would have worked cleanly on a simple gap).

## 2. QPRO archive does NOT free the code

DELETE `/api/bo/promotion/{id}` on QPRO returns success ("Successfully archived"), but the code stays reserved. New POST with the same code returns HTTP 422 "The code has already been taken". And the GET endpoint returns 404 for the archived id — there's no way to undo via API.

**How to apply:**
- Treat QPRO codes as one-shot. Once deployed, even if archived, the code can't be reused on that brand.
- For a "redo" scenario: bump the code suffix (`_V2`, `_V3`, etc) or change part of the code (campaign prefix, etc).
- Operator may be able to manually undelete via BO UI if needed — verify with operator before assuming.
- The QPRO API is asymmetric to QP2's: QP2 standalone POST/PUT/DELETE has its own quirks; QPRO's lifecycle is "create then archive, immutable code".
