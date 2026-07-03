---
name: feedback-qp2-fs-gooss-vs20olympgold
description: "GOOSS (\"Gates of Olympus Super Scatter\") resolves to FS game code vs20olympgold on QP2 — operator confirmed 2026-06-23. Do not flag as wrong stem."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: eb8eeb8c-9666-4ae3-af1a-64ef5a8e562a
---

GOOSS / "Gates of Olympus Super Scatter" → FS game code `vs20olympgold`. CONFIRMED correct by operator (Wai Yip) 2026-06-23 during deep-qc of P122-P127.

**Why:** Earlier memory note [[feedback-fs-game-name-exact]] read ambiguously and Sentinels split on whether `vs20olympgold` or `vs20olympgate` was the Super Scatter variant. The operator confirmed `vs20olympgold` IS the Super Scatter variant on QP2 (different from base "Gates of Olympus" = `vs20olympgate`).

**How to apply:** Sentinel must NOT flag `parsed.game = 'vs20olympgold'` as a mismatch when source asks for "Gates of Olympus Super Scatter" / "GOOSS". This is the correct resolution on QP2 FS promos. Keep [[feedback-fs-game-name-exact]] as the general rule for distinct stems but treat GOOSS = vs20olympgold as the canonical QP2 mapping.

Confirmed promos: P122-P127 (promo_id 1267-1272), all FS-WELC/REL/RET on QP2A, all use `vs20olympgold`.
