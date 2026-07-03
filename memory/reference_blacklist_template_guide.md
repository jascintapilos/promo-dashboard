---
name: QPLY Blacklist Template Guide
description: Google Doc covering how the QPRO/QPLY Blacklist Template feature interacts with Promotion Code setup. Lists which Game Providers + Game Categories the operator wants excluded by default, and clarifies that provider exclusion happens at promo setup (not in the blacklist template).
type: reference
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
Link: https://docs.google.com/document/d/15ybNcjngicVcDA80W9CCGGbkfTocnbW0/edit?rtpof=true&tab=t.0

**What's in it:**
- **Game Providers to exclude** (deselect at promo setup, NOT in blacklist template): 918KISS / 918KAYA, ALLBET, EKOR, HABANERO, KINGMIDAS, MEGA888, DG, SSG.
- **Game Categories to exclude** (deselect at promo setup): Arcade, Cock Fight, Lottery, Table.
- **Blacklist Template** is for sub-category exclusions *within* an included main category (e.g., within Slots, block Bingo / Scratchcard / eGame / etc.). Doc lists per-main-category sub-cats to tick: Slots → 12 sub-cats; Sports → 6; Live Casino → 4; E-Sports → 1.

**Critical rule:** "For blacklisted providers, leave the blacklist template blank." Provider exclusion is done by NOT selecting the provider in the promo's Game Providers field — never by ticking the provider in the Blacklist Template.

**How to apply:** Current `api-mapper-qpro.js` Layer-1 exclusion already drops the 8 blacklisted providers (918KAYA, AB, DG, EKOR, HABA, KM, MEGAB, MEGAC, SSG) from the per-promo `game_provider_ids` — verified on QPRO4 2026-05-20. The 7-category allow-list (SPORT, LIVE CASINO, SLOTS, E-SPORTS, FISHING, CRASH, CRICKET) already excludes Arcade/Cock Fight/Lottery/Table. So our automation is already aligned with the doc.

**Open item:** Sub-category exclusion via Blacklist Template selection (e.g., link template id=3 "All games" on QPRO4) is NOT wired in the bot. Per bo-mapper-qpro.js:361 comment ("DROPPED per operator decision 2026-05-13"), the Playwright path was abandoned because leaving the popup open blocked Submit. API path was never authored. If a promo needs sub-cat exclusions, operator applies the template manually via BO UI after the canary save. PUT-ing `blacklist_template_id` is silently dropped — field is not on the promotion record. Direct PUT of flattened `blacklist_sub_categories` (116-row array from template id=3 settings) was prepared but operator confirmed it's unnecessary because the upstream filtering already handles the doc's requirements.
