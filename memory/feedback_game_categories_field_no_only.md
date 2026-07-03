---
name: Parser — "Game Categories : X/Y" without "only"
description: When operator writes an explicit "Game Categories : <list>" or "Game Category : <list>" field (no "only" word), the parser extracts categories_only from the list. "Game : All games" / "Games: All" still falls through to no-restriction.
type: feedback
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
Operator convention: a dedicated "Game Categories" field in column M is treated as a category restriction even without the literal word "only".

**Why:** P093-P096 (2026-05-20, Shyam/AI Campaign) had `Game Categories : Slots/Fishing reload` — without the word "only" the parser's rule J skipped it, and the mapper defaulted to all 7 wallet categories. All 8 saved records (QP2C × 4 + QPRO4 × 4) had to be PUT-patched after the fact.

**How to apply:** Implemented as rule J' in `src/ingest.js` after the legacy "X only" rule J. Triggers when `Game Categor(y|ies)\s*[:=]\s*<segment>` matches AND the segment does NOT contain the word "all". Same token alphabet as rule J (SLOTS / LIVE CASINO / SPORT / FISHING / E-SPORTS / CRASH / CRICKET / TABLE / ARCADE), same separators (/ , + &). Writes to `instructions.categories_only`, downstream mappers already consume that field via `resolveCategoryIds()` / `resolveQp2CategoryIds()`.

**Side note:** QP2 stores category list under `promotion_category_ids` (a flat array on the promotion record), while QPRO uses `promotion_category` (a relation table with one row per category_id). Both mappers send `promotion_category_ids` on POST/PUT; the response shapes differ.
