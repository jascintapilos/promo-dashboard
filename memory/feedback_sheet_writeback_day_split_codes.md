# Feedback — Day-split sheet write-back must list ALL codes

**Source:** Operator (Lexa), 2026-05-26 batch P106-P109.

**Rule:** When a row has `instructions.day_split` set (operator wrote "3 codes
for WS1\n1 code for QP2A" in the remark), the sheet write-back for the
**promo_code column** must populate ALL the saved codes in the operator's
multi-line template format, NOT just the base code.

**Format (mirrors operator's column W seed):**

```
WS1
Code 1: <base>_D1
Code 2: <base>_D2
Code 3: <base>_D3

QP2A
Code: <base>
```

(where `<base>` is the auto-derived promo_code, e.g.
`FT_28FS_GOO_15X_020_WCCHURNED`.)

**Why this matters:** Without it, the operator scanning the sheet only sees
the base code (e.g. `FT_28FS_GOO_15X_020_WCCHURNED`) and can't tell that
the WS1 path actually saved three day-suffixed variants. The template
preserves day visibility for downstream tracking (claim-rate per day, etc).

**Generalization:** Same convention applies to any multi-code row pattern
the operator marks with their `Code 1: / Code 2: / …\n\nPlatform2\nCode:`
template, regardless of the specific day-prefix letter.

**Where to apply:** `bin/canary-multi-brand.js` sheet write-back block
(around the `valuesByField.promo_code = …` line). When `daySplit` is set
AND the request has both IGMP and QP2 platforms, replace the bare base
code with the multi-line block.

**Helper script:** `bin/update-p106-109-codes.mjs` was the one-shot for
P106-P109 in the 2026-05-26 batch — kept as reference for any future
manual fix-up.

**Re-ingest safety:** the multi-line value lives in the sheet (col W),
NOT in fixtures, so re-ingest preserves it. The ingest parser already
handles multi-line col-W values (splits on `/` or `\n` and prefers the
FT_ entry — see `src/api-mapper-igmp.js` line 357-365). So next time the
canary re-runs the row, the multi-line block is read back without
breaking anything.
