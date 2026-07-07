---
name: project-ft-api-tenant-segment
description: "FastTrack /crm-api/ URLs need a per-instance tenant segment after /crm-api/ — bare paths return the SPA HTML shell (200), not JSON."
metadata: 
  node_type: memory
  type: project
  originSessionId: a11a81be-ebc2-44a2-96b5-e912e12b0c78
---

FastTrack CRM API paths include an opaque **per-instance tenant segment** between `/crm-api/` and the endpoint:

`https://<instance>.ft-crm.com/crm-api/<TENANT>/<Endpoint>`

- **qpro1** (`alpha-iota-qp1.ft-crm.com`) tenant = `2jdauyjn44` (confirmed 2026-07-07, API version 18183).
- **ws1** (`mb8.ft-crm.com`) tenant = `x2avv90vh1` (confirmed 2026-07-07; AdminUsers 75, Segments cat1 2114, Activities 1777). gabrielle account = brandId 230.
- **qp2** tenant still unknown — discover per instance (do not assume another instance's code).

**Gotcha:** a bare path like `/crm-api/Authentication/AdminUsers` (as older probe scripts + [[project-ft-crm-pull]] documented) returns **HTTP 200 with the SPA HTML shell**, not JSON — it looks "OK" but `content-type: text/html`. Always include the tenant segment. Verified working with tenant: AdminUsers (83 users, Success:true), Segments/ByCategory/1 (1509), Activities/GetActivities (1457).

**How to discover the tenant** for a new instance: run a headless network intercept with the saved session cookies and watch the real `/crm-api/<X>/...` calls the app makes (see `tmp-ft-netdiscover.mjs` pattern — navigate to `/v2/`, log responses matching `/crm-api|api/`). The tenant is the path segment right after `crm-api`.

**Auth:** unchanged — custom `authtoken: <portaltoken cookie value>` header (16-char opaque id), NOT `Authorization: Bearer`. See [[project-ft-crm-pull]].

**Session file convenience:** `capture-ft-session.mjs` output now carries `apiTenant` + `apiBase` fields once probed; read `session.apiBase` directly instead of rebuilding the path.

Related: [[project-ft-auth-flow]] (login), [[project-ft-crm-pull]] (auth header + data endpoints).
