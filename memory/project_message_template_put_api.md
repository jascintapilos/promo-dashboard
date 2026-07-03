---
name: project-message-template-put-api
description: "PUT /api/bo/messagetemplate/{id} wire shape for editing existing inbox templates on QPRO/QP2."
metadata: 
  node_type: memory
  type: project
  originSessionId: 800f6d4f-1aaf-4ad3-93ac-f63592540951
---

`PUT /api/bo/messagetemplate/{id}` updates an existing inbox message template.

**Required body fields** (422 without them):
```json
{
  "name": "<template name>",
  "section": 8,
  "type": 1,
  "status": 1,
  "details": {
    "<settings_locale_id>": {
      "settings_locale_id": <int>,
      "subject": "<subject>",
      "message": "<html body>"
    }
  }
}
```

**GET shape**: `GET /api/bo/messagetemplate/{id}` returns `{ message_template: {name,section,type,status,...}, message_details: {<locale_id>: {id,subject,message,settings_locale_id,...}} }`. Note `message_details` is an object keyed by locale_id, not an array.

**Locale IDs**: 1=MY_EN, 3=MY_ZH, 6=SG_EN, 7=SG_ZH, 8=ID_EN, 9=ID_ID.

Verified 2026-06-09 on QPRO5 (template 221). Response: `{"success":true,"message":["Successfully updated message template"]}`.

**QP2 quirk:** omit the `code` field on PUT — including it triggers 422 "The code has already been taken". QPRO PUT accepts `code` without issue. Confirmed 2026-06-11.

**Why:** Enables fixing inbox copy mismatches (e.g. wrong min_transfer amount) without manual BO login.
**How to apply:** Read template via GET first to get name/section/type/status, then PUT with all locales included (even unchanged ones).

Related: [[project-igmp-api-shapes]], [[project-qpro-promo-content-api]]
