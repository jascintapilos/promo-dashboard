---
name: project-blacklist-template-put-api
description: "QPRO blacklist template update API — endpoint, body shape, verification gotcha, and sub-cat logic for LC+Slot templates."
metadata: 
  node_type: memory
  type: project
  originSessionId: 3db31d48-267e-4de2-a487-bde8ee73bca7
---

# QPRO Blacklist Template Update API (confirmed 2026-06-08)

**Endpoint:** `PUT /api/bo/blacklist/{id}`

**Body shape (from SPA bundle reverse-engineering):**
```json
{
  "name": "Live Casino and Slot",
  "remarks": "",
  "status": 1,
  "sub_categories": {
    "1": [441, 442, 228, ...],   // MYR sub-cat IDs
    "3": [10, 420, 421, ...]     // SGD sub-cat IDs
  }
}
```
`sub_categories` is keyed by `settings_currency_id` (string), value = array of `game_provider_sub_category_id` integers.

**⚠️ Verification gotcha:** `GET /api/bo/blacklist/{id}` (detail endpoint) returns `settings: []` regardless. Verify via:
1. The PUT response body itself — includes the full updated `settings` array.
2. `GET /api/bo/blacklist?perPage=200` (LIST endpoint) — shows correct `settings`.

**Sub-cat ID source:** Use IDs from `GET /api/bo/blacklist/gameprovider` (structure: `data.rows` = object keyed by currency_id → `[{game_provider_code, categories: [{name, sub_categories: [{id, name, status}]}]}]`).

## qpro5 "Live Casino and Slot" (id=9) — configured 2026-06-08

**Before:** `settings: []` (empty since 2026-05-28 creation)
**After:** 102 settings — MYR(62) + SGD(40) — confirmed via PUT response + list

**How LC+Slot sub-cats were derived for qpro5:**
- MYR: LC sub-cats (24) from "All games" MYR filtered by `cat === 'LIVE CASINO'` + Slots sub-cats (38) from "Slots Only" MYR template = 62 unique (zero overlap)
- SGD: All 40 sub-cats from "Slots, LC, Sports" SGD — because qpro5 has zero Sports-SGD sub-cats (verified: "Sports only" template has no SGD settings), so "SLC+Sports" SGD = Slots+LC for SGD
- **Why NOT use "LC Only" template:** qpro5's "LC Only" (id=8) is misconfigured — includes sub-cats from ALL categories (172 MYR items spanning Slots+LC+Crash+Sport+Fishing...). Do not use it as reference.
- **Use "All games" as LC reference** for brands where "LC Only" is misconfigured.

## Sub-cat catalog for qpro5
Saved at `captures/blacklist-templates/qpro5-subcat-catalog.json` — built 2026-06-08 from `/api/bo/blacklist/gameprovider`. 411 sub-cats total (MYR+SGD). Category breakdown: LC=261, SLOTS=95, SPORT=20, E-SPORTS=8, FISHING=16, CRASH=3, CRICKET=4, LOTTERY/TABLE/POKER=4.

**Note:** Not all sub-cats in the catalog are active on qpro5. The templates (especially "All games") are the true indicator of which sub-cats are active. "All games" MYR = 70 active sub-cats = LC(24)+SLOTS(37)+SPORT(7)+E-SPORTS(2). Catalog has 95 SLOTS but only 37-38 are active for MYR.

## How to apply
Script: `bin/_patch-qpro5-lc-slot-template.mjs [--commit]`
- Dry-run: shows counts without applying
- `--commit`: applies and verifies via list endpoint

## Related: [[project-blacklist-template-resolver]]
