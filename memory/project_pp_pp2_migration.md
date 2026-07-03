---
name: project_pp_pp2_migration
description: PP is disabled platform-wide on QPRO; PP2 is the active replacement. Swap script + how the migration was done.
metadata: 
  node_type: memory
  type: project
  originSessionId: d9127824-a6bc-47a8-b086-e775f172574d
---

On QPRO1–17 the game provider **PP (Pragmatic Play, old) is `status=0` (DISABLED) on every brand**; **PP2 is `status=1` (ACTIVE)** with the same `LC/SL` categories — a drop-in replacement. Any promo still listing PP points at a dead provider.

**2026-06-02/03 migration:** swapped PP→PP2 on all **3,159** active promos that contained PP across QPRO1–17 (0 failures). For the **308 Free Spin** promos (only on QPRO11/12/13/14/17, the un-migrated brands), also moved `free_spin_game_provider_id` PP→PP2 after validating `free_spin_game_code` exists on PP2 (503/508 PP FS games exist on PP2; 0 skips needed here). Final QC: 0 PP remaining anywhere; PP2 coverage 2,627→5,121.

**Tooling (reusable):**
- `bin/_check-pp-pp2-promos.mjs` — READ-ONLY audit; per-brand PP/PP2 counts, writes affected list to `tmp/pp-pp2-check.json`. `--brands`, `--status=`.
- `bin/swap-pp-to-pp2-promos.mjs` — the swap. Dry-run by default, `--commit` to write, `--brands`, `--limit`. Surgical per-list PP→PP2 on `game_provider_ids` + each `target[].game_provider_ids`; FS award move; reconstructs dialog popup from the LIST endpoint; verify-after each write; aborts on 3 consecutive failures. Resumable (re-fetches PP-containing targets each run).
- Provider ids vary per brand (e.g. PP/PP2 = 21/96 on QPRO1, 30/70 on QPRO2, 30/69 on most) — always resolve by CODE via `/api/bo/gameprovider?perPage=300`.

**Gotcha found:** welcome-type promos (`recurring=0`) store `reset_frequency=0`, which the QPRO PUT rejects as an invalid enum. The QPRO PUT body must only send `reset_frequency` when truthy (`p.reset_frequency ? {...} : {}`) — the same `||`-not-`??` rule already known for QP2, now confirmed for QPRO too. See [[project_qpro_put_currency_wipe]] (QPRO PUT must not re-send promotion_currency — this swap omits it and per-currency rows survived).

To run for inactive/expired promos later (not yet done): `_check-pp-pp2-promos.mjs --status=0` then `swap-pp-to-pp2-promos.mjs` (would need a status filter added to the swap's listing).
