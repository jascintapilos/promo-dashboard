---
name: feedback-qp2-target-gp-codes-authoritative
description: "QP2 promotion PUT: persisted game providers come from target.game_provider_codes (string codes), not the top-level numeric field."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4d8ac9e2-796a-41d8-8b0c-9569c393be80
---

On QP2 `PUT /api/bo/promotion/{id}`, the persisted game-provider list is derived from `target.game_provider_codes` (indexed object of STRING codes, e.g. `{"0":"BG","1":"9W"}`), NOT from the top-level `game_provider_codes` field (numeric put-IDs). If a fix script passes the original `det.target` through unchanged, any provider changes sent in the top-level field are silently reverted to whatever the old target held — the PUT reports success and even the immediate verify GET shows the old list.

**Why:** Confirmed 2026-07-16 on promo 1400 (ACQ_WELC_120PCT_12X_LC): first PUT sent 17 numeric ids top-level but re-asserted the old 12-code target → providers reverted (initially misdiagnosed as blacklist-template gating). Second PUT with `target.game_provider_codes` rewritten to the 17 string codes persisted correctly.

**How to apply:** any hand-rolled QP2 promo PUT that changes providers must rewrite BOTH the top-level numeric map AND `target.game_provider_codes` (string codes), exactly like `buildUpdateBody` in src/api-mapper-qp2.js does. Working example: `bin/_fix-lc-welc-add-sports.mjs`.

Related: [[project_qp2_promotion_put_semantics]]
