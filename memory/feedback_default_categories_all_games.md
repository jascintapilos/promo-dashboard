---
name: Default game categories = "All games" when unspecified
description: When the request row does not specify game categories, default to "All games" (no category restriction)
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
If the request row's `name_details_raw` / `column_m` does not mention any game category (no Slots / Live Casino / Fishing / Sports / Table / Arcade / "categories" line), default to **All games** — i.e. no category restriction on the BO promo, all eligible categories enabled.

**Why:** Jascinta 2026-05-20: silent omission means "no restriction"; do not block on "missing game category" or assume Slots-only.

**How to apply:**
- Parser: do NOT flag `categories missing` as a gap in this scenario.
- Mapper (QPRO + QP2 + IGMP): leave the categories list at the full eligible set for that brand (Layer-1 inclusion) — same behavior as Free Credit "All games".
- Auto-namer: do NOT append a category-only suffix (`_SLT`/`_LC`/etc.) when defaulting to All games — code stays at the base `[FT_][TIER_]REL_<pct>PCT_<TO>X`.
- Display: render "All games" in any summary table when categories are unspecified.

Counter-rule: if the row DOES explicitly list a category (e.g. "Game: Slots/Fishing"), respect it and append the appropriate `_SLT`/`_FSH` suffix as before.
