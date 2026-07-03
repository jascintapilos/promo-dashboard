---
name: Max per Player + Daily Max from sheet col T
description: Sheet col T holds two stacked numbers (Lifetime cap + Daily cap) in a single cell, separated by newlines. The ingest parses both into record.max_per_player + record.daily_max; both QPRO and QP2 mappers now use these instead of hardcoded defaults.
type: project
originSessionId: c72d4c31-9700-49d5-b99f-66f256fe39b9
---
**Sheet col T header:** `"Max per Player (Lifetime)\n\nDaily Max"` — the column carries two distinct values stacked vertically in one cell.

**Parser** (`parseMaxPlayerCaps` in `src/ingest-xlsx.js`):
- `"1\n\n1"` → `{lifetime: 1, daily: 1}` (P067 today)
- `"99999\n100"` → `{lifetime: 99999, daily: 100}`
- `"99999"` → `{lifetime: 99999, daily: 99999}` (single number → use for both)
- `"99999 / 100"` → `{lifetime: 99999, daily: 100}` (slash also accepted)
- `""` → `{lifetime: undefined, daily: undefined}` (mapper falls back to defaults)

**Mapper fallbacks** when col T is empty (legacy callers):
- QPRO: `max_per_player=99999, daily_max=1` (unlimited lifetime, one claim per day)
- QP2: `max_per_player=1, daily_max=1` (single-claim ever)

Fields flow as `resolved.max_per_player` / `resolved.daily_max` into both `buildPromotionBody` and `buildUpdateBody` on both mappers.

**Wiring:**
- `src/ingest-xlsx.js` — `parseMaxPlayerCaps` + record fields `max_per_player`, `daily_max`
- `src/api-mapper-qpro.js` line ~286 — uses `resolved.max_per_player ?? 99999` / `daily_max ?? 1`
- `src/api-mapper-qp2.js` lines 334 + 553 — uses `resolved.max_per_player ?? 1` / `daily_max ?? 1`
- `bin/ingest-requests.js` summary doesn't surface caps yet (only namer stats)

**Verified live 2026-05-16:** P067 row T = `"1\n\n1"` → resolved.max_per_player=1, daily_max=1. Confirmed in dry-run body.
