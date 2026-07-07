---
name: project-wc-slvr-qp2-provider-fix
description: 2026-07-06 fixed 4 WC_SLVR promos on QP2C/ACE66 — providers were ALL 51 despite SPORT category; P169-P172 QP2 copies missed by June remediation.
metadata: 
  node_type: memory
  type: project
  originSessionId: 5de5e5d6-81a8-45b4-af8e-9b954b622d4d
---

2026-07-06: Simon (Slack C0436H08GAV) reported WC_SLVR_68FC_10X players open for all providers despite Sports-only setting. Root cause: P169-P172 batch (created 2026-06-30 by bot API) pre-dated the 2026-07-02 mapper fix (4843b74) that filters game_provider_codes for category-restricted promos. June remediation (bin/fix-category-providers-june.mjs) covered P128-P142 only; QPRO siblings got fixed but the 4 QP2C/ACE66 copies (ids 1303-1306: WC_SLVR_28FC_10X, 50FC, 68FC, REL_20PCT_12X) were missed.

Fixed via bin/fix-wc-slvr-qp2-providers.mjs — echo-style PUT restricting to 7 SPORT codes (9W, CMD, 2BC, MAX, SBO, SBO2, WBET) in both top-level (numeric IDs) and target (string codes). Verified 4/4, no drift.

**Why:** the June remediation's QP2 builder hardcodes members_only=0 — reusing it would have wiped tier gating set by [[feedback-qp2-conditions-divergence]] flows. Echo-style (set-members-only-tier.mjs pattern) is the safe QP2 fix template.

**How to apply:** (1) Players who claimed BEFORE a provider fix may keep the open-provider snapshot on their reward — config fixes don't retro-apply; CS handles those. (2) When a "player can play outside restricted category" report comes in, check whether the promo was created before 2026-07-02 and whether it was in a remediation scope. The full-estate sweep ran 2026-07-06 — see [[project-estate-cat-gp-sweep]] for the 45-promo remediation batch. Related: [[feedback-category-and-provider-must-match]].
