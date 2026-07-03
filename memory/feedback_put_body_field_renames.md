---
name: put-body-field-renames
description: "BO endpoints alias key fields between GET and PUT — GET returns `settings_currency_id`/`settings_locale_id` but PUT expects `currency_id`/explicit `settings_locale_id` inside each detail. Echo back the GET fields PLUS the renamed aliases or the 422 hits."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 01415b09-50cf-4296-a456-1ac2c801f68b
---

When building a PUT body by GET-modify-PUT-back, BO endpoints rename or
require extra fields the GET doesn't provide:

| Endpoint | GET returns | PUT requires (in addition) |
| --- | --- | --- |
| `/api/bo/promotioncurrency/{id}` | `settings_currency_id` | must add `currency_id` (same value) |
| `/api/bo/messagetemplate/{id}` (POST or PUT details) | details keyed by locale_id | each detail entry needs explicit `settings_locale_id` field inside the object — being the key alone is not enough |
| `/api/bo/promotion/{id}` PUT | dates as `2026-03-17T09:32:00.000000Z` | dates must be `Y-m-d H:i:s` — strip the `T` and `.000000Z` |
| `/api/bo/promotion/{id}` PUT | `promotion_category` array of join rows `{id, category_id, ...}` | `promotion_category_turnover` array of `category_id` values (NOT join-row id) |
| `/api/bo/promotionname/{id}` PUT | row with `promotion_name_id` | echo `promotion_id`, `currency_id`, `settings_locale_id` plus new `promotion_name` + `rewards_name` |

**Why:** Each of these surfaced as a 422 during the 2026-05-26 QPRO2
mismatch fix + SMS template backfill. Without the aliases the BO rejects
with messages like "The currency id field is required",
"The details.1.settings locale id field is required",
"The valid from does not match the format Y-m-d H:i:s",
"The selected promotion_category_turnover.0 is invalid".

**How to apply:** When writing a GET-modify-PUT helper, normalize fields
BEFORE building the body:
```js
const body = { ...row, currency_id: row.settings_currency_id, ... };
```
And for dates: `String(iso).replace(/T/, ' ').replace(/\.\d+Z?$/, '').slice(0, 19)`.

Related: [[project_qpro_put_currency_wipe]], [[feedback_promotion_put_dialog_popup_list_wipe]].
