---
name: QP2 promotion PUT auto-preserves dialog and template links
description: updatePromotion() now default-preserves QP2 dialog_popup_list, message_template_sms_id, and message_template_id; deliberate clears must pass preserve:false.
type: feedback
originSessionId: 2026-07-18-qp2-put-preservation
---
QP2 promotion PUTs now auto-preserve `dialog_popup_list`, `message_template_sms_id`, and `message_template_id` inside `updatePromotion()` (default `preserve: true`).

Never hand-build a QP2 promotion PUT that deliberately clears these fields without passing `{ preserve: false }`, and if you pass it, say why in the script. For one-field fixes prefer `safePromoUpdate()` (`src/qp2-safe-update.js`).

Context: FC118/FC138 popup wipe incident, 2026-07-18. QPRO is not covered by this guard.
