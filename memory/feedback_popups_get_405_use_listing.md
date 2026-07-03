---
name: popups-get-405-use-listing
description: "GET /api/bo/popups/{id} returns HTTP 405 on both QPRO and QP2 platforms. To fetch popup metadata by id (code, start_date, label, contents), walk the listing endpoint /api/bo/popups?perPage=100&page=N and build an id→row map."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 01415b09-50cf-4296-a456-1ac2c801f68b
---

`GET /api/bo/popups/{id}` is NOT supported on either platform — both
QPRO and QP2 (ibc22 base) return HTTP 405 "Invalid action" /
"Invalid result". POST creates and PUT updates work, but no single-row
GET-by-id.

To fetch a popup by id, use the listing endpoint:
```
GET /api/bo/popups?perPage=100&page=N
```
and walk pages until empty. Each row includes the full popup record:
`id, code, label, position, session, status, start_date, end_date,
location, contents` (per locale) etc.

For QP2 the listing also needs `site_id=N` query param (merchant scope).
For QPRO the listing is single-merchant, no site_id needed.

**How to apply:**
- Build a per-site lookup Map<popup_id, popup_row> by walking the
  listing once at script start; cache it.
- Don't try `/api/bo/popups/{id}` — it will 405.
- The listing's `contents` field is keyed by `locale_id` (1/3/6/7),
  same shape as the POST body.

Related: [[feedback_promotion_put_dialog_popup_list_wipe]] explains
why you might need to fetch popup metadata in the first place.
