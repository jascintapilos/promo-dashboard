---
name: promotion-put-dialog-popup-list-wipe
description: "GET /api/bo/promotion/{id} does NOT return dialog_popup_list — so PUTting `row.dialog_popup_list || []` from the detail endpoint silently wipes the popup link. Always source dialog_popup_list from the listing endpoint, or build it fresh from a known popup_id."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 01415b09-50cf-4296-a456-1ac2c801f68b
---

When PUT-ing /api/bo/promotion/{id}, the `dialog_popup_list` field has a
silent wipe trap:

- `GET /api/bo/promotion/{id}` (detail endpoint) does NOT include
  `dialog_popup_list` in the response. The field is just missing.
- `GET /api/bo/promotion?code=X` (listing endpoint) DOES return it.
- If you build a PUT body from the detail endpoint with
  `dialog_popup_list: row.dialog_popup_list || []`, you send an empty
  array → BO interprets that as "remove all popup links" → wipes them.

**Why it's load-bearing:** P124-P163 SMS backfill PUT wiped all 195
QPRO3/4/6/8/10 popup links because the canary's reference buildUpdateBody
fetched from /promotion/{id} (no dialog_popup_list in response) and the
fallback `|| []` lost the link. Took a re-link pass + QC to catch.

**How to apply:**
- If a PUT body needs to preserve `dialog_popup_list`, source the field
  from `/api/bo/promotion?code=X&perPage=5` (listing), NOT from
  `/api/bo/promotion/{id}` (detail).
- If you only need to UPDATE non-popup fields, OMIT
  `dialog_popup_list` from the PUT body entirely — don't send `|| []`.
- To restore a wiped link, rebuild the dialog_popup_list entry as
  `{ '0': { id: popupId, start_date, end_date: null, promotion_id, labelKey, code } }`.
  See [[feedback_popups_get_405_use_listing]] for how to fetch popup
  metadata since the by-id endpoint 405s.

Same trap likely applies to other "list-shaped" relationships not
returned by the detail endpoint (currencies are documented separately in
[[project_qpro_put_currency_wipe]]).
