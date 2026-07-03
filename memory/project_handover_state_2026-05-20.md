---
name: Handover state — promo canary as of 2026-05-20 (current)
description: End-of-day snapshot of the multi-brand promo canary. Supersedes the 2026-05-18 handover — adds today's auto-namer dedup pass + 4 mapper fixes (max_withdraw, categories parser, promo_type, blacklist alignment). Read this first when picking up.
type: project
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
## The operator workflow

```
node bin/ingest-requests.js                  # 1. ALWAYS first — pull current sheet (auto-dedup MIN suffix)
node bin/resolve-refer-source.mjs P###-rNN --commit   # 2. If row has "Pls refer X" or
                                              #    matches "<RATE>% <CAT> Reload" pattern
node bin/canary-multi-brand.js P### --commit  # 3. Run on all brands in fixture
```

For ~80% of rows step 2 is a no-op (operator fills the row directly). For "Pls refer" / sparse-fixture cases the resolver merges in source values from a referenced promo.

**New today (2026-05-20):** Step 1 now auto-applies `_MIN<amount>` suffix to any auto-named codes that collide within the batch (same code + ≥1 shared brand + differing min_deposit). Operator-typed codes are left alone. Look for "Dedup: N codes patched" in the ingest summary.

## What's automated end-to-end

