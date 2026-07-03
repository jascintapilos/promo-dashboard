---
name: Always upload 3.3 Promotion Contents BEFORE 14.2 Banners (or QP2's 15.2)
description: The canonical promo upload order. Banner links deep-link to a Content Code that must exist first.
type: feedback
originSessionId: 44de9df1-3765-407d-9cbf-e86e09b6aeb8
---
For any promo upload across QPRO / QP2 (and BIA when in scope):

1. **Step 1 — Section 3.3 Promotion Contents** (the promo article page)
   - Uses `qpro-promo-page-upload` or `qp2-promo-page-upload` skills
   - Creates the Content Code (e.g. `EVEMGPUE` on QPRO, `EVEMGPUEA` on QP2A)
   - Locales, dates, banner image, Title, Description, Content body, Allow Apply, etc.

2. **Step 2 — Section 14.2 (QPRO) / 15.2 (QP2) Banners** (the homepage carousel banner)
   - Uses `qpro-homepage-banner-upload` or `qp2-homepage-banner-upload` skills
   - Creates the banner that DEEP-LINKS via `/promotion?code=<ContentCode>` to the 3.3 row from Step 1
   - Per-locale Desktop + Mobile images

**Why this order matters:** If the banner is created before the Promotion Content row, the banner's Link field points to a non-existent code. Clicking the banner takes the player to a 404 / empty promo page until the 3.3 row is published. Doing 3.3 first guarantees the link resolves the moment the banner goes live.

**When Jascinta says "upload banner for B##" or shares a banner asset**, default to running BOTH skills in order: 3.3 first, then 14.2/15.2. Do not skip Step 1 even if the user only mentions banners — confirm the Content Code already exists in the BO listing; if not, create it first.

This applies to all platforms (QPRO1-19, QP2A-D, plus BIA when carousel/link patterns work the same). Corrected in May 2026 after I uploaded an IBC22 banner first without the matching 3.3 row.
