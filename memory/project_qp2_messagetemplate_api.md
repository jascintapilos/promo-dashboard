---
name: project_qp2_messagetemplate_api
description: "Message-template (SMS/inbox) list/detail/PUT API on QP2 ibc22; PUT omits code; templates are SHARED across all 4 merchants → use :merchantname, never a literal brand."
metadata: 
  node_type: memory
  type: reference
  originSessionId: cfef704e-f75e-4f8d-a92c-0727a011cf6f
---

QP2 (ibc22) Section 6.6 Message Templates — Inbox/SMS/Web Push — API shapes:

- **List:** `GET /api/bo/messagetemplate?perPage=200&page=N` → `data.rows` (filter client-side by `code`, e.g. `CRM.SMS.*`; SMS type = "2"). Paginate via `data.paginations.last_page`.
- **Detail:** `GET /api/bo/messagetemplate/{id}?edit=1` → `data.message_template` (name/section/type/status/code) + `data.message_details` keyed by settings_locale_id (1 MY_EN, 3 MY_ZH, 6 SG_EN, 7 SG_ZH, 8 ID_EN, 9 ID_ID), each `{subject, message}`.
- **Update:** `PUT /api/bo/messagetemplate/{id}` body `{ name, section, type, status, details: { '<localeId>': { settings_locale_id, subject, message } } }`. **On QP2 OMIT `code`** — validator 422s "already taken" (no unique-except-self). QPRO accepts `code`. (Same rule as fix-p091-p096-message-template.mjs.)
- **Create:** `POST /api/bo/messagetemplate` (see `createMessageTemplate` in src/api-client.js).

**Key gotcha — QP2 message templates are shared across ALL 4 merchants** (IBC22/KING333/ACE66/SPADE66 on one ibc22 BO). A hardcoded brand string (e.g. `ACE66`) therefore leaks to the other three brands' players. Always use the `:merchantname` placeholder (per [[feedback_promo_template_placeholders]] — :merchantname for QP2, :brandname for QPRO). For region-specific URLs the pattern is the variable glued to the country suffix: `:merchantnamemy(dot)com` / `:merchantnamesg(dot)com` (no space). Spacing: EN greeting `:merchantname:` + space before `:username`; ZH uses full-width `:merchantname：` with no space.

2026-06-07: amended all 48 `CRM.SMS.FT_*TLEO*` SMS templates (case-insensitive `ace66`→`:merchantname`) to match waiyip's hand-fixed reference id 1138. Tooling: `bin/_probe-crm-sms-templates.mjs` (read) + `bin/_amend-crm-sms-merchantname.mjs` (dry-run/--commit, full before-state in captures/api-runs/crm-sms-amend-commit.json for rollback). Bodies are generic per tier: `_BR`→"member reward"/"会员专属", non-BR→"VIP reward"/"VIP专属". Related: [[project_qpro_promo_content_api]], [[feedback_always_qc_after_save]].
