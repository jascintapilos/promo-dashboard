---
name: ft-rel-30pct-8x-fix
description: FT_REL_30PCT_8X inbox MT (CNY copy leak) + QP2C blacklist fixed 2026-07-07 on 8 BOs; Jan-2026-created MTs are a CNY-leak sweep candidate.
metadata: 
  node_type: memory
  type: project
  originSessionId: 75c42de7-5581-4012-b26c-698488506043
---

2026-07-07: FT_REL_30PCT_8X (30% reload, TO 8x, max 300, min dep 30 MY / 50 SG) fixed on all 8 BOs carrying it — QPRO3/4/5/7/10/15/16 + QP2C/ACE66 (ibc22, promo id 750, merchant ACE66 only).

- Inbox MTs (created 2026-01-26) carried leaked CNY Free-Spin copy ("Celebrate the Year of the Horse with Lucky Free Spins" / "欢庆马年…免费旋转") on a deposit promo, subject "30% Reload Bonus", wrong category clause, no T&C link. Re-rendered from canonical deposit body via `renderBody()`, campaign intro stripped, subject forced to "Exclusive Offer"/"独家优惠". Script: `bin/fix-ft-rel-30pct-8x.mjs`; QC: `bin/_verify-ft-rel-30pct-8x.mjs` → 8/8 PASS.
- QP2C blacklist_template_id was null → set to 1 "All games" via echo PUT (no drift, currency rows + [] dialog preserved). QPRO sites already had per-BO "All games" (id=3 on QPRO3/4/5, id=1 on QPRO7/10/15/16).
- Note: renderBody() ALWAYS injects a campaign/tone intro + subject (copy-generator inferred fallback) — plain-standard MTs must strip the intro and override the subject.
- **Sweep candidate:** other promos with MTs created around Jan-Feb 2026 (CNY window) may carry the same leaked CNY copy on non-FS bonus types. Not yet swept. See [[mt-verify-content-checks]].
