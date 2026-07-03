---
name: feedback-qp2-fs-value-per-spin-vs-amount-per-line
description: "QP2 + QPRO FS — amount_per_line = floor(value_per_spin / 20, 2dp). BO rejects 0.025; 0.50 spin value → 0.02 APL. Applies to all platforms."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: eb8eeb8c-9666-4ae3-af1a-64ef5a8e562a
---

BO stores `amount_per_line` on FS promos; the source remark "Spin value" is a player-facing concept and does NOT map 1:1 to `amount_per_line`.

**Conversion rule:** `amount_per_line = Math.floor(value_per_spin / 20 * 100) / 100`
- 0.50 spin value → 0.025 raw → **0.02** after floor (BO rejects 0.025)
- 0.20 spin value → 0.010 raw → **0.01** after floor ✓
- The divisor stays at 20; the key is floor-to-2dp, not /25.

Applies to: **QPRO** (`bo-mapper-qpro.js`, `api-mapper-qpro.js`) and **QP2** (`bo-mapper-qp2.js`). Fixed 2026-06-30 — previously code used `.toFixed(4)` which left 0.0250 and BO rejected it.

If the source row states `amount_per_line` directly (via ingest parser), use that value as-is (no division). The `/20 + floor` path is only for rows where only `value_per_spin` is known.

**Why:** Jascinta confirmed 2026-06-30: BO rejects 0.025; correct persisted value for 0.50 spin is 0.02.

**How to apply:**
- Sentinel: `amount_per_line = 0.02` for a 0.50 spin-value promo is PASS, not WARNING.
- Never flag the gap between source "Spin value: 0.50" and persisted `amount_per_line = 0.02` as an error.
