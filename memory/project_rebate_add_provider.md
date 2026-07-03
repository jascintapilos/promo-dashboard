---
name: Rebate — add new game provider script
description: bin/add-provider-to-rebate.mjs wires a new provider into all matching rebate settings across QPRO brands.
type: project
originDate: 2026-05-19
originSessionId: 6baee7b0-ead2-43e6-a52c-73cd53df7d6e
---
## When to use

After tech adds a new game provider to the QPRO BO, and **before** enabling it. Run dry-run first, then commit.

## Script location

`bin/add-provider-to-rebate.mjs`

## Usage

```bash
# Dry-run (safe — shows what would change, no writes)
node bin/add-provider-to-rebate.mjs --provider JILI

# Live — apply to all QPRO brands
node bin/add-provider-to-rebate.mjs --provider JILI --commit

# Restrict to specific brands
node bin/add-provider-to-rebate.mjs --provider JILI --commit --brands qpro1,qpro7,qpro11

# Force-match settings by category name (when provider has no category mapping yet)
node bin/add-provider-to-rebate.mjs --provider JILI --commit --category Slots
node bin/add-provider-to-rebate.mjs --provider JILI --commit --category "Live Casino"
```

## Behaviour

- **QPRO only** — QP2 (ibc22) has no `/api/bo/rebate/settings` endpoint
- **Idempotent** — skips any setting that already contains the provider; safe to re-run
- **Race-safe** — GET fresh detail immediately before each PUT; guards against concurrent edits
- **Rate-limited** — 150ms pause between writes
- **`--category` override** — when `--category` is given, matches rebate settings by name substring instead of category-ID overlap. Use when provider has no category mapping returned yet.

## API shapes

### Resolve provider
```
GET /api/bo/gameprovider?perPage=300&page=1
→ data.rows[].{id, code, name, ...}
```
⚠️ Use `perPage` (camelCase). `per_page` (snake_case) is silently ignored — always returns 30/page regardless.

### Provider categories
```
GET /api/bo/gameprovider/{id}
→ data[0].category[].{category_id, category_code}
```

### List all rebate settings (includes member_groups for filtering)
```
GET /api/bo/rebate/settings?perPage=300
→ data.rows[].{id, name, member_groups: [{member_group_id, game_provider_id, category_id, settings_currency_id}]}
```

### Get single setting (fresh detail for PUT)
```
GET /api/bo/rebate/settings/{id}
→ data = { setting: {name, percentage, status, min_rebate_limit, max_rebate_limit},
           member_groups: [{member_group_id, game_provider_id, category_id, settings_currency_id}] }
```
Note: response may be `data.rows` or `data` depending on brand — script handles both via `?? `.

### PUT (update) rebate setting
```
PUT /api/bo/rebate/settings/{id}
Body:
{
  "name":             "...",
  "percentage":       "1.00",
  "status":           1,
  "min_rebate_limit": 0,
  "max_rebate_limit": 0,
  "member_groups":    [1, 2, 3],       // member_group_id ints (from freshMgs)
  "game_providers":   [12, 45, ..., 99], // game_provider_id ints — APPEND new id here
  "categories":       [3, 5],          // category_id ints (from freshMgs)
  "currencies":       [1, 3]           // settings_currency_id ints (from freshMgs)
}
```

## Summary output example

```
═════════════════════════════════════════════════════════════════
  ADD PROVIDER TO REBATE SETTINGS  [DRY-RUN]
═════════════════════════════════════════════════════════════════
  Provider       : PP2
  Brands         : qpro1, qpro2, ... (17 total)

QPRO1 — BP9 (MY/SG/ID)
  ─────────────────────────────────────────────────────────
  Provider: id=62  "PP2 - Pragmatic Play"  categories: [LC, SL]
  Rebate settings: 36
  ─  id=83   Slots Rebate                              already in
  ─  id=84   Live Casino Rebate                        already in
  ➕ id=85   Fishing Rebate                            [dry-run]
  ...
═════════════════════════════════════════════════════════════════
  DRY-RUN complete
  Would add  : 184 settings
  Already in : 429 settings (would be skipped)
  Re-run with --commit to apply.
═════════════════════════════════════════════════════════════════
```

## Verified

Dry-run tested with PP2 across all 17 QPRO brands: provider found on all brands, categories [LC, SL] auto-detected, 429 already-in + 184 would-add. Zero errors.
