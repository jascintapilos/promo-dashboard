---
name: WS1/WS2 codes auto-prepend FT_ prefix
description: Any promo on WS1 or WS2 platform gets FT_ prefix at the front of promo_code automatically
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
When the target brand is on WS1 or WS2 (IGMP family — e.g. MB8, RWS77), the promo_code MUST start with `FT_` even when the operator's remark does not request it.

**Why:** Jascinta 2026-05-20: FT (FastTrack) is the standard prefix for all WS1/WS2 promos — the BO/CRM segmentation depends on it. Operators omit the prefix in the request sheet because it's universal for that platform.

**How to apply:** In `src/promo-namer.js`, after building the base code (`REL_<pct>PCT_<TO>X`, `<amt>FC_<TO>X`, `<spins>FS_<acronym>_<TO>X`), check `record.brands` (or platform). If any brand is WS1 or WS2 family, prepend `FT_` unless code already starts with `FT_`. Applies BEFORE other operator-supplied `code_prefixes` (VIP/GLD/etc) so the final order is `[TEST_][operator-prefixes_]FT_<base>`. TEST_ still sits outermost. Tier prefixes (BR/SIL/GLD via TIER_PREFIX) currently sit between operator prefixes and base — keep that order; FT_ goes just before the bonus-type token.

Example: WS1 Reload 18%/TO18× → `FT_REL_18PCT_18X`. With MIN1288 differentiator → `FT_REL_18PCT_MIN1288_18X`.
