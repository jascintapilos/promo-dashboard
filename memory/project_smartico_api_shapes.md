---
name: Smartico API shapes — confirmed endpoints and wire formats
description: REST + private-api shapes for campaigns, segments, bonus templates, activity nodes (SMS/Inbox/Popup/Bonus/WhatsApp). Captured live from boapi6.smartico.ai on 2026-06-09.
type: project
originSessionId: continued-session-smartico-api-exploration
---

## Auth & Base URL

- **API backend:** `https://boapi6.smartico.ai`
- **Frontend SPA:** `https://drive-6.smartico.ai` (React, `#root`)
- **Login:** `POST /api-auth` body `{username, password, authenticatorCode, rtoken}` — rtoken is reCAPTCHA
- **Token:** stored in `localStorage.userInfo.token` (36-char UUID). Passed as `Authorization: <token>` header.
- **Label context:** `active_label_id: "24016"` header on every request.
- **Logout:** `POST /api-auth` body `{token, logout: true}`

## Two API patterns

### 1. REST resources (react-admin style)
```
GET    /api/<resource>?_start=0&_end=20&_sort=id&_order=DESC  → array, Content-Range header
GET    /api/<resource>/<id>   → single object
POST   /api/<resource>        → create (body = fields)
PUT    /api/<resource>/<id>   → update
DELETE /api/<resource>/<id>   → delete
```

### 2. Private-API RPC methods
```
POST /api/private-api?method=<name>
Body: {method: "<name>", params: {...}}
```

## Brand → Label ID map (19 brands, all QPRO)

| Label ID | Brand | QPRO |
|---|---|---|
| 755 | BP9 | QPRO2 |
| 794 | 12Huat | QPRO3 |
| 795 | BX99 | QPRO3 |
| 796 | YE55 | QPRO4 |
| 797 | U388 | QPRO5 |
| 798 | WYN8 | QPRO6 |
| 814 | MBS66 | QPRO7 |
| 815 | WILD33 | QPRO8 |
| 816 | MINT33 | QPRO9 |
| 1029 | FAIR22 | QPRO10 |
| 1033 | IBC7 | QPRO11 |
| 1034 | SBO18 | QPRO12 |
| 1035 | MSB66 | QPRO13 |
| 1036 | UO8 | QPRO14 |
| 1037 | E688 | QPRO15 |
| 1096 | ED98 | QPRO16 |
| 1097 | XE38 | QPRO17 |
| 1342 | PokiesPalace | QPRO18 |
| 1350 | OzPokies77 | QPRO19 |

## Scheduled Campaigns — `j_audience_scheduled`

**List:** `GET /api/j_audience_scheduled` (2127 total)

Key fields:
```
id, audience_name, audience_status_id (1=Draft, 4=Active, 5=Ended),
campaign_category_id, audience_exec_type_id (3=scheduled),
seed_segment_id, campaign_duration_ms,
scheduler_config: {
  type: 1|3,           // 1=one-time ("07/02/2025 07:35"), 3=cron ("0 0 11 ? * FRI")
  value: string,       // date string or cron expression
  throttling: "500",
  audienceLimit: 15000000,
  exclusionDates: null,
  throttlingInterval: "minute"
},
start_date, end_date, start_time, end_time, weekdays,
campaign_control_group_percents, campaign_control_group_fixed
```

**Clone:** `copyCampaignActivityTree` private-api (needs correct params — not fully probed).

## Segments — `j_segment`

**List:** `GET /api/j_segment` (1174 total)

Segment types:
- 1 = UserState (real-time conditions)
- 2 = CsvImport (static, from CSV upload)
- 3 = ExternalDataSource (SQL query)
- 4 = Behaviour
- 5 = CommonCases

Import segment shape (type=2):
```
{
  segment_name, segment_type_id: 2, segment_status_id: 1,
  conditions: [{"o":"has","p":"state.in_manual_upload_segments","v":"[<seg_id>]"}],
  import_file_url: "https://static6.smr.vc/<hash>-import_users_template2.csv",
  is_pending_import: null|true
}
```

**Create segment:** `POST /api/j_segment` — confirmed working.
**CSV import flow:** Upload file via `POST /api-upload` (multipart), then update segment with `import_file_url`. The `is_pending_import` flag tracks processing state.

## Activity nodes — `j_audience_activity`

**List:** `GET /api/j_audience_activity` (24483 total, filter by `audience_id=<campaign_id>`)

### Activity type IDs

| Type | Name | Role |
|---|---|---|
| 1 | Campaign Started | Entry node |
| 2 | Campaign Stopped | Terminal |
| 3 | Campaign Converted | Conversion event |
| 6 | Then | Edge/connector |
| 9 | (unknown) | Common, ~293 |
| 30 | Popup | Channel |
| 31 | Inbox | Channel |
| 40 | Push | Channel |
| 50 | Email | Channel |
| 60 | SMS | Channel |
| 63 | CustomIM | WhatsApp/custom IM |
| 100 | Give Bonus | Action |

### Common shape for all activity nodes
```
{
  id, audience_activity_id, given_by_audience_id,
  activity_type_id, activity_name, activity_status_id,
  root_audience_id, create_date, update_date,
  is_global_hidden_sniffer,
  details_json: { ... }   // type-specific
}
```