| Capability | Status |
|---|---|
| Sheet → fixture ingest (live Google Sheets API) | ✅ stable |
| Auto-named promo_code + EN/ZH names from parsed fields | ✅ |
| Auto-namer batch dedup — `_MIN<amount>` on colliding codes | ✅ (NEW 2026-05-20) |
| Multi-brand orchestrator dispatches QPRO vs QP2 | ✅ |
| QP2 multi-merchant: extend merchant_ids + clone popup per merchant + expand member_group_ids | ✅ |
| Per-brand FS provider id resolution (`/api/bo/gameprovider` filter by code) | ✅ |
| FS game-code resolver (exact + stem-set, no aliasing) | ✅ |
| Per-brand FS currency auto-filter (drops unsupported currencies) | ✅ |
| Category filter via "X, Y, Z only" pattern (rule J) | ✅ |
| Category filter via "Game Categor(y/ies) : X/Y" pattern WITHOUT "only" (rule J') | ✅ (NEW 2026-05-20) |
| Tier constraint on QP2 ("Silver and below" → narrow member_group_ids) | ✅ |
| QPRO never sets member_group_ids (tier prefix in code is reference only) | ✅ |
| QP2 deposit_status=4 ("Last Deposit") when min_deposit>0; =1 ("None") else | ✅ |
| QP2 promo_type=2 (Deposit Bonus) for deposit/cashback; never falls through to 1 (Manual) | ✅ (FIX 2026-05-20) |
| QP2 max_withdraw stays null (Unlimited) unless explicitly set — never aliased to max_bonus | ✅ (FIX 2026-05-20) |
| Dialog popup CTA: text+link paired. min_deposit>0 → DEPOSIT/存款/Deposit + /member/deposit; else CLAIM NOW/立即领取/Klaim Sekarang + /member/reward | ✅ (FIX 2026-05-20) |
| Deposit inbox subject = "Exclusive Offer" / "独家优惠" / "Penawaran Eksklusif" (no percentage prefix) | ✅ (FIX 2026-05-20) |
| Deposit inbox body table col 2 = Max Bonus (currency-amount), not Bonus Percentage | ✅ (FIX 2026-05-20) |
| Bonus Condition Example uses max_bonus (realized cap), not min_dep × pct/100 | ✅ (FIX 2026-05-20) |
| Inbox T&C point 8: QPRO hyperlinked per brand (tncDomain from brand-directory); QP2 plain text + :url/terms-conditions for BO substitution | ✅ (FIX 2026-05-20) |
| Layer-1 game provider exclusion by name OR code (catches DG, SSG, ALLBET, EKOR, HABANERO, KINGMIDAS, MEGA888, 918KAYA) | ✅ |
| UTC datetime in valid_from + popup start_date | ✅ |
| Per-locale promotion_name rows tied to region's currency (MY→MYR, SG→SGD, ID→IDR) | ✅ |
| Resolver pulls source's per-locale names (not BO admin label), strips "REL" suffix | ✅ |
| Inference: `<RATE>% <CAT> Reload` → candidate `FT_REL_<CAT>_<RATE>PCT`, probe BO | ✅ |
| Multi-brand orchestrator writes back `status="Created"` + code + names | ✅ |
| QPRO PUT does NOT re-send promotion_currency (avoids SGD/IDR wipe) | ✅ |
| QP2 PUT re-emits promotion_currency with max_total_*=0 (POST uses null) | ✅ |
| Doc alignment: QPLY Blacklist Template Guide → mapper exclusions already match | ✅ (VERIFIED 2026-05-20) |

## What needs manual operator action

- **Inbox refer with code (column N says `Pls refer X inbox code PROMOTIONS.MESSAGE.<NAME>`)** — currently requires `bin/clone-inbox-template-p071.mjs` as a one-off per promo. NOT yet wired into the auto-flow.
- **Cashback** — no authored T&Cs; mapper emits operator-handoff prompt.
- **TH locale** — body renderer skips silently.
- **QPRO redo after archive** — archive doesn't free the code; bump suffix (`_V2`) or change the campaign portion.
- **Blacklist Template (sub-category exclusions)** — not wired in the bot; operator picks the template via BO UI manually after the canary save. Provider-level exclusions ARE handled by the bot (Layer-1 filter); only sub-category linkage is manual. See [reference_blacklist_template_guide.md](reference_blacklist_template_guide.md).

## Known edge cases / gotchas

1. **QPRO archive leaves code reserved.** DELETE returns success but `code already taken` on re-POST. Bump suffix for redo.
2. **QP2 PUT/POST currency-field asymmetry.** `max_total_applications` and `max_total_bonus`: PUT requires int (0 ok), POST `/promotioncurrency` requires null. Mapper uses null + PUT body coerces to 0 in an IIFE.
3. **QP2 inline POST vs standalone POST on `/promotioncurrency`:** different validators. Inline (POST /promotion with embedded promotion_currency) accepts null; standalone POST `/promotioncurrency` rejects 0 on `max_total_*` and `max_withdraw`. Backfill scripts use null.
4. **QPRO list endpoint hides soft-deleted name + currency rows.** If a previous PUT silently soft-deleted a row, the listing shows the visible subset but new POSTs fail with "already exists".
5. **`currencies_ids` field is unreliable** — trust `/api/bo/promotioncurrency?promotion_id=X` count instead.
6. **QPRO5–17 are MY-only brands.** Operator's request may list 4 locales but only MY_EN + MY_ZH are valid per brand.
7. **Cross-merchant code uniqueness on ibc22.** QP2A/B/C/D share the BO — multi-merchant promos use ONE promo row with extended `merchant_ids`.
8. **`BRAND_TO_SITE` and other constants are scattered** — `QP2_BRAND_TO_IDS`, `LAYER1_GP_EXCLUSION_NAMES`, `CURRENCY_TO_ID`. Drift between mappers is a bug source.
9. **THB / KHR / AUD currency IDs unverified.** Mapper has placeholders. Probe `/api/bo/currency` before using.
10. **`detail.name` (BO admin label) ≠ per-locale `promotion_name`.** When pulling from source, ALWAYS use the `/promotionname` rows for clean consumer-facing names.
11. **NEW 2026-05-20: QP2 category list lives in `promotion_category_ids` (flat array) on the promotion record.** QPRO uses `promotion_category` (relation table with one row per category_id). Both come from the same `categories_only` instruction — but if you're inspecting a QP2 promo via GET, look at `promotion_category_ids`, NOT `promotion_category` (which will be empty).
12. **NEW 2026-05-20: `blacklist_template_id` is silently dropped by the QPRO PUT.** The field isn't on the promotion record schema. To apply a template's sub-cat exclusions via API, flatten the template into `blacklist_sub_categories` array (per-currency × per-sub-cat-id). Or do it manually via BO UI — operator's preferred path.
13. **NEW 2026-05-20: max_bonus ≠ max_withdraw on QP2.** max_bonus = bonus cap; max_withdraw = withdrawal ceiling. The latter defaults to null = Unlimited. Never copy max_bonus into max_withdraw — that's a separate operator decision.
14. **NEW 2026-05-20: detail endpoint hides dialog_popup_list.** `GET /api/bo/promotion/{id}` returns `dialog_popup_list: undefined` even when popups are linked. Use the listing endpoint (`GET /api/bo/promotion?code=...`) to verify dialog linkage.
15. **NEW 2026-05-20: QP2 popup DELETE returns 405.** To remove a popup, PUT `{ ...row, status: 0 }` with `start_date`/`end_date` reformatted from ISO (`2026-05-20T09:45:08.000000Z`) to `Y-m-d H:i:s` (`2026-05-20 09:45:08`).
16. **NEW 2026-05-20: Mapper-driven QP2 re-PUT can duplicate popups.** `plan.buildUpdate(promoId, templateId, { id, fullRow })` may create a fresh popup instead of relinking the existing one. After any re-PUT that touches `dialog_popup_list`, audit for duplicates via listing endpoint and deactivate orphans.
17. **NEW 2026-05-20: CTA button text + link must match.** Left button on dialog popups: `min_deposit > 0` → "DEPOSIT"/"存款"/"Deposit" + `/member/deposit`; else → "CLAIM NOW"/"立即领取"/"Klaim Sekarang" + `/member/reward`. Right button always "READ MORE" → `/member/message`. Mapper's `CTA_TEXT_BY_DOCKEY` now has separate `claim` / `deposit` keys.
18. **NEW 2026-05-20: messagetemplate PUT shape.** `PUT /api/bo/messagetemplate/{id}` body = `{ name, section, type, status, code?, details: { '<locale_id>': {settings_locale_id, subject, message} } }`. QPRO accepts the `code` field; QP2 rejects it with HTTP 422 "code already taken". Omit `code` on QP2. `details` must be a numeric-keyed object (array silently no-ops with 200 OK).
19. **NEW 2026-05-20: Inbox T&C uses different conventions per platform.** QPRO injects a brand-specific hyperlink at render time (tncDomain from `data/brand-directory.json`, no target, `/en-my/info-center/terms-and-conditions` for all locales). QP2 stays plain text with `:url/terms-conditions` placeholder — BO substitutes at display time across all 4 merchants. Bodies are authored with QP2 form; renderer's `hyperlinkQproTnc()` post-processes for QPRO and is scoped to the `<li>` containing `:url/terms-conditions` (avoids matching the same term in ZH section headers).
20. **NEW 2026-05-20: per-brand tncDomain in brand-directory.** T&C domains differ from marketing websites (e.g. QP2C marketing `ace66.com`, T&C `ace66my.co`). All 18 live brands probed; see `data/brand-directory.json` `tncDomain` field. Used by renderer for QPRO hyperlink construction. Kept as reference for QP2 even though QP2 uses `:url` placeholder.

## Helper scripts (one-off, kept in `bin/`)

Earlier:
- `archive-and-rerun-qpro59.mjs` — QPRO archive pattern
- `bulk-archive-p068-orphans.mjs` — bulk deactivate+archive
- `clone-inbox-template-p071.mjs` — clone template by code across brands
- `clone-v5-popups-multi-merchant.mjs` — clone popup per merchant
- `fix-today-utc-dates.mjs` — backfill valid_from + start_date to current UTC
- `fix-v5-popup-links.mjs` — repair dialog_popup_list
- `add-missing-currency-rows.mjs` — POST per-currency rows POST missed
- `backfill-currency-and-names.mjs` — audit + add missing currency + name rows
- `fix-p072-rerun-puts.mjs` — re-PUT existing saves to pick up mapper fixes (use as template)
- `update-p072-names.mjs` — PUT existing promotion_name rows with new text
- `extend-qp2-merchants.mjs` — add merchant to existing QP2 promo
- `resolve-refer-source.mjs` — fixture-fill from referenced source
- `fix-p074-min-deposit.mjs` — clear min_deposit + deposit_status drift

Added 2026-05-20:
- `fix-p091-p096-max-withdraw.mjs` — clear max_withdraw to null on promotion_currency
- `fix-p093-p096-categories.mjs` — re-PUT with categories_only narrowed
- `fix-p091-p096-promo-type.mjs` — re-PUT with promo_type=2 (Deposit Bonus)
- `fix-p091-p096-relink-dialog.mjs` — re-PUT to relink popups by id (caveat: may duplicate on QP2)
- `fix-p091-p096-cta-button.mjs` — PUT-patch popup contents for CTA text + link pair
- `fix-p091-p096-message-template.mjs` — re-render + PUT message template body+subject (use as template for any inbox content fix)
- `deactivate-test-promos.mjs` — bulk deactivate accumulated TEST_* records

## Today's saved state (P091 – P096)

All 6 RNs × 2 brands (QP2C + QPRO4) = 12 saves. Live + correct after 4 PUT-patches.

| RN | Code | Categories | QP2C | QPRO4 |
|---|---|---|---|---|
| P091 | `VIP_REL_30PCT_8X_MIN3000`  | All 7   | 1193 | 363 |
| P092 | `VIP_REL_30PCT_8X_MIN6000`  | All 7   | 1194 | 364 |
| P093 | `VIP_REL_100PCT_5X_MIN2500` | Slots+Fishing | 1195 | 365 |
| P094 | `VIP_REL_100PCT_5X_MIN3500` | Slots+Fishing | 1196 | 366 |
| P095 | `VIP_REL_100PCT_5X_MIN4000` | Slots+Fishing | 1197 | 367 |
| P096 | `VIP_REL_100PCT_5X_MIN8500` | Slots+Fishing | 1198 | 368 |

All: promo_type=2 (Deposit Bonus) / promo_sub_type=1 (Reload), max_withdraw=null (Unlimited), VIP_ prefix.

## Carryover from earlier sessions

- P069/P070 stuck on MYR-only on QPRO4–17 (soft-deleted SGD/IDR rows from earlier wrong-CURRENCY_TO_ID mapping; operator decided to fix via BO UI rather than archive+redo).
- ~120 TEST_* records have accumulated across BOs; `bin/deactivate-test-promos.mjs` deactivated 231 of them on 2026-05-19. Run periodically to keep BO clean.
- P085–P090 (IGMP/browser-bridge): see [session_2026-05-20_browser_bridge_igmp_saves.md](session_2026-05-20_browser_bridge_igmp_saves.md) — three followup code fixes still flagged there.
