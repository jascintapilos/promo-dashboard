---
name: lc-rel-clone-batch
description: ACQ_REL_*PCT_12X_LC created 2026-07-18 (P145-P147) as WELC clones on QPRO2+QP2D; sentinel single-merchant QP2D FAIL is a false positive for this family.
metadata: 
  node_type: memory
  type: project
  originSessionId: fd3ed2f4-4ab4-4af6-98d1-fe04b685e224
---

2026-07-18: created `ACQ_REL_120/150/180PCT_12X_LC` (P145–P147, July 2026 rows 147–149) as Reload clones of `ACQ_WELC_*_12X_LC` per Wai Yip. QPRO2 ids 584–586 (MYR-only, MTs 512–514, dialogs 370–372); QP2D ids 1410–1412 (MTs 1351–1353, dialogs 1940–1942). QP2D post-save via `bin/_fix-lc-rel-qp2d-parity.mjs`: SGD rows (same numerics), SPORT category, blacklist template 11, MT clause rewrite (LC+Sports wording) + SG_EN/SG_ZH locale blocks. **Sport providers = ALL, no exclusions** — Wai Yip added BTI/SBO2/WF by hand on QP2D after I applied only the 5 "non-hard-excluded" ones; hard-exclusion assumptions do NOT apply to this family's sports set. QPRO2 (both WELC 579–581 and REL 584–586) then got LC+Sports via `bin/_fix-lc-sports-qpro2.mjs`: cats [2,1], blacklist 6→11 ("Live Casino and Sports Only"), all 10 QPRO2 sport providers (9W/BTI/CMD/IM/2BC/MAX/SBO/SBO2/TF/WBET), MTs 507–509+512–514 clause updated EN+ZH. All verified live by content GET.

**Sentinel false-positive pattern:** the LC WELC/REL family is genuinely **QP2D-only** (single merchant SPADE66, single dialog). Sentinel hard-FAILs "single merchant + single dialog on non-QP2A brand" as the [[canary-multibrand-qp2-race-bug]] signature — for this family that's intended scope, not the race bug. Evidence: WELC sources 1400–1402 are also SPADE66-only. Also: these MTs have no How-to-Redeem section by design (house template; steps live in the dialog popup) — WELC MTs 507–509/1340–1342 are identical.

**How to apply:** when QCing this family (or any deliberately single-QP2-merchant promo), confirm intended scope from the sheet Brand column before treating the sentinel FAIL as real. Fixed same session: `bin/canary-validate.js` legacy branch no longer demands WELC_ for "ACQ - Reload" campaigns when Requestor isn't a recognized team (e.g. "Marketing").