### SMS node (type=60) details_json
```json
{
  "note": "",
  "period": 1,
  "position": {"x": 560, "y": 900},
  "provider": -1,           // -1 = auto-select
  "resources": [{
    "percentage": 100,
    "resource_id": 54068,
    "resource_name": "MYS - QPRO3 - IMD - Immediate",
    "resource_content": {
      "body": "BX99: Let's make MYR before Raya...",
      "extension": {},
      "deep_links": null
    },
    "resource_type_id": 3,
    "extension_template_id": 6
  }],
  "caps_impact": ...,
  "funnel_marker": "",
  "optout_impact": ...
}
```

### Inbox node (type=31) details_json
```json
{
  "note": "",
  "position": {"x", "y"},
  "resources": [{
    "percentage": 100,
    "resource_id": ...,
    "resource_type_id": ...,
    "resource_name": "...",
    "resource_content": {
      "body": "<html>...",
      "image": "url",
      "title": "...",
      "action": "url",
      "deep_links": [],
      "open_links": 0,
      "category_id": 0,
      "show_preview": true,
      "enable_zoom_mode": false,
      "additional_buttons": []
    }
  }],
  "caps_impact": ...,
  "funnel_marker": "",
  "delivery_timeout_ms": ...
}
```

### Popup node (type=30) details_json
```json
{
  "note": "",
  "position": {"x", "y"},
  "resources": [{
    "percentage": 100,
    "resource_id": ...,
    "resource_type_id": ...,
    "resource_name": "...",
    "resource_content": {
      "image": {"checked": true},
      "title": "...",
      "button": {"checked": true},
      "button2": {"checked": true},
      "close_url": "...",
      "image_url": "...",
      "sub_title": "...",
      "button_url": "...",
      "main_width": "...",
      "button2_url": "...",
      "button_text": "...",
      "title_block": {"checked": true},
      "button2_text": "..."
    }
  }]
}
```

### Give Bonus node (type=100) details_json
```json
{
  "note": "",
  "position": {"x", "y"},
  "ui_amount": "",
  "bonus_amount": null,
  "funnel_marker": "",
  "label_bonus_template_id": 4123,
  "_enriched_bonus_template_name": "Inactive Multi Depositor FS199"
}
```

### CustomIM / WhatsApp node (type=63) details_json
```json
{
  "note": "",
  "period": 1,
  "position": {"x", "y"},
  "provider": ...,
  "resources": [{
    "percentage": 100,
    "resource_id": ...,
    "resource_name": "...",
    "resource_content": {
      "body": "...",
      "extension": {},
      "deep_links": null
    },
    "resource_type_id": ...,
    "extension_template_id": ...
  }],
  "funnel_marker": "",
  "provider_info": "..."
}
```

## Bonus Templates — `label_bonus_templates`

**Types (4 total):**

| ID | Name |
|---|---|
| 349 | Winnersoft Free Spin Bonus |
| 351 | Winnersoft Free Credit Bonus |
| 352 | Winnersoft Manual Bonus |
| 353 | Winnersoft Deposit Bonus |

**Key fields:**
```
id, name, is_enabled, product_bonus_type_id (349/351/352/353),
tech_bonus_type_id, type_name,
amount_needed: bool, coupon_needed: bool,
internal_meta: {
  "template_id-<label_id>": "<BO_promo_code>"   // per-brand BO promo code
},
internal_meta_ui: {
  "Winnersoft template <brand>": "<BO_promo_code>"  // human-readable
},
public_meta: {name, description, _translations},
bonus_payload_schema: {schemes: [...]},
create_date, modified_by, modified_date
```

**Example mapping (template 4123 "Inactive Multi Depositor FS199"):**
- template_id-755 (BP9) → "109FS_UPSELL_2"
- template_id-795 (BX99) → "RL-PP-SLOTS-199FS-SR-20250317-V2"
- template_id-798 (WYN8) → "REL_199FS_GOO_100425"

## SMS Providers

| ID | Name |
|---|---|
| -1 | Automatic selection (multi-brand) |
| 1036 | BP9 Secured SMS |
| 1041 | 12Huat Secured SMS |
| 1042 | BX99 Secured SMS |
| 1043 | YE55 Secured SMS |
| 1044 | U388 Secured SMS |
| 1045 | WYN8 Secured SMS |
| 1063+ | Per-brand Custom IM (WhatsApp) |

## Connectors — `j_audience_connector`

34711 total. Each connector record is a sub-audience that links flow nodes.
Fields include: `audience_id, enabled_by_activity_id, conditions, segment_id`.
These are the edges in the flow graph — each connector has a parent activity and conditions for when to traverse.

## Permissions (Jascinta@enigma user)

**Working:**
- GET all REST resources (campaigns, segments, bonus templates, activities, connectors, brands, SMS providers)
- POST j_segment (create segments)
- POST j_audience_activity (create activities — untested but likely)

**Blocked (500 / permission denied):**
- `importSegmentUsers` private-api
- `getSegmentUsers` private-api
- `getLabelSettings` private-api
- `copyCampaignActivityTree` private-api (likely needs params or permissions)
- POST j_audience_scheduled (campaign create — needs more fields or permissions)
- DELETE j_segment (returned 500)

## Open items for next session

1. **Segment CSV upload flow:** File upload via `/api-upload` + PUT segment with `import_file_url` — need to test with real CSV
2. **Campaign create full shape:** The 500 on POST may be missing required fields. Try with all fields from a GET response.
3. **Activity create/update:** Test POST/PUT on j_audience_activity to add flow nodes
4. **Resource management:** Resources (SMS/Inbox content) might be separate entities — check `resource_template` or `resource_communication`
5. **Start/stop campaign:** `startCampaign` and `stopCampaign` private-api methods exist
6. **Batch execution:** Check `j_audience_batch` or batch endpoints for triggering campaign runs
