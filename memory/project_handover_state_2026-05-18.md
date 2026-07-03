---
name: Handover state — promo canary as of 2026-05-18
description: End-of-day snapshot of what the multi-brand promo canary does, what's manual, and the known edge cases. Read this before taking the wheel.
type: project
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
## The operator workflow

```
node bin/ingest-requests.js                  # 1. ALWAYS first — pull current sheet
node bin/resolve-refer-source.mjs P###-rNN --commit   # 2. If row has "Pls refer X" or
                                              #    matches "<RATE>% <CAT> Reload" pattern
node bin/canary-multi-brand.js P### --commit  # 3. Run on all brands in fixture
```

For ~80% of rows step 2 is a no-op (operator fills the row directly). For "Pls refer" / sparse-fixture cases the resolver merges in source values from a referenced promo (typically on QPRO2).

## What's automated end-to-end

| Capability | Status |
|---|---|
| Sheet → fixture ingest (live Google Sheets API) | ✅ stable |
| Auto-named promo_code + EN/ZH names from parsed fields | ✅ |
| Multi-brand orchestrator (canary-multi-brand.js) dispatches QPRO vs QP2 | ✅ |
| QP2 multi-merchant: extend merchant_ids + clone popup per merchant + expand member_group_ids | ✅ |
| Per-brand FS provider id resolution (`/api/bo/gameprovider` filter by code) | ✅ |
| FS game-code resolver (exact + stem-set, no aliasing) | ✅ |
| Per-brand FS currency auto-filter (drops unsupported currencies) | ✅ |
| Category filter ("X, Y, Z only" → restrict promotion_category_ids) | ✅ |
| Tier constraint on QP2 ("Silver and below" → narrow member_group_ids) | ✅ |
| QPRO never sets member_group_ids (tier prefix in code is reference only) | ✅ |
| QP2 deposit_status=4 ("Last Deposit") when min_deposit>0; =1 ("None") else | ✅ |
| Layer-1 game provider exclusion by name OR code (catches DG, SSG) | ✅ |
| UTC datetime in valid_from + popup start_date | ✅ |
| Per-locale promotion_name rows tied to region's currency (MY→MYR, SG→SGD, ID→IDR) | ✅ |
| Resolver pulls source's per-locale names (not BO admin label), strips "REL" suffix | ✅ |
| Inference: `<RATE>% <CAT> Reload` → candidate `FT_REL_<CAT>_<RATE>PCT`, probe BO | ✅ |
| Multi-brand orchestrator writes back `status="Created"` + code + names | ✅ |
| QPRO PUT does NOT re-send promotion_currency (avoids SGD/IDR wipe) | ✅ |
| QP2 PUT re-emits promotion_currency with max_total_*=0 (POST uses null) | ✅ |

## What needs manual operator action

- **Inbox refer with code (column N says `Pls refer X inbox code PROMOTIONS.MESSAGE.<NAME>`)** — currently requires `bin/clone-inbox-template-p071.mjs` as a one-off per promo. NOT yet wired into the auto-flow. Future P###s with inbox refer must run that script after the canary, OR the canary creates a generic template (suboptimal but functional).
- **Cashback** — no authored T&Cs; mapper emits operator-handoff prompt.
- **TH locale** — body renderer skips silently.
- **QPRO redo after archive** — archive doesn't free the code; bump suffix (`_V2`) or change the campaign portion.

## Known edge cases / gotchas

