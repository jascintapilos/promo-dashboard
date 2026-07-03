---
name: Always preserve dialog_popup_list across PUT
description: Any fix script that re-PUTs a promotion via plan.buildUpdate(promoId, templateId, dialog) MUST pass the current dialog (not null), otherwise the join row gets wiped. Use readDialogForPreservation() from api-client.js.
type: feedback
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
`api-mapper-qpro.buildUpdateBody()` and `api-mapper-qp2.buildUpdateBody()` both treat `dialogPopup=null` as "set dialog_popup_list to empty". That's the canary's intended behavior on initial create (when the popup hasn't been POSTed yet). But on any RE-PUT (fix scripts patching a single field), passing null silently breaks the dialog linkage.

**Rule:** before calling `plan.buildUpdate(...)` in a fix script, always:

```js
import { readDialogForPreservation } from '../src/api-client.js';
const dialog = await readDialogForPreservation(site, resolved.promo_code);
const putBody = plan.buildUpdate(promoId, templateId, dialog);
```

`readDialogForPreservation(site, promotionCode)` returns `{ id, fullRow }` or null. Uses the listing endpoint (`GET /api/bo/promotion?code=<CODE>&perPage=5`) because the detail endpoint hides `dialog_popup_list` on both QP2 and QPRO (see [project_qp2_dialog_popup_endpoint_quirks.md](project_qp2_dialog_popup_endpoint_quirks.md)).

**Why this matters:** P091-P096 lost dialog linkage during yesterday's max_withdraw / categories / promo_type fix-script runs (each passed null for dialog). `fix-relink-dialog.mjs` then put the linkage back, but on QP2 it created duplicate popups (mapper-driven re-PUT trap). Operator flagged "dialog isn't linked" in BO UI — even with API linkage restored, the BO Edit modal didn't surface it cleanly (root cause unclear; possibly stale cache or different relation read).

**Patched 2026-05-21:**
- New helper `readDialogForPreservation` in `src/api-client.js`.
- `bin/fix-p093-p096-categories.mjs` updated (both QPRO + QP2 branches).
- `bin/fix-p091-p096-promo-type.mjs` updated (QP2C branch).
- `bin/fix-p091-p096-max-withdraw.mjs` doesn't need this fix (PUTs `/api/bo/promotioncurrency/{id}` directly, doesn't touch the promotion record).
- `bin/fix-p091-p096-cta-button.mjs` doesn't touch the promotion record either (PUTs `/api/bo/popups/{id}`).
- `bin/fix-p091-p096-message-template.mjs` doesn't touch the promotion record.

**Future fix-script template:** Read the current dialog FIRST, then build update. If you're patching the popup content itself (PUT to `/api/bo/popups/{id}`), no preservation needed — only PUTs to `/api/bo/promotion/{id}` are at risk.
