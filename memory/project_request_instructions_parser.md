---
name: Per-RN operator instructions — parser design
description: Operator embeds free-text instructions in the Promo Request Tracker's `remark` and `name_details_raw` columns. Surveyed across P001–P089 on 2026-05-15. This memo captures the patterns + how the parser extracts them into a structured `instructions` object on each request record.
type: project
originSessionId: 661564a2-cb3f-4d09-8302-db01d7387b43
---
## Why

The bot currently reads STRUCTURED fields from each request row (promo_code, bonus_type, validity_days, etc.) but ignores the freeform `remark`, `name_details_raw`, and `change_details` columns. Surveying P001–P089 revealed the operator uses these freeform fields to carry per-RN instructions that affect how the promo should be set up.

The parser extracts those instructions into `record.instructions: { ... }` so downstream mappers + renderers can act on them.

## Pattern catalog

| Pattern | Example | Extracted as |
|---|---|---|
| **A. Code name override** | "Create the code name as below FT_BR_FC38_5X_DY2" | `instructions.code_name_override` = "FT_BR_FC38_5X_DY2" |
| **B. Duplicate source (after marker)** | "Duplicate this code, all same only change to FOO Put at end V2  REL_299FS_GOO_3_270525" | `instructions.duplicate_source` = "REL_299FS_GOO_3_270525" |
| **B'. Duplicate source (before marker)** | "FT_REL_DOUBLEDATE_MAR_250FS_8X - Duplicate and change to FOO" | `instructions.duplicate_source` = "FT_REL_DOUBLEDATE_MAR_250FS_8X" |
| **B''. Strip token from source** | "...Can remove the 'DEC20' from code" | `instructions.duplicate_strip_token` = "DEC20" |
| **B'''. Suffix on new name** | "Put at end V2" / "Put at end V3" | `instructions.duplicate_suffix` = "_V2" / "_V3" |
| **C. Category-only constraint** | "[SLOTS ONLY] - multiple claims allowed" | `instructions.category_only` = "Slots" \| "Live Casino" \| "Sports" |
| **D. Suggested inbox/dialog copy** | "Inbox/Popup can put smtg like; Congratulations! You're among our Top 4–10 Players!" | `instructions.suggested_copy` = "Congratulations! You're among our Top 4–10 Players!" |
| **D'. Template hint** | "Inbox/popup for Welcome" | `instructions.popup_template_hint` = "Welcome" |
| **E. Cross-reference** | "Refer REL_199FS_GOO_CROSS_070525" | `instructions.refer_to` = "REL_199FS_GOO_CROSS_070525" |
| **F. External Drive doc** | "...refer to leaderboard: https://docs.google.com/document/d/..." | `instructions.external_refs` = ["https://docs.google.com/..."] |
| **G. One-time claim** | "Claimable x1" | `instructions.one_time_claim` = true |
| **H. Multi-claim** | "multiple claims allowed" | `instructions.multiple_claims_allowed` = true |

## Output shape

```js
record.instructions = {
  code_name_override:   string | null,
  duplicate_source:     string | null,
  duplicate_suffix:     string | null,  // e.g. "_V2"
  duplicate_strip_token: string | null, // e.g. "DEC20"
  category_only:        'Slots'|'Live Casino'|'Sports'|'Fishing'|'Table'|null,
  suggested_copy:       string | null,
  popup_template_hint:  string | null,  // e.g. "Welcome"
  refer_to:             string | null,
  external_refs:        string[],
  one_time_claim:       boolean,
  multiple_claims_allowed: boolean,
  raw_signals:          string[],  // list of which patterns matched (for debugging)
};
```

## Downstream consumers

- **Mapper (bo-mapper-qpro / bo-mapper-qp2):**
  - `code_name_override` → override `resolved.promo_code`
  - `category_only` → replace Categories `multiselect_inverted` with `multiselect` for the named category
  - `multiple_claims_allowed` / `one_time_claim` → override `resolved.recurring`
- **Renderer (message-template-renderer):**
  - `suggested_copy` → use as Dialog Title or as a teaser prepended to the body
  - `popup_template_hint` → select a per-hint copy template (Welcome / Reload / VIP / etc.)
- **Existing `resolveDuplicates` step (src/planner.js):**
  - Already handles `duplicate_source` for "Duplicate this code" patterns. After parser lands, pass `instructions.duplicate_source` explicitly instead of regex-extracting again.

## Parser is best-effort

- Patterns may co-exist (e.g. P084 has both Code-name override AND `[SLOTS ONLY]`).
- Patterns are case-insensitive substring matches with sanity checks (e.g. extracted code must match `^[A-Z][A-Z0-9_-]+$`).
- If a pattern doesn't match, the field is `null` / `[]` / `false` — never throws.
- `instructions.raw_signals` lists which patterns hit, for debugging.

## Implementation

- `src/ingest.js` exports `parseInstructions(remark, nameDetails, changeDetails) → instructions`
- Wired into the row-to-record function so every record gets `instructions`.
- Mappers + renderer read `resolved.instructions.*` (optional fields, ignore if null).
