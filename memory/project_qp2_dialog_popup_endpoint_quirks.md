---
name: QP2 dialog popup — endpoint quirks
description: GET /api/bo/promotion/{id} (detail) does NOT return dialog_popup_list. Use the listing endpoint. Popups can't be DELETEd — PUT status=0 to deactivate. Re-running mapper-driven PUT can create duplicate popups if the fix script rebuilds the plan instead of just patching the link.
type: project
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
Three gotchas on QP2 (ibc22) for the dialog popup feature, surfaced 2026-05-20 during P091-P096 followup work.

### 1. Detail endpoint hides dialog_popup_list

- `GET /api/bo/promotion/{id}` → `data.rows.dialog_popup_list` is **undefined**, even when popups are linked.
- `GET /api/bo/promotion?code=<CODE>&perPage=5` → `data.rows[0].dialog_popup_list` returns the join-table rows (each with `popup_id`, `promotion_id`, `created_at`, etc.).

When verifying linkage, always use the listing endpoint. If you only check the detail endpoint you'll incorrectly conclude no popup is linked.

### 2. Popups can't be DELETEd — PUT status=0 instead

- `DELETE /api/bo/popups/{id}` → HTTP 405 Method Not Allowed.
- `PUT /api/bo/popups/{id}` with `{ ...popupRow, status: 0 }` → succeeds and removes from active listings.
- **Date format requirement:** the PUT validator rejects ISO format (`2026-05-20T09:45:08.000000Z`) — you must reformat `start_date`/`end_date` to `Y-m-d H:i:s` (e.g. `2026-05-20 09:45:08`). Use a helper:
  ```js
  const fmt = (iso) => { if (!iso) return null; const d = new Date(iso); const p = n => String(n).padStart(2,'0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };
  ```

### 3. Mapper-driven PUT creates duplicate popups

When re-PUT-ing a QP2 promotion via `plan.buildUpdate(promoId, templateId, dialogPopup)` with `dialogPopup = { id, fullRow }`, the BO interprets the `dialog_popup_list.0` value as "create-or-link" semantics. If the existing popup is already linked, the PUT may create a fresh popup with new ID and link to that instead. This happened in `bin/fix-p091-p096-relink-dialog.mjs` — popups 1122-1124 got replaced by fresh 1146-1148 on QP2C P091-P093 (P094-P096 kept their original popups, possibly due to timing or a slightly different code path).

**Mitigation when patching live records:**
- Don't re-PUT via the mapper if popups are already linked correctly — check the listing endpoint first.
- If you must re-PUT, consider stripping `dialog_popup_list` from the put body before sending (preserve via separate PUT step or leave existing link intact via DB).
- Alternatively, post-PUT, audit for duplicate popups and deactivate the orphans (`PUT status=0`).

This is QP2-specific; QPRO uses a 6-field shape (`{ popup_id: N }`) and doesn't exhibit the same duplication behavior.
