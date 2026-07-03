---
name: Dialog popup start_date is always now, never future
description: Dialog popup `start_date` must equal the current date/time at create-time. Never schedule it for a future moment.
type: feedback
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
When creating a dialog popup (QP2 or QPRO), set `start_date` to the current date/time (`now()` formatted as `YYYY-MM-DD HH:MM:SS`). Never future-schedule it.

**Why:** Per Jascinta 2026-05-16. Players need the popup to be live immediately when the promo is created — future-dated popups silently don't render to the player until the start_date passes, which delays the campaign and confuses operators expecting the dialog to be visible right after BO save.

**How to apply:**
- `src/api-mapper-qpro.js` `buildDialogPopupBody` sets `start_date: nowYmdHms()`. Same for `src/api-mapper-qp2.js`.
- **`nowYmdHms()` MUST format in UTC.** The BO stores the value as-if it were UTC. If `nowYmdHms` returns local-timezone time (which a default `new Date().getFullYear()` etc. does), the BO ends up with a value N hours in the future — N being the VDI's local offset. Confirmed 2026-05-17 on SGT VDI (+08): every popup + promo `valid_from` was 8 hours ahead of `created_at`. Fix: use `getUTCFullYear`, `getUTCMonth`, `getUTCDate`, `getUTCHours`, etc.
- When updating an existing popup (e.g. to extend merchant scope, see `feedback_qp2_multi_merchant_share_code.md`), keep the original `start_date` rather than refreshing it to a new "now".
- Promotion `valid_from` follows the same rule (now-UTC, not future). End/`valid_to` may be null (open-ended).
