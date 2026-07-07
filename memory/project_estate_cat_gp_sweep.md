---
name: project-estate-cat-gp-sweep
description: "2026-07-06 full-estate sweep for category-restricted promos with full provider catalogs — 45-promo fix batch built, awaiting commit approval."
metadata: 
  node_type: memory
  type: project
  originSessionId: d8cbe25e-e671-43de-945d-e8bd21cfd18a
---

2026-07-06: swept ALL active promos (7,947 across ibc22 + QPRO1-17, detail GET each) for the pre-4843b74 defect (category restricted, game providers = full catalog). Tools: `bin/sweep-cat-gp-estate.mjs` (read-only, writes tmp/estate-cat-gp-sweep.json) + `bin/fix-cat-gp-estate.mjs` (echo-style PUT fixer, dry-run default, `--include-overbroad --commit`).

Result: 45 promos to fix across 13 sites — families: 100FC_10X (8 sites incl. ibc22/ACE66), REL_SLOT_25/30PCT (qpro1/3/4), REL_BASE/BOOSTER LC+SPORTS 2026-06-17 (ibc22 all 4 merchants + qpro1/2/3/4), REL_TLEO_LC/SL 2026-05-26 (qpro3/4/6/8/10), WEL_WC26/WELC_188PCT (qpro1). 14 legacy rows (qpro13 VIP-UPGRADE ×12, qpro14 ×2) auto-skipped: their category union EXCEEDS saved providers ("all games at creation"), fixing would widen not narrow.

**Why:** sweep flag rule must exclude promos covering all 7 main cats (SPORT/LC/SLOTS/E-SPORTS/FISHING/CRASH/CRICKET = mapper "all games" convention — full providers is CORRECT there), and full-catalog threshold must be min(catalog, observed-max) because the catalog grows — ibc22 promos saved with 51 providers were full at save time even though max is now 56.

**How to apply:** re-run sweep after any mapper category change; commit the batch with `node bin/fix-cat-gp-estate.mjs --include-overbroad --commit` (recomputes provider targets from LIVE categories; stops batch on first drift). Never use the June builder (hardcodes members_only=0). Related: [[project-wc-slvr-qp2-provider-fix]], [[feedback-category-and-provider-must-match]].
