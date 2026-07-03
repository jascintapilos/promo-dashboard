---
name: feedback_no_tier_in_promo_name
description: "Membership tier labels (VIP, Gold, Platinum, Diamond, Silver, Bronze) must never appear in the consumer-facing promo name — code only."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

Tier indicators must NEVER appear in promotion_name_en, promotion_name_zh_id, or any consumer-facing name field.

**Applies to:** VIP, Gold (GLD), Platinum (PLT), Diamond (DMD), Silver (SIL), Bronze (BR), and any equivalent tier label.

**Allowed in:** promo_code only (e.g. `VIP_REL_30PCT_12X` is fine as a code).

**Why:** Consumer-facing names should not expose internal tier segmentation. Players see the name on the promo page; tier is a back-end targeting filter.

**How to apply:**
- Strip tier words from promotion_name_en/zh before saving or showing the summary table.
- e.g. "VIP 30% Reload Bonus" → "30% Reload Bonus"; "WC VIP 30% Reload Bonus" → "WC 30% Reload Bonus"
- "WC Gold - 100 Free Credit" → "WC - 100 Free Credit" (strip "Gold")
- Flag if operator column M includes a tier word in the name field — surface it in the summary table and strip before commit.

[[project_promo_namer]]
[[feedback_promo_name_from_column_m_no_mechanics]]
