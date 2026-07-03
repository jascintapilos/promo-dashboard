---
name: BIA (WS1/WS2) Directus API access
description: How to read/write WS1+WS2 promo content via the Directus REST API — auth, collection map, region→site_id, role limits, SSG cache lag.
type: project
originSessionId: faab1c01-8818-4987-850e-487dd5658e99
---
WS1 (`cms.best-in-asia.com`) and WS2 (`ws2-cms.best-in-asia.com`) both run Directus 10.8.2 and expose a REST API for content reads + writes — bypassing the UI for bulk operations.

## Auth

```js
POST {host}/auth/login
body: { email: 'promo_testbot@client.com', password: <pw>, mode: 'json' }
→ { data: { access_token, refresh_token } }
```

Then send `Authorization: Bearer <access_token>` on subsequent calls. Token rotates; just re-login if rejected.

Password is **never persisted** — supply via `BIA_PASSWORD` env var. Default email is `promo_testbot@client.com`; override with `BIA_EMAIL`.

**Kiosk site** (`kioskmy.best-in-asia.com`) returns 404 on `/auth/login` — no Directus admin API. Browser-driven only.

## Region → site_id mapping

WS1 has 8 sites (6 active):

| site_id | region | status |
|---|---|---|
| 1 | MYS | published |
| 3 | THA | published |
| 5 | SGP | published |
| 7 | KHM | published |
| 9 | IND | archived |
| 11 | IDN | published |
| 13 | PHL | archived |
| 15 | AUS | published |

WS2 has only `site_id=1` → MYS.

## Promo content collections

The 3.3-equivalent on Directus is `promotions` + `promotions_translations`:

| Collection | What it holds |
|---|---|
| `promotions` (parent) | id, status, site_id, campaignStartDate/EndDate, externalPromotion, actionButtonMode |
| `promotions_translations` | id, promotions_id, languages_code, **title, subTitle, description, content**, actionButtonText, thumbnail, image, joinNowButtonText, moreInfoButtonText |
| `promotionData` (slim lookup, only 4 fields) | promotionCode, promotionName, regionCode, promotionTypeName |
| `products` (catalog) | gamex-qqpoker, status, category |

For bulk edits, target `promotions_translations` rows directly via `PATCH /items/promotions_translations/<id>` with `{ content: newHtml }`.

## Role limitations (promo_testbot)

The role has reads on most content but is **blocked on**:
- `/items/UICarousel` and `/items/UICarousel_images` translations (the carousel image label/linkUrl/CTA). The carousel-image junction translation collection isn't readable. → UI-driven only for homepage banner labels.

`promotions_translations`, `promotions`, `sites`, `products`, `productData`, `collections`, `fields`, `relations` all readable. `promotions_translations` writable.

## Cache lag

Two distinct lags to remember:

1. **Directus list endpoint cache** — `GET /items/<coll>?filter=...` may return stale data immediately after a `PATCH`. Verify via the single-record endpoint `GET /items/<coll>/<id>` which serves fresh.
2. **Front-end SSG build cache** — WS1/WS2 front-ends (mb8mys.com, rws77.com, etc.) are statically built (Nuxt). Content changes in Directus do NOT appear on the live site until the next site build/deploy. Contrast with QPRO/QP2 where the SPA fetches at request time and updates are instant.

## Front-end domains (for verification)

WS1: `mb8mys.com`, `mb8sgd.co`, `mb8thb.com`, `mb8kh.org`, `v1-mb8.com` (IDN), `mb8au.net`.
WS2: `rws77.com`.

Promo detail modals open from `/en/promotion` after clicking the card's "More Info".

## Useful one-liner

Probe a content field across all WS1+WS2 records:

```bash
BIA_PASSWORD=... node bin/probe-cash-rebate.mjs --pattern "<term>"
```
