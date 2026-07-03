---
name: qpro-put-silent-field-wipe
description: "QPRO PUT silently wipes any field not included in the body — manual rebuilds must preserve blacklist_id, kyc_*, target, and other fields from the prior detail GET."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9b3d4c18-171b-4d17-add7-ab89c833c94c
---

When manually building a PUT body for `/api/bo/promotion/{id}` (e.g. ad-hoc activation, sub_type fix, or any one-off field tweak), **always preserve fields from the detail GET response** rather than omitting them.

QPRO's PUT handler treats absent fields as a wipe — it does NOT preserve prior values. Verified 2026-06-22: my activation PUT for P119–P121 omitted `blacklist_id` and the field went from `1` to `null` silently. Same risk applies to `kyc_*`, `target`, `eligible_types`, `affiliate_group_ids`, etc.

**Why:** The PUT body is treated as the authoritative full state, not a partial patch. There's no PATCH endpoint — only PUT.

**How to apply:**
1. **Preferred:** use the canary's `plan.buildUpdate(promoId, templateId, dialogPopup)` from `buildApiPlan()` — it threads all required fields including `blacklist_id`.
2. **If you must hand-roll a buildBody helper:** start from `(await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows` and spread/copy ALL fields. Only override the ones you intend to change.
3. **Defensive minimum** when manually building: always include at least `blacklist_id`, `kyc_basic`, `kyc_advanced`, `kyc_pro`, `eligible_types`, `target`, `message_template_id`, `dialog_popup_list` from the prior detail — these are silent-wipe risks.

The canary mapper now defaults `blacklistTemplateIdForBrand=1` (universal "All games" on shared QPRO BO) instead of `null` — see [[qpro-promo-type-subtype-map]] and `project_blacklist_template_resolver.md`.

Related: [[qpro-qc-endpoints]] (QC must read list endpoint, not detail, for `dialog_popup_list`).
