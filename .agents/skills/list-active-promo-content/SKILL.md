---
name: list-active-promo-content
description: Use when the user asks for the active promotion content of a brand on a QPRO Back Office — phrasings like "active promo content for SPADE66", "show KING333 promotion contents on ibc22", "list active contents on <site>". Lists records from the 3.3 Promotion Contents page (NOT the 3.2 Promotion Codes page). Supports multiple BO sites via the `--site=<id>` flag.
---

# List active promo content for a brand

## Trigger

User asks for the **active promotion contents** of a specific brand on a QPRO BO.

If they ask for "promotion codes" or "promotions" (the 3.2 page — different IDs/shape), use `bin/promotions.js` instead. Different page, different endpoint. Don't confuse the two.

## Run it

```bash
node bin/promo-contents.js [--site=<id>] <BRAND> [--all] [--limit=N] [--json]
```

Cross-platform — same command on macOS, Linux, Windows (cmd, PowerShell, WSL).

- `--site=<id>` — picks a site from `bo-sites.json`. Omit to use `defaultSite`.
- `<BRAND>` — merchant name or prefix (`SPADE66` or `S66`), case-insensitive. Resolved through the session's `merchant_dropdown`.
- `--all` — fetch every page (parallel). Without it, only the first page is returned.
- `--limit=N` — truncate to first N rows after fetching.
- `--json` — emit JSON instead of tab-separated table (suitable for piping into `jq` or files).

## What's happening underneath

- Authenticated via on-disk session cache (`.session/<site-id>.json`). First call logs in to that site; later calls reuse the token until expiry or 401 (auto-refresh inside `authedFetch`).
- API: `GET <apiHost>/api/bo/promotioncontent?perPage=100&page=N&sort_by=id&sort_order=desc&status=1&type=0&site_id=<merchantId>`
- Sessions are per-site; running this against site A doesn't affect site B's cache or vice versa.

## Things that will bite you

- **Param name is `site_id`, not `merchant_id`.** Same numeric id-space as the rest of the BO (resolve via `merchant_dropdown` returned by login), but the 3.3 endpoint insists on the `site_id` spelling.
- **`type=0` is required.** Omitting it returns `HTTP 500 — Something is wrong. Please contact system admin. (I22-xxxx)`. The `I22-` prefix is just the error-id format; it is **not** telling you the session is wrong.
- **23 ≠ 723.** The 3.3 Promotion Contents listing for SPADE66 on ibc22 has 23 active rows. The 3.2 Promotion Codes listing for the same brand has 723. If a user shows you the 3.3 screen and you return 723, you've called the wrong endpoint.
- **Default site silently chosen.** If the user names a brand but no site, the command uses `bo-sites.json → defaultSite`. If their intent isn't clear (e.g. multiple sites configured and the brand exists on both), ask which site they meant rather than guessing.

## Quick site discovery

```bash
node bin/sessions.js list      # what sites exist + which have a live session cached
```

## Library form (when scripting, not CLI)

```js
import { getSite } from './src/sites.js';
import { resolveMerchant, getAllPromotionContents } from './src/api-client.js';

const site = getSite('ibc22');            // or omit for defaultSite
const m = await resolveMerchant(site, 'SPADE66');     // → {id: 4, name, prefix}
const { rows, total, pages } = await getAllPromotionContents(site, {
  siteFilterId: m.id,
  status: 1,         // 1=Active, 0=Inactive, 'all'=both
  type: 0,           // REQUIRED, always 0
  sortBy: 'id',
  sortOrder: 'desc',
  // optional: categoryId — 1 Show All, 6 Sports, 9 New Member, 10 Slots, 11 Apps, 12 Casino, 13 Fishing
});
```

`authedFetch(site, path)` handles session caching transparently: first call logs into that site, later calls reuse, 401/419 triggers one transparent re-login + retry.

## Row schema (fields likely to matter)

```
id, code, site_id, merchant_name, promo_code, promotion_code,
categories, category_id[], content_type ("desktop, mobile"),
member_visibility, member_visibility_name, position, max_application,
title, status (1=Active), locales ("MY_EN, MY_ZH, ..."),
applications, created_by, created_at, updated_by, updated_at
```
