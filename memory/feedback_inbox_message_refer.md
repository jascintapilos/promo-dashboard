---
name: Inbox refer — when column N points at a template code, clone it
description: When the request sheet's column N contains "Pls refer <BRAND> inbox code\n\nPROMOTIONS.MESSAGE.<CODE>" (or similar), the canary must look up that template on the referenced brand, fetch its per-locale subject+message, clone onto each target brand, and link to the promo — NOT generate from the standard renderer.
type: feedback
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
For Reload / Free-Spin / "starter" promos the operator authors a per-promo inbox template once (e.g. `PROMOTIONS.MESSAGE.FT_RND_SLOTS_25PCT` on QPRO2) and reuses it across rows by writing a reference in column N: `Pls refer QPRO2 inbox code\n\nPROMOTIONS.MESSAGE.FT_RND_SLOTS_25PCT`. The canary should HONOR that reference — not produce a new auto-rendered template that overwrites or duplicates the author's copy.

**Why:** Per Jascinta 2026-05-18 (P071 review). The operator-authored template captures things the renderer doesn't know — specific subject + body wording, locale-specific phrasing, brand voice. Saving an auto-rendered template defeats the reuse and creates per-row template clutter.

**How to apply:**
- **Parse pattern** in column N (`inbox_message_raw`): detect `PROMOTIONS\.MESSAGE\.[A-Z0-9_]+`. Optional brand hint: `QPRO\d+|QP2[A-D]` before "inbox code". Stash in `instructions.inbox_template_refer_code` (and `_brand` when present).
- **Fetch source template by code**:
  - List endpoint: `GET /api/bo/messagetemplate?perPage=20&code=<CODE>` → find matching row → `id`.
  - Details endpoint: `GET /api/bo/messagetemplate/<id>?edit=1` → `data.message_details` (keyed object by locale_id with `subject` + `message`).
- **Clone onto each target brand**: POST `/api/bo/messagetemplate` with `{ code, name, section, type, status, details: <as fetched> }`. If code already exists on target brand (operator pre-created it), reuse that id.
- **Link to promo**: pass the cloned template id as `message_template_id` in the PUT body.

**Verified 2026-05-18** via `bin/clone-inbox-template-p071.mjs` — QP2A 1178 now linked to template id=503 (operator-pre-created on ibc22 matching QPRO2 id=246's code).

**Open work:** Wire into `bin/resolve-refer-source.mjs` (or canary directly) so future P###s with inbox refer auto-resolve without a one-off script.