---
name: canary-missing-sms-template
description: "The QPRO canary's buildApiPlan creates only the inbox message_template (message_template_id); it does NOT create or link the SMS template (message_template_sms_id). Every recent batch ships with the SMS slot null and needs a backfill pass."
metadata: 
  node_type: memory
  type: project
  originSessionId: 01415b09-50cf-4296-a456-1ac2c801f68b
---

QPRO BO promotions have TWO message-template slots:
- `message_template_id` — inbox / on-site message (created by canary)
- `message_template_sms_id` — SMS template (NOT created by canary)

Today's canary path (api-mapper-qpro.js `buildApiPlan` →
canary-api.js step 2 POST /api/bo/messagetemplate) only handles the
inbox slot. SMS templates exist on QP2D source codes but are NOT
replicated when the canary creates QPRO copies.

**Why this matters:** Operator's expectation is that "Replicate X from
QP2D" duplicates EVERYTHING about the source, including SMS. Today's
canary silently drops the SMS half. P124-P163 needed a separate
backfill pass on 2026-05-26: created 10 shared SMS templates
(Generic + Generic_BR, one pair per QPRO brand) and PUT-linked all
195 promos. See `bin/_backfill-sms-qpro-195.mjs` for the pattern.

**How to apply:**
- After ANY canary save on QPRO, verify `message_template_sms_id` is
  populated. If null, the SMS slot needs to be backfilled.
- Two paths to fix going forward:
  1. Patch `buildApiPlan` to also produce a `smsTemplate` plus a
     `step 2b: POST /api/bo/messagetemplate` for it, then the final
     PUT links both template ids.
  2. Continue backfill scripts per batch (current approach until
     the canary is patched).
- The SMS body shape:
  ```
  { name, code: 'PROMOTIONS.SMS.<NAME>', section: 8, type: 2, status: 1,
    details: { [localeId]: { settings_locale_id, subject, message } } }
  ```
  Note: each detail entry MUST include `settings_locale_id` explicitly
  — being the key alone gets 422. See [[feedback_put_body_field_renames]].
- Placeholder rule: SMS body for QPRO uses `:brandname`; QP2 uses
  `:merchantname`. If copying QP2 → QPRO, swap. See
  [[feedback_promo_template_placeholders]].

**Per-brand QPRO SMS template ids created 2026-05-26 (for P124-P163):**

| Brand | Silver/VIP (Generic) | Bronze (Generic_BR) |
| --- | --- | --- |
| QPRO3 | 454 | 453 |
| QPRO4 | 375 | 376 |
| QPRO6 | 574 | 575 |
| QPRO8 | 616 | 617 |
| QPRO10 | 498 | 497 |

Future batches that need Silver/Bronze TLEO copy can reuse these
templates rather than recreating.
