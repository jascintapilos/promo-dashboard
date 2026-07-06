---
name: project-ws1-my-bucket2-dedupe
description: Bucket-2 dedupe on WS1 MY (82 FreeCredit/FreeSpin promos, 21 duplicate-name groups) executed 2026-07-06; RM1288 pair still flagged for manual decision.
metadata:
  type: project
---

2026-07-06: Deduped 82 active FreeCredit/FreeSpin promo names on WS1 MY via `bin/_dedupe-ws1-my-bucket2.mjs --commit` — same recipe as the TLEO family (code-derived parenthetical suffix, T&C snapshot/restore across the reward-detail PUT per [[feedback-igmp-reward-details-put-wipes-tnc]], fail-fast per-promo verification). 82/82 applied; independent recount of active FC/FS names post-commit found only 1 duplicate group remaining (down from 22).

Excluded scope (deliberately): campaign prize-pool types (LuckyWheel/ScratchCard/MysteryAngpow/Gashapon/LuckyDraw — bucket 1, shared names are by design) and SmsRecovery (2022 VIP Fast-track groups) — left untouched, still on hold. Related: [[project-ws1-legacy-name-dedupe]].

**OPEN: "VIP RM1288 FREE CREDIT - 5x TO" ×2** (`FT_VM_FC_1288_5XTO` created 2026-05, `FT_VM_FC_1288_5X` created 2025-07) — flagged, not renamed. Near-identical codes suggest an accidental re-creation; recommend deactivating the older 2025 one rather than suffixing both, pending Wai Yip's confirmation.

Script restored from `bin/_archive/` where a routine cleanup commit had swept it up as an untracked one-off file before it was ever committed — now tracked in `bin/`. Scoped to WS1 MY only (not SG, not WS2) — this batch doesn't have a cross-site twin the way TLEO did.
