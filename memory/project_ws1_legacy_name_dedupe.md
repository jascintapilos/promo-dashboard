---
name: project-ws1-legacy-name-dedupe
description: "WS1 MY legacy (non-TLEO) duplicate PromotionNames deduped 2026-07-06, active-only scope; 14 inactive-scoped dup groups intentionally left."
metadata: 
  node_type: memory
  type: project
  originSessionId: 05fa4dab-4d6e-4c2c-b58d-dc42509031b9
---

2026-07-06: Deduped legacy (non-TLEO) duplicate PromotionNames on WS1 MY BO (kioskmy.best-in-asia.com) via `bin/_rename-ws1-legacy-unique.mjs` — 57/57 active promos renamed OK, **active-only scope chosen by Wai Yip**. Suffixes are code-derived parentheticals `(FT / REL / TO8)`, `(VM / DEP300 / GET100 / TO2)` etc., with tokens already present in the base name filtered out, and one clean-named "keeper" per group where possible. Verified post-save: 0 duplicate names among active promos.

**Intentionally left duplicated (14 groups, involve inactive rows only):** TEST iGMP ×13, "INACTIVE" VM_DEP* ×7, Super Sunday ×2, 50%/30% Deposit Optimove pairs, VIP Loyalty optimove_churn pairs, Genting ACQ + Exclusive V1/V2 pairs. Each still-active member of these groups is unique among active rows. If any inactive row gets reactivated, rerun the script WITHOUT `--active-only` (rerun-safe; dry-run by default, `--commit` to apply).

Note: 4 renames carry tier tokens (GOLD/PLATINUM/DIAMOND) because the codes differ only by tier (ADHOC_*_NOV15, AM_ADHOC_*_1.0) — accepted exception to [[feedback-no-tier-in-promo-name]] for legacy dedupe. Related: [[feedback-ws1-ws2-unique-promo-name]], TLEO family deduped 2026-07-04 via `bin/_rename-ws1-tleo-unique.mjs`.

**OPEN — non-Bonus types not deduped.** Per [[feedback-igmp-list-misses-freecredit]], the dedupe scope above only covered Bonus-type promos (PromotionType:0). `bin/_probe-ws1-alltype-dups.mjs` (all-type sweep, 3109 promos) found 99 name groups duplicated among ACTIVE rows in FreeSpin/FreeCredit/PhysicalGift space. Most are intentional campaign prize pools (Lucky Wheel/Scratch/Gacha "(C)" groups ×26-72, wheel-engine granted, not MR-dropdown picked). Genuinely suspicious non-campaign groups awaiting Wai Yip's direction: "Interview Appreciation Reward" ×10 active (FC_STREAM1-9), "Exclusive Offer - N Free Credit" pairs, "Contact live chat" FC pairs, VIP Fast-track FC pairs ×8 groups, GOO/FOO FreeSpin ladders ("88 Free Spins - Fortune of Olympus" ×11 active, "96/28 FS" groups). Do NOT mass-rename campaign (C) groups without confirming the wheel engine doesn't key on shared names.
