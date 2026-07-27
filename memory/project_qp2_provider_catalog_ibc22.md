---
name: project_qp2_provider_catalog_ibc22
description: "QP2 /api/bo/gameprovider returns HTTP 500 on ibc22 — the authoritative 50-code 'all providers except ALLBET' list can only be read back from a saved promo, and the mapper's category→provider map is incomplete."
metadata:
  node_type: memory
  type: project
---

# QP2 provider catalog is NOT readable from the API (ibc22, confirmed 2026-07-27)

`GET /api/bo/gameprovider` returns **HTTP 500** on the ibc22 BO for every variant tried:
`?per_page=N&page=1`, `?perPage=N&page=1`, `?paginate=false`, `?merchant_id=4`, bare path,
`/list`, `/getAll`, `/getAllGameProvider`, `/dropdown`, `/getGameProviderList`, `/category`.
(`/api/bo/gameprovider/getAllBlacklistTemplate` and `/getBlacklistTemplate/{id}` DO work —
only the provider-listing route is broken.) QPRO sites are unaffected — `qpro2` returns 30 rows fine.

**Consequence:** you cannot enumerate installed providers on QP2 from the API. Deriving the
list by unioning `game_provider_codes` across sampled promos **under-counts**.

## Authoritative "All game providers except ALLBET" — 50 codes

Operator-confirmed by waiyip 2026-07-27 via the BO's own provider picker, then read back
from promotion 1265 (`WELC_WC120PCT_10X`, SPADE66):

```
2BC, 9W, AG, AP, AVI, BG, BNG, BOOM, BTG, BTI, CMD, COSMO, CQ9, EVOK, EZ, FC, FP, FS,
HSG, IM, JDB, JILI, JK, KA, LIVE, LUCKY, MAHA, MAX, MGP, MONKEY, NET2, NEXT, NLC, PP2,
PTI, RG, RT2, SA, SBO2, SEXY, SG, SIMPLE, SPRIBE2, TF, VIVO, WBET, WF, WM, XE, YB
```

Notable: includes **SPRIBE2** and **WF**, which appear on no other promo we sampled;
**excludes 365G**, which a 46-code union from reference promo 254 wrongly included.
ALLBET (`AB`) is absent — it is hard-excluded estate-wide.

## The mapper's category→provider map is incomplete

`QP2_CATEGORY_PROVIDER_CODES` in `src/api-mapper-qp2.js` has no entry for **SPRIBE2, WF,
BTI, COSMO, 365G, GXW**, so `filterQp2ProvidersByCat()` silently drops them. On this promo it
produced 42 codes for SPORT+SLOTS+LC and would have removed BTI/COSMO/SBO2 that were
legitimately present. Treat its output as a floor, not the answer — and never let it *remove*
providers from an existing promo without operator sign-off.

Also note `isHardExcludedGameProvider({code:'SBO2'})` returns **true** (prefix-matches the
`SBO` entry), yet SBO2 is live on operator-approved promos including reference 254. Do not
auto-strip SBO2.

## How to apply

- Need the full provider list for a QP2 promo? Read it back from a known-good saved promo,
  or have the operator select it in the UI and read the record — do not synthesise it.
- Category-restricted promos still need BOTH categories and providers set —
  see [[feedback_category_and_provider_must_match]].
- Blacklist sub-category derivation is scoped to the promo —
  see [[feedback_qp2_blacklist_scoped_derivation]] and [[project_qp2_promotion_put_semantics]].
