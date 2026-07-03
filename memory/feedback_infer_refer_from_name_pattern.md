---
name: Infer refer-code from name pattern when fixture is sparse
description: When column M is a minimal description like "25% LC Reload" with no "Pls refer" pointer AND the fixture has parsed-field gaps, the bot must INFER the likely source code (FT_REL_<CAT>_<RATE>PCT family) and PROBE the BO to confirm. The "always re-ingest" rule still applies — inference runs after a fresh ingest, never before.
type: feedback
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
The operator's workflow uses naming-convention shortcuts: a column-M of `"25% Slots Reload"` implies the bot should reuse `FT_REL_SLOTS_25PCT`; `"25% LC Reload"` implies `FT_REL_LC_25PCT`. They don't always write "Pls refer <CODE>" explicitly — the convention is sufficient.

**Why:** Per Jascinta 2026-05-18 (after P072 row with only `25% LC Reload` in column M). She said: "there is a code to refer to according to the request template, you need to follow the instructions and probe the code before execution, the rule stays the same, always re-ingest, because that is how you know there is a code you can refer to."

The "always re-ingest" rule is intact — inference runs AFTER the fresh ingest, on the just-ingested fixture's `name_details_raw`. Inference never replaces or skips the re-ingest.

**How to apply:**
- In `bin/resolve-refer-source.mjs`: if `instructions.refer_to` is null after parseInstructions, attempt to infer from `name_details_raw`.
- Pattern: `<RATE>% <CATEGORY> Reload` (case-insensitive). Extract rate (int) and category. Category aliases:
  - "Slot" / "Slots" → SLOTS
  - "LC" / "Live Casino" → LC
  - "Sports" / "Sport" → SPORTS
  - "Fishing" → FISHING
  - "E-Sports" / "Esports" → ESPORTS
- Candidate codes to probe (in order): `FT_REL_<CAT>_<RATE>PCT`, `REL_<CAT>_<RATE>PCT`. First match on any QPRO brand wins.
- On a successful probe: treat as if operator wrote "Pls refer <CODE>" — proceed with fixture-fill from source.
- On no match: surface to operator with the candidate codes tried.
- Per-bonus-type patterns (other than Reload) can be added as the operator's workflow surfaces them. Keep the inference rule narrow to known patterns.
- Do NOT infer when the fixture is already complete (no gaps) — the operator's explicit values win.

**Test cases (verified 2026-05-18):**
- "25% Slots Reload" → FT_REL_SLOTS_25PCT (matched P071 source on QPRO2 id=295)
- "25% LC Reload" → FT_REL_LC_25PCT (matched P072 source on QPRO2 id=296)