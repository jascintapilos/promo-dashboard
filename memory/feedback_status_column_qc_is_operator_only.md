---
name: Status column — leave QC / QC Completed alone (operator-managed)
description: Bot writes "Created" after BO save; never overwrite "QC" or "QC Completed" values — those are set by the operator
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
The Status column (A) on the May 2026 (and every month) tab of the Promo Code Request Details Template is shared between the bot and the operator:

- **Operator writes:** "QC", "QC Completed"
- **Bot writes:** "Created" (after the promo is saved on the BO)

**Why:** Jascinta 2026-05-20: QC values represent operator-managed QC workflow steps. The bot must not overwrite them — even if the bot has already created the promo on the BO. The operator may legitimately re-mark a row "QC" if they detect a re-do is needed.

**How to apply:**
- When writing back status after a successful BO save, do NOT blanket-write "Created" to every row. First read the current value in column A.
- If the current value is **blank** or **the bot's prior "Created"** → write "Created".
- If the current value is **"QC"** or **"QC Completed"** → SKIP. Do not overwrite.
- Any other value → SKIP and report (probably a new operator state I don't know about).

**Counter-case:** Bot's own previously-written "Created" can be overwritten with a re-render (e.g. if codes change). But operator-set values are off-limits.

**Past slip:** 2026-05-20 — overwrote P080 and P084 from "QC" → "Created" before this rule was established. No action needed there since the BO saves were already done, but the operator may want to re-mark those if they were intentionally QC-staged.
