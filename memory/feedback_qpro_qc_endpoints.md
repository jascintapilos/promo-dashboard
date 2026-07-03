---
name: qpro-qc-endpoints
description: "QPRO QC endpoint paths — per-currency economics, MT, dialog popups, and dialog↔promo link all use different endpoints than the promo detail GET."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9b3d4c18-171b-4d17-add7-ab89c833c94c
---

When QC'ing a saved QPRO promo, the **promo detail GET (`/api/bo/promotion/{id}`) does NOT include several critical fields**. They live on different endpoints. Use these specifically:

| What to check | Endpoint | Field path |
|---|---|---|
| Rendered Bonus Type label | `/api/bo/promotion?limit=200&page=1` (list) | `rows[i].bonus_type` |
| Per-currency economics (min_transfer, max_bonus, max_xfer_out) | `/api/bo/promotioncurrency?promotion_id={id}` | `data.rows` |
| MT subject + body per locale | `/api/bo/messagetemplate/{id}` | `data.message_details["1"\|"3"\|"6"\|"7"].subject` + `.message` |
| Dialog popup detail | `/api/bo/popups?perPage=500&...` (find by id) | not GET-able by id (405) — must filter from list |
| **Dialog ↔ Promo link** | `/api/bo/promotion?limit=500&page=1` (list, NOT detail) | `rows[i].dialog_popup_list[]` (join table rows) |

**Why:** the detail GET returns the editable PUT shape, not the full materialized view. The list GET returns the rendered view with joins resolved.

**Common pitfall:** seeing `dialog_popup_list: []` on detail GET makes it look like the link is missing — it's not, just not exposed there. Always check the list view.

**Locale ID map:** `1=MY_EN, 3=MY_ZH, 6=SG_EN, 7=SG_ZH` (verified). MT keys `message_details` by these as strings.

Captured 2026-06-22 during P119–P121 QC.
