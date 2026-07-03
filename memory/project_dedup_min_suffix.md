---
name: Auto-namer dedup — MIN suffix on batch collisions
description: After auto-naming, sheets-ingest.js runs a dedup pass that appends _MIN<amount> to any auto-named codes that collide within the batch (same code + ≥1 shared brand + differing min_deposit). Operator-typed codes are left alone.
type: project
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
`src/sheets-ingest.js` now ends with a `disambiguateDuplicateCodes()` post-pass.

**Trigger:** two records both have `auto_named.source === 'derived'` AND end up with the same `promo_code` AND share at least one entry in `brands` AND have different `parsed.min_deposit` values (>0).

**Action:** appends `_MIN<min_deposit>` to each colliding record's `promo_code`. Names stay base (per [feedback_min_deposit_not_in_name.md](feedback_min_deposit_not_in_name.md)).

**Skipped:**
- Operator-typed codes (`auto_named` absent or `source` is `already_named` / `override`)
- Records with no/zero `parsed.min_deposit`
- Pairs that share a code but no brand overlap (cross-brand reuse is intentional)

**Logged:** `ingest-requests.js` prints `Dedup: N auto-named codes patched with _MIN<amount> to break batch collisions` when N > 0.

**Why:** P091-P096 (Shyam, AI Campaign, QP2C+QPRO4) all generated either `REL_30PCT_8X` or `REL_100PCT_5X` with only `min_deposit` differing — would have collided in BO on the first save. Operator confirmed MIN belongs in code only, not in names. Encoded the rule into ingest so future batches handle this automatically.

**How to apply:** No action needed in normal flow — runs automatically on every `bin/ingest-requests.js` invocation. If a fixture's code looks like `<BASE>_MIN<amount>` and you didn't hand-edit it, that's the dedup pass.
