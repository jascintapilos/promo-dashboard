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
  `{ '0': { id: popupId, popup_id: popupId, start_date, end_date: null, promotion_id, labelKey, code } }`.
  See [[feedback_popups_get_405_use_listing]] for how to fetch popup
  metadata since the by-id endpoint 405s.

**Separate bug — stale popup ID (not wipe): confirmed root cause 2026-07-11**
The QPRO canary linking PUT (`buildUpdateBody`) sent `dialog_popup_list` with `id`
but **without `popup_id`**. QPRO junction records require both fields to equal
the same popup ID (`id == popup_id`). Without `popup_id`, the BO silently fails
to resolve the FK and falls back to a label/code-based lookup, surfacing the
PREVIOUS campaign's popup with the same label — resulting in a stale popup ID
instead of the freshly-created one. This caused all 48 QPRO brands to mismatch
on P061–P064 and again on P176–P179.

**Fix applied 2026-07-11:** `src/api-mapper-qpro.js` `buildUpdateBody` line ~832 —
added `popup_id: dialogPopup.id` alongside the existing `id: dialogPopup.id`.
The fix script `bin/fix-dialog-popup-link.mjs` had the correct shape (`id + popup_id`)
all along; the canary mapper was missing one field.

Same trap likely applies to other "list-shaped" relationships not
returned by the detail endpoint (currencies are documented separately in
[[project_qpro_put_currency_wipe]]).
