# QP2 Back Office — game-provider API returns HTTP 500 (all 4 merchants)

**Reported:** 2026-10-08 · **Reporter:** Promo Team (Wai Yip) · **Severity:** Medium (persistent, non-outage)

## Summary
The QP2 back-office API endpoint that returns the **game-provider catalogue** responds with **HTTP 500** for **all four QP2 merchants**. It has been failing for roughly **two months**. Logging in and all other reads work normally — only this endpoint errors.

## Endpoint
```
GET https://54505721qp2api.960806.com/api/bo/gameprovider?perPage=100&page=1
```

## Response (every call)
```
HTTP 500
"Something is wrong. Please contact system admin. (I22-xxxxxxxx)"
```

## Affected merchants & server reference IDs (captured 2026-10-08)
| Merchant | Brand | Error reference |
|---|---|---|
| IBC22 | QP2A | I22-8ee2167c |
| KING333 | QP2B | I22-6f6871d6 |
| ACE66 | QP2C | I22-decf3712 |
| SPADE66 | QP2D | I22-a81a99fd |

(Earlier occurrence also seen: `I22-3955d076`.) All four merchants share the same API host, and the call is identical across them — so this looks like a single server-side fault on that endpoint, not a per-merchant config issue.

## What works vs what doesn't
- ✅ Authentication / login to each merchant
- ✅ All other BO reads (promotions, promo details, etc.)
- ❌ `GET /api/bo/gameprovider` → HTTP 500 on every merchant

## Impact
- The **list of game providers** cannot be retrieved through the API.
- For our QC automation this is currently **non-blocking** — promo QC still runs because provider codes are read from each promotion's own detail, not from this catalogue — but a secondary "provider drift" cross-check is degraded.
- Any other tooling or report that depends on the game-provider list from this endpoint will be broken.

## Request
Please check the server logs for the `I22-...` reference IDs above and restore the `/api/bo/gameprovider` endpoint. Happy to re-run the call on request and capture a fresh reference ID / timestamp if that helps tracing.
