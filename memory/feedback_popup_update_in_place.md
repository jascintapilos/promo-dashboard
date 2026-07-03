---
name: feedback-popup-update-in-place
description: "When fixing dialog popup content/CTA/title for an existing promo, UPDATE the existing popup in place — never create a new popup and relink."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 82477a57-d4ec-4d6b-a25e-ecac80954716
---

When a dialog popup attached to a saved promo needs to change (body, CTA, title, position, etc.), **update the existing popup in place** via `PUT /api/bo/popups/{popupId}`. Do not create a new popup and re-link via the promo's `dialog_popup_list`.

**Why:** Creating new + re-linking leaves orphan popups in the BO — they remain visible in Section 14.1.2, polluting the dropdown when configuring future promos, and require a separate deactivate/cleanup pass. Updating in place keeps a 1:1 popup ↔ promo relationship.

**How to apply:**
1. Resolve the existing popup_id from the promo: use `readDialogForPreservation(site, code)` (helper in `src/api-client.js`) — it reads `GET /api/bo/promotion?code=<CODE>&perPage=5` (the **listing** endpoint exposes `dialog_popup_list`; the detail endpoint does not).
2. Fetch the full popup row: `GET /api/bo/popups?perPage=500&page=1&sort_by=id&sort_order=desc` then `find((p) => p.id === popupId)`.
3. Modify `contents` (or whatever fields need changing). Preserve `id`, `code`, `position`, `session`, `status` unless explicitly changing them.
4. PUT body shape: spread the original row + override the changed fields + normalize dates (`toYmd(p.start_date)`). See `bin/_fix-popup-cta-labels.mjs:42-76` for the canonical pattern.
5. PUT to `/api/bo/popups/{popupId}` — single round-trip, no relink needed.

**Anti-pattern (do not use going forward):** `createDialogPopup()` + `updatePromotion()` with new `dialog_popup_list` link. This is what `_fix-p091-p096-popups.mjs`, `_fix-p075-p084-popups.mjs`, `_fix-p102-p105-popups.mjs`, and `_fix-p104-p105-fc-popup-body.mjs` did. Those scripts left ~24 orphan popups in BO across QPRO3/4/5/9 from the P102-P105 work (2026-05-22) — eligible for cleanup later.

See also [[feedback-fc-popup-template]] (FC-specific template), [[feedback-dialog-popup-cta-label-link]] (CTA rules), [[project-qp2-dialog-popup-endpoint-quirks]] (detail-endpoint gotcha).
