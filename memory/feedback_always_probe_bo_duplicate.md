---
name: feedback-always-probe-bo-duplicate
description: "For every promo request, always probe each target BO for an existing promo_code before naming/saving. Surface conflicts in the summary table."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 537e5bf3-c729-446a-b24b-02bc705c6610
---

Before finalizing a promo_code (whether derived by the auto-namer or supplied by operator), always probe each target BO to check if the code already exists.

**Why:** QPRO archive doesn't free the code (memory [[project-qpro-put-currency-wipe]]). QP2 shares codes cross-merchant via merchant_ids extension (memory [[feedback-qp2-multi-merchant-share-code]]). A name collision either silently blocks creation, or — worse — extends an unrelated promo. Confirmed 2026-05-22 after Jascinta asked to "always probe if BO has duplicate promo code" during P106 namer confirmation.

**How to apply:**
- After namer produces `promo_code`, hit each target brand's BO listing endpoint:
  - QPRO: `GET /api/bo/promotion?code=<code>&list` (per memory [[project-qpro-promo-content-api]])
  - QP2:  `GET /api/bo/promotion?code=<code>&list` (shared bo.qtp777.com — check all merchants the request targets)
  - IGMP (WS1/WS2): probe the brand's promo-code listing (see [[project-igmp-platform]]) — note IGMP uses promo `name` not `code` for uniqueness, so probe by both.
- Surface findings in the summary table — add a `BO probe` row showing per-brand status: `✅ free` / `⚠️ exists (id=NNN, status=N)`.
- If a collision exists, ASK before bumping the suffix or duplicating into the existing code. Don't silently bump (operator may want to archive the old one first, or extend cross-merchant).
- Run probes in parallel — they're independent GETs.

Related: [[project-qpro-put-currency-wipe]] (archive doesn't free QPRO codes), [[feedback-qp2-multi-merchant-share-code]] (QP2 dialog popups extend vs duplicate), [[feedback-always-summary-table]] (where to surface the result).
