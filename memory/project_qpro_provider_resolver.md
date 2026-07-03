---
name: QPRO game_provider_ids — per-brand resolution
description: The QPRO mapper now queries each brand's installed game-provider catalog at runtime and intersects with the Layer-1 exclusion NAMES, instead of sending QPRO11's hardcoded ID list. Unblocks Deposit + FC saves on every QPRO brand whose catalog drifts from QPRO11 (verified on QPRO1 + QPRO2).
type: project
originSessionId: c72d4c31-9700-49d5-b99f-66f256fe39b9
---
QPRO BOs each have a different set of installed game providers. The mapper used to send the literal QPRO11_GP_LAYER1_EXCL constant (51 IDs) to every brand — that worked on QPRO11 by construction and on a couple of other near-identical merchants by luck, but failed elsewhere with `HTTP 422: The selected target.0.game_provider_ids.N is invalid`. The BO validates every ID against its merchant's catalog and rejects on the first miss.

**How to apply / mental model:**
- Layer-1 exclusions are uniform across brands by NAME (`918KISS, 918KAYA, ALLBET, EKOR, HABANERO, KINGMIDAS, MEGA888, DG, SSG`) — those are policy constants. The provider IDs that map to those names differ per brand.
- The mapper now fetches the brand's catalog via `GET /api/bo/gameprovider` (paginated; ~68 rows on QPRO1, ~71 on QPRO11) and filters by name, returning per-brand IDs. Only callers that pass `site` into `buildApiPlan` get the dynamic path; legacy callers fall back to the QPRO11 hardcoded list.
- Adds one GET call per canary run (~80–120 ms overhead). Not cached across runs; could be later if it matters.

**Endpoint:** `/api/bo/gameprovider` (one word, no hyphen). Paginated; default `per_page=30`; pass `per_page=100&page=N` to walk. Response shape `data.paginations + data.rows[]`, each row has `id, code, name, type, status, supported_target_type, categories[]`.

**Files touched:**
- `src/api-client.js` — added `getAllGameProviders(site, { perPage=100 })` (paginates).
- `src/api-mapper-qpro.js` — added `LAYER1_GP_EXCLUSION_NAMES` + `resolveLayer1GpIds(site)`; `buildPromotionBody` + `buildUpdateBody` now accept `gpIdsForBrand`; `buildApiPlan({ brand, site })` pre-fetches once and threads through.
- `bin/canary-api.js` — passes `site` into `buildApiPlan`.

**Categories also fixed (item C, 2026-05-16):**
- Endpoint: `GET /api/bo/categories` (plural — `/api/bo/category` 404s). Not paginated.
- Resolver: `resolveCategoryIds(site, { isFs })` in `src/api-mapper-qpro.js` filters by NAME allow-list. Non-FS allow-list = `[SPORT, LIVE CASINO, SLOTS, E-SPORTS, FISHING, CRASH, CRICKET]` (7 wallet categories). FS narrows to `[SLOTS]`.
- Catalog drift confirmed in production: QPRO1 has CRASH at id=14 and CRICKET at id=17, vs QPRO11 has them at 9/12. The old hardcoded `[9,12,4,5,2,3,1]` was silently sending QPRO1 the wrong categories — id=9 is EVENT on QPRO1, id=12 is LOTTERY2.
- Threaded through `buildApiPlan({ site })` alongside the gameprovider resolution; both fetched in parallel.

**Not yet applied to:**
- `src/api-mapper-qp2.js` — QP2 sends `game_provider_codes` (string codes, not IDs) and the QP2 catalog is uniform across all 4 merchants (shared IBC22 backend), so the drift bug doesn't bite QP2 today. If a QP2 expansion ever lands with a divergent catalog, port the same pattern.

**Verified live 2026-05-16:** QPRO1 saved promotion_id=927; QPRO2 saved promotion_id=476. Both previously failed at gp_ids index 49 and 5 respectively.

**TEST_* records created during fix verification (add to item-C cleanup pile):**
- QPRO11: TEST_P067_REL_30PCT_3X (id=175), TEST_P067_E2E_WB_V1 (id=176)
- QP2A:   TEST_P067_REL_30PCT_3X (id=1165), TEST_P067_E2E_WB_V1 (id=1166)
- QPRO1:  TEST_P067_REL_30PCT_3X (id=927), TEST_P067_E2E_WB_V1 (id assigned in run log)
- QPRO2:  TEST_P067_REL_30PCT_3X (id=476), TEST_P067_E2E_WB_V1 (id assigned in run log)
