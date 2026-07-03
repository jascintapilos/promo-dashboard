---
name: QP2 FS promos must restrict game_provider_codes to the FS provider only
description: On QP2 (all merchants), Free Spin promos must set game_provider_codes (top-level AND target[].game_provider_codes) to a single-entry list containing just the FS provider — not the full Layer-1 inverted exclusion list.
type: feedback
originSessionId: 6baee7b0-ead2-43e6-a52c-73cd53df7d6e
---
For Free Spin promos on QP2, the eligible `game_provider_codes` collapses to just the FS provider (e.g. PP2). NOT the 53-entry Layer-1 inverted exclusion list used for Deposit / Free Credit.

**Locations that need the single-provider override** (`src/api-mapper-qp2.js`):

1. POST `buildPromotionBody` — top-level `game_provider_codes` AND `target.game_provider_codes`. Both use the SHORT CODE form (e.g. `"PP2"`).
2. PUT `buildUpdateBody` — top-level uses NUMERIC IDS (e.g. `345` for PP2 — see `QP2_FS_PROVIDER_ID_BY_PREFIX`); `target.game_provider_codes` uses the SHORT CODE form (`"PP2"`).

**Why:** P074 QP2B initially saved with all 53 providers in both `game_provider_codes` lists, then operator flagged it. Memory `project_promo_code_automation_flow.md` had this listed as a known limitation ("FS Game Providers single-provider rule on QP2 — operator manually trims post-save"). Fixed in mapper 2026-05-18 so operator doesn't need to trim.

**Helper:** `fsProviderCodeFromLabel(label)` strips the descriptive suffix. `"PP2 - Pragmatic Play"` → `"PP2"`. Defaults to `"PP2"` when label is null.

**API response quirk:** GET `/api/bo/promotion/<id>` returns `target` as an ARRAY (one element typically), not a single object. So `promo.target[0].game_provider_codes` — NOT `promo.target.game_provider_codes`.

**QPRO already correct:** QPRO mapper sets `gpIds = [fsProviderId]` for FS bonus, so QPRO never had this issue.

## Min Deposit parser — already handles all three forms

Parser regex in `src/ingest.js`:
```
(?:min(?:imum)?\s+(?:dep(?:osit)?|depo)|min\.?\s+depo?)\s*[:=]?\s*…
```

Accepts:
- `min dep 100` / `min dep: 100` / `min dep = 100`
- `min depo 100` / `min depo: 100` / `min depo = 100`
- `min deposit 100` / `min deposit: 100` / `min deposit = 100`
- `minimum deposit 100` / `min. dep 100`

The `[:=]?` between label and value handles the operator's mix of `:`, `=`, or bare space (fixed 2026-05-18 per `feedback_parser_label_value_separators.md`).
