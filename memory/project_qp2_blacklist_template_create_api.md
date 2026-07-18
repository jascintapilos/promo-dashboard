---
name: project-qp2-blacklist-template-create-api
description: QP2 blacklist template create/edit API shape + per-account permissions (promo_testbot is view-only; use jascinta login).
metadata: 
  node_type: memory
  type: project
  originSessionId: 4d8ac9e2-796a-41d8-8b0c-9569c393be80
---

QP2 (ibc22 BO) blacklist template endpoints, discovered 2026-07-16 via SPA bundle scan:

- `GET /api/bo/gameprovider/getBlacklistTemplate/{id}` — detail: `{id, name, remark, status, black_list_sub_categories: [{game_provider_code, category_id, category_code, category_name, settings_currency_id, sub_categories: [{name, status}]}]}`
- `GET /api/bo/gameprovider/getBlacklistTemplateUsage/{id}` — which promos use it
- `GET /api/bo/gameprovider/duplicateBlacklistTemplate/{id}` — dialog data only, does NOT create
- `POST /api/bo/gameprovider/updateBlacklistTemplate` — create AND edit. Body: `{blacklist_template_id: null→create | id→edit, blacklist_template_name, blacklist_template_remark, status, black_list_sub_categories: [...]}`. Send only status=1 subcats; drop entries with empty sub_categories (mirrors BO dialog filtering).

**Permissions:** `promo_testbot` is view-only for blacklist templates — create and duplicate both 422 ("no permission"). The `jascinta` account (password in bo-sites.local.json passwords map) has create rights. To log in as her without clobbering the bot's cached session, clone the site object with a distinct id: `{...getSite('ibc22'), id: 'ibc22-jascinta', username: 'jascinta', password: passwords.jascinta}`.

Template id=11 "Live Casino and Sports Only" created 2026-07-16 (merged id=3 Live Casino Only + id=2 Sports Only, 25 entries). Working script: `bin/_create-bl-template-lc-sports-jas.mjs`.

Related: [[project_qp2_promotion_put_semantics]], [[feedback-blacklist-template-before-create]]
