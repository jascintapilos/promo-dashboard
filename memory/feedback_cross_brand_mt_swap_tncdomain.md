---
name: feedback_cross_brand_mt_swap_tncdomain
description: "When cloning QPRO MT content across brands, swap the source brand's hardcoded T&C domain to the target brand's tncDomain."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6844d1fd-f37b-49ab-9916-69f59c179915
---

QPRO message-template bodies hardcode the brand's T&C domain (the `tncDomain` from `data/brand-directory.json`), NOT a `:url` placeholder. So when replicating/cloning a promo's inbox MT from one brand to another, the cloned HTML still points at the SOURCE brand's site unless you swap it.

**Why:** Caught live 2026-06-18 replicating 9 WCF codes QPRO4 (YE55) → QPRO3 (BX99). All 8 cloned MTs carried `ye55my.com/en-my/info-center/terms-and-conditions` — wrong for BX99. Members on BX99 would have hit YE55's T&C page.

**How to apply:** When cloning MT bodies cross-brand, replace `<sourceTncDomain>` → `<targetTncDomain>` (look both up in brand-directory.json — they differ from the marketing `website`, e.g. BX99 site=bx99my.com but tncDomain=bx99myr.com). The inline_mt_bodies path only swaps `:merchantname`→`:brandname`, NOT the URL — handle the domain separately. QPRO T&C path is `<tncDomain>/<en-my|zh-my>/info-center/terms-and-conditions`. See [[project_qpro_promo_content_api]], [[feedback_promo_template_placeholders]].

**Update 2026-07-07 (brand-watch remediation, 5 FAILs fixed):** the leak isn't always a T&C anchor. Second shape seen live: a stray whitespace-only anchor on the foreign domain left beside the correct own-brand link (QPRO8 ×3 carried `<a href="https://king333mys.com/promotion?code=EVEXMASSTREAKB" target="_blank"> </a>` next to the correct wild33.com link — QP2B campaign deep-link, not a T&C URL). Correct fix there is REMOVE the anchor, not re-point it (QPRO8's own EVEXMASSTREAK content is status=0, so a re-pointed link would be dead). `bin/fix-brand-watch-foreign-tnc.mjs` handles both shapes (origin-swap for T&C-path URLs, drop for empty anchors, manual_review for anything else). Also: `qcMtTncHyperlink` false-negatives on operator-authored CKEditor HTML where the anchor text is split across nested `<span>`s or adjacent anchors ("T" + "erms and Conditions", seen on QPRO7 MT 454) — verify with `checkMtContent` (host-level) before trusting a "not wrapped in <a>" fail.
