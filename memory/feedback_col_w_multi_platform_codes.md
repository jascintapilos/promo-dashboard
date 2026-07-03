---
name: col-w-multi-platform-codes
description: "When the same request lands on multiple platforms with DIFFERENT promo_codes (e.g. WS1 auto-prepends FT_), write back a multi-line breakdown in col W so the operator can see all variants — never just the QPRO/source code."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 01415b09-50cf-4296-a456-1ac2c801f68b
---

If a single request results in different promo_codes across platforms,
the sheet col W write-back must show ALL variants — not just one. Use a
multi-line "Platform: code" block per row.

**Why:** P142 + P144 saved as `REL_TLEO_LC_20PCT_10MX` on QPRO but
`FT_REL_TLEO_LC_20PCT_10MX` on WS1 because the WS1/WS2 auto-FT_-prefix
rule kicked in (source code lacked the prefix). The first write-back put
only the QPRO variant in col W, hiding the WS1 divergence. Operator
needs to see both to know which code is which when triaging or
referencing across platforms.

**How to apply:**
- Before write-back, compare the saved code per platform against the
  base resolved code.
- If they differ, format col W as:
  ```
  QPRO: <qpro_code>
  WS1: <ws1_code>
  ```
  (one line per platform, sorted: QPRO → QP2 → WS1 → WS2 → ...)
- If all platforms saved the same code, write the single code as
  before (no formatting overhead when nothing diverges).
- Triggers for divergence in the current rules:
  - `feedback_ws1_ws2_ft_prefix` — WS1/WS2 prepend `FT_` if missing
  - `feedback_qp2_multi_merchant_share_code` — QP2 shares code across
    merchants (no divergence, but worth noting if a brand is excluded)
  - `feedback_sheet_writeback_day_split_codes` — day_split fans out
    `_D1`/`_D2`/`_D3` only on the IGMP path
- Apply the multi-line format consistently; don't mix single-line and
  multi-line outputs in the same batch.

Related: [[feedback_sheet_writeback_day_split_codes]], [[feedback_ws1_ws2_ft_prefix]].
