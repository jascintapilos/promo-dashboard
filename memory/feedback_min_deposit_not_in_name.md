---
name: Never include min_deposit in promo names
description: Min deposit goes in promo_code only (as MIN<amt> suffix); promotion names stay free of min-deposit qualifiers
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
When differentiating promos that share the same %/TO/category but differ only by `min_deposit`, encode the discriminator in `promo_code` only (`VIP_REL_<pct>PCT_MIN<amt>_<TO>X`). The customer-facing `promotion_name_en` / `promotion_name_zh_id` / `promotion_name_zh_my` etc. must NOT carry a "(Min N,NNN)" qualifier — names are allowed to duplicate across rows that target different deposit brackets.

**Why:** Jascinta 2026-05-20: consumer-visible names should stay clean; the bracket is internal BO routing. Duplicate names across siblings are acceptable because BO disambiguates by code.

**How to apply:** Auto-namer + manual regeneration must only mutate the code when adding a MIN suffix. Leave all `promotion_name_*` fields at the base pattern (e.g. "VIP 100% Reload Bonus", "VIP 100% 充值奖励"). Applies to Deposit, Free Credit, Free Spin — any bonus type where min_deposit is the discriminator.
