---
name: feedback_qp2_blacklist_scoped_derivation
description: "QP2 promo blacklist_sub_categories = template ∩ promo's categories ∩ promo's selected providers — never compare against the full template set in QC."
metadata:
  type: feedback
---

# QP2 blacklist derivation is SCOPED to the promo (verified 2026-07-17)

When a QP2 promo has a `blacklist_template_id`, the promo's derived `blacklist_sub_categories` is NOT a copy of the template's full exclusion list. The server derives it as:

**template rows ∩ promo's `promotion_category_ids` ∩ promo's `game_provider_codes`**

Verified on ibc22 ACQ_WELC_120/150/180PCT_12X_LC (ids 1400-1402, template 11 "Live Casino and Sports Only"): template holds 42 unique provider::subcat pairs, promos correctly hold 33. The 9 absent pairs were all out-of-scope — AB / SBO2 / TF not in the promos' 17 selected providers, and E-SPORTS (category_id=4) rows dropped because the promos' categories are [2,1] (LC + SPORT) only.

**Why:** A naive full-template comparison in QC reports false MISMATCH on every promo that restricts categories or providers.

**How to apply:** QC the derived set by first filtering template rows to the promo's category ids and selected provider codes, then comparing pair-sets. A re-assert echo-PUT (same `blacklist_template_id`, `black_list_sub_categories` omitted) is safe — verified zero drift on currency / dialog / categories / providers — but does not add out-of-scope rows, because they are not supposed to be there. See [[project_qp2_promotion_put_semantics]] and [[project-blacklist-template-resolver]].

Template detail row shape (`getBlacklistTemplate/{id}`): `{game_provider_code, category_id, settings_currency_id, sub_categories:[{name,status}]}` — per-currency rows duplicate pairs (MYR=1, SGD=3). Promo detail row shape: `{game_provider_id, game_provider_code, sub_category_name:[...]}` — flattened, no currency dimension.