1. **QPRO archive leaves code reserved.** DELETE returns success but `code already taken` on re-POST. Bump suffix for redo, or accept the orphan.
2. **QP2 PUT/POST currency-field asymmetry.** `promotion_currency.X.max_total_applications` and `.max_total_bonus`: PUT requires int (0 ok), POST /promotioncurrency requires null. Mapper uses null + PUT body coerces to 0 in an IIFE.
3. **QP2 inline POST vs standalone POST on /promotioncurrency:** different validators. Inline (POST /promotion with embedded promotion_currency) accepts null; standalone POST `/promotioncurrency` rejects 0 on `max_total_*` and `max_withdraw`. Backfill scripts use null.
4. **QPRO list endpoint hides soft-deleted name + currency rows.** If a previous PUT silently soft-deleted a row, the listing shows the visible subset but new POSTs fail with "already exists". Re-POST is blocked; operator updates via BO UI.
5. **`currencies_ids` field is unreliable** — it can show `[1,2,3]` even when only 2 rows are real. Trust `/api/bo/promotioncurrency?promotion_id=X` count instead.
6. **QPRO5–17 are MY-only brands.** Operator's request may list 4 locales but only MY_EN + MY_ZH are valid per brand. The canary still tries to POST SG locales — they may succeed transiently then disappear, leaving soft-deleted rows. Visible state will be 2 rows on QPRO5+; that's correct per operator (2026-05-18 rule).
7. **Cross-merchant code uniqueness on ibc22.** QP2A/B/C/D share the BO. Multi-merchant promos use ONE promo row with extended `merchant_ids`, NOT separate codes. The canary auto-extends.
8. **`BRAND_TO_SITE` and other constants are scattered** — pay attention to `QP2_BRAND_TO_IDS` (per-merchant siteId in api-mapper-qp2.js), `LAYER1_GP_EXCLUSION_NAMES` (in api-mapper-qpro.js), and `CURRENCY_TO_ID` (both mappers). Drift between mappers is a bug source.
9. **THB / KHR / AUD currency IDs unverified.** Mapper has placeholders ('?'). Probe `/api/bo/currency` before using.
10. **`detail.name` (BO admin label) ≠ per-locale `promotion_name`.** When pulling from source, ALWAYS use the `/promotionname` rows for clean consumer-facing names. The admin label often has suffixes like "REL".

## Helper scripts (one-off, kept in `bin/`)

- `archive-and-rerun-qpro59.mjs` — QPRO archive pattern (DELETE then re-POST — code reserved)
- `bulk-archive-p068-orphans.mjs` — bulk deactivate+archive across brands
- `clone-inbox-template-p071.mjs` — clone a template by code from one brand to another + relink promo
- `clone-v5-popups-multi-merchant.mjs` — clone popup per merchant + attach to dialog_popup_list
- `fix-today-utc-dates.mjs` — backfill valid_from + start_date to current UTC
- `fix-v5-popup-links.mjs` — repair dialog_popup_list using full popup rows (not join rows)
- `add-missing-currency-rows.mjs` — POST per-currency rows that POST missed
- `backfill-currency-and-names.mjs` — audit + add missing currency + name rows
- `fix-p072-rerun-puts.mjs` — re-PUT existing saves to pick up mapper fixes
- `update-p072-names.mjs` — PUT existing promotion_name rows with new text
- `extend-qp2-merchants.mjs` — one-off PUT to add merchant to existing QP2 promo
- `resolve-refer-source.mjs` — fixture-fill from referenced source

## Today's saved state (P071 + P072)

| Promo | Brand | id | Notes |
|---|---|---|---|
| TEST_FT_REL_SLOTS_25PCT | QP2A | ibc22 1178 | merchant_ids=[IBC22,SPADE66]; deposit Last Deposit; template id=503 (operator-pre-created); popup ✓ |
| TEST_FT_REL_SLOTS_25PCT | QPRO5 | archived | code soft-locked |
| TEST_FT_REL_SLOTS_25PCT | QPRO9 | archived | code soft-locked |
| FT_REL_LC_25PCT | QP2B | ibc22 1179 | merchant_ids=[KING333]; deposit Last Deposit; MYR+SGD; 4 clean+ZH names |
| FT_REL_LC_25PCT | QPRO7 | 339 | MY-only — MYR currency, 2 clean+ZH names; DG/SSG excluded (gp_count=53) |
| FT_REL_LC_25PCT | QPRO10 | 257 | same as QPRO7 |

## Carryover from yesterday (P067–P070)

- P069/P070 stuck on MYR-only on QPRO4–17 (soft-deleted SGD/IDR rows from earlier wrong-CURRENCY_TO_ID mapping; operator decided to fix via BO UI rather than archive+redo).
- All four codes (P067–P070) saved cleanly on QPRO1–3 + QP2 with the corrected mapper.
- ~120 TEST_* records accumulated across BOs as test artifacts (operator manual archive when convenient).