---
name: QPRO never sets member_group_ids
description: On QPRO BOs, `member_group_ids` is always empty `[]`. Tier prefixes in promo codes (SIL/GLD/PLT/DMD/BR/NRM) are for INTERNAL REFERENCE only — they do not translate to member-group filtering. Tier constraints from name_details_raw apply ONLY to QP2.
type: feedback
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
For every QPRO brand (QPRO1–17), the promotion's `member_group_ids` field must stay empty (`[]`). Never populate it — not from a tier constraint, not from a hardcoded default, not from a per-brand probe.

**Why:** Per Jascinta 2026-05-17. On QPRO, audience segmentation is handled outside the promo definition (likely Smartico flows / front-end filters / blacklist templates). Setting member_group_ids on QPRO would silently restrict the promo to specific tiers when the operator's actual intent is "available to all members; tier prefix is just a naming convention so operators can scan the BO list".

The previous canary tried to extend QP2's tier filter to QPRO too (`resolveQproMemberGroupIds`). On 2026-05-17 Jascinta corrected this — 15 QPRO P069 rows had to be re-PUT with empty member_group_ids.

**How to apply:**
- `src/api-mapper-qpro.js`: do NOT thread `tier_constraint` into the QPRO mapper. `buildUpdateBody` always emits `member_group_ids: []`.
- Tier-prefix logic in `src/promo-namer.js` (SIL/GLD/PLT/DMD/BR/NRM in code) stays — it's a label convention, not a constraint.
- QP2 still consumes tier_constraint and resolves per-merchant member groups via `resolveQp2MemberGroupIds` — that part is correct (Jascinta 2026-05-16 instruction).
- Category filtering (`categories_only` → restrict promotion_category_ids) DOES apply on both QPRO and QP2. That's a different rule.