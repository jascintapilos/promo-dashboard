---
name: mt-verify-content-checks
description: "MT PUT verification must use content checks, not byte-equality; qc-mt-tnc.js QPRO branch is stale vs renderer attempt-3."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 75c42de7-5581-4012-b26c-698488506043
---

Two false-negative traps when verifying a message-template PUT (hit 2026-07-07 on the FT_REL_30PCT_8X fix):

1. BO GET re-serializes the saved HTML (`&` → `&amp;`, whitespace shifts), so `after.message !== sent.message` byte-equality always "fails" even on perfect saves. Verify with content assertions instead (subject match, required clauses present, no leaked copy, T&C link shape).
2. `src/qc-mt-tnc.js` QPRO branch still expects `href=":url/terms-conditions"`, but the renderer's attempt-3 (2026-07-07) writes a single-quoted resolved brand-domain href (`<a href='https://<brand>/en-my/info-center/terms-and-conditions'>`). Until qc-mt-tnc.js is updated, its QPRO FAIL on new-style MTs is a false alarm — check the anchor manually.

**Why:** Both burned a --commit run that had actually saved 8/8 correctly (see [[ft-rel-30pct-8x-fix]]).

**How to apply:** In fix scripts, model verification on `bin/_verify-ft-rel-30pct-8x.mjs` (regex content checks per locale + platform-specific T&C shape: QPRO = brand-domain anchor, QP2 = plain `:url/terms-conditions` + `:merchantname`).
