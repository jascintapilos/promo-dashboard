---
name: Per-brand FS provider currency filter
description: FS promos auto-filter requested currencies (and tied locales) per brand based on what the FS provider supports on that BO. Skips SGD on most QPRO brands, SGD on QP2 — operator-approved rule 2026-05-16.
type: project
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
The FS provider on each brand's BO supports a subset of currencies. The request's `currencies` list often exceeds what any single brand supports (e.g. operator asks for MYR/SGD/IDR but PP2 on QPRO6–17 supports MYR only). Per operator rule 2026-05-16: "if currencies do not exist for any BO/game provider, just create for what is available on the list."

## Wiring
- `getGameProviderDetail(site, providerId)` in `src/api-client.js` returns `{currency: [<id>, ...]}`. IDs map to currencies via: 1=MYR, 2=SGD, 3=IDR, 4=THB, 5=KHR, 6=AUD.
- Both `src/api-mapper-qpro.js` and `src/api-mapper-qp2.js` define `filterResolvedToSupportedCurrencies(resolved, supportedLabels)` — drops unsupported currencies, locales whose region maps to a dropped currency (MY→MYR, SG→SGD, ID→IDR, TH→THB, KH→KHR, AU→AUD), and corresponding `per_currency_overrides` entries.
- `buildApiPlan({ resolved, brand, site })` resolves the FS provider id, fetches its detail, builds `effectiveResolved` with the filtered subset, and threads `effectiveResolved` to every body builder (promotion / messageTemplate / dialogPopup / names / update). Returns `currencyFilter: { kept, dropped }` so the canary can surface what changed.

## Observed PP2 support by brand (2026-05-16)
| Brand | PP2 id | Supported |
|---|---|---|
| QPRO1 | 96 | MYR, IDR, THB |
| QPRO2–5 | varies | MYR, IDR |
| QPRO6–17 | varies | MYR only |
| QP2 (ibc22) | 345 | MYR, IDR |

This is per-merchant catalog drift, not a stable rule. Always resolve at runtime via the BO endpoint.

## Operator-visible output
Canary prints:
```
Currencies: MYR, SGD, IDR   Locales: MY_EN, MY_ZH, SG_EN, SG_ZH, ID_EN, ID_ID
           ↳ FS provider supports only MYR, IDR on QPRO1 — dropped SGD
```
So Jascinta can see at a glance which locales got skipped per brand.
