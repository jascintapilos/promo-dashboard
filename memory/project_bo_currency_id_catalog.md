---
name: BO currency_id catalog (verified 2026-05-17)
description: Real BO currency IDs are MYR=1, SGD=3, IDR=4. Earlier hardcoded map had SGD=2, IDR=3 — caused silent name-row corruption (every locale tied to MYR) and currency-row writes landing on wrong currencies.
type: project
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
The `/api/bo/currency` catalog (same on QPRO and QP2 — bo.mei707.com + ibc22.qtp777.com) returns exactly three currencies for this client:

| id | name |
|---|---|
| 1 | MYR |
| 3 | SGD |
| 4 | IDR |

There is no `id=2` row. The earlier `CURRENCY_TO_ID = { MYR: '1', SGD: '2', IDR: '3' }` mapping was wrong on two counts: SGD sent as id=2 ended up creating phantom rows for a non-existent currency; IDR sent as id=3 silently landed on SGD-tagged rows.

**Why it matters:**
- Per-currency rows on the promotion (`/api/bo/promotioncurrency`) need the correct id to attach to the right currency.
- Per-locale `promotion_name` rows have a `currency_id` field — if all locales get currencies[0]=MYR (the old `buildNameBodies` bug), SG/ID players see no localized copy because no name row matches their currency.

**How to apply:**
- `CURRENCY_TO_ID = { MYR: '1', SGD: '3', IDR: '4' }` in both `src/api-mapper-qpro.js` and `src/api-mapper-qp2.js`. THB/KHR/AUD not yet verified — probe via `/api/bo/currency` before using.
- `buildNameBodies` in both mappers derives currency_id from the locale's region prefix (MY→MYR, SG→SGD, ID→IDR), NOT from `resolved.currencies[0]`.
- ID_TO_CURRENCY derived from CURRENCY_TO_ID for reverse lookups.
- POST /api/bo/promotioncurrency standalone validator accepts `null` for unlimited caps (max_total_applications, max_total_bonus, max_withdraw, max_balance_claim). PUT /api/bo/promotion/{id} embedded promotion_currency requires `0` for those same fields. Asymmetric — write helpers accordingly.

**Verification:**
- Run `authedFetch(site, '/api/bo/currency?perPage=30')` on any QPRO or QP2 site. Returns `{rows: [{id, name}, ...]}`.
- After fixing the mapping in this codebase, today's P069/P070 records on QPRO1–3 + QP2 (Dep + FC) saved with all 3 currencies cleanly.
- QPRO4–17 had soft-deleted phantom rows from earlier wrong-ID writes; "already exists" errors prevent re-POST. Operator cleans manually via BO UI per Jascinta 2026-05-18.
