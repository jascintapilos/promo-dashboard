---
name: Bug — fixtures rewritten mid-run during P075-P084 QP2C batch
description: All 10 P075-P084 fixtures got rewritten to bare auto-namer codes (lost VIP+MIN patch) at 17:36:42 on 2026-05-20 during the QP2C batch, after the QPRO4 batch had completed cleanly. Root cause not identified.
type: project
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
**Symptom:** Mid-batch on 2026-05-20, all 10 `captures/requests/P07[5-9]*.json` and `P08[0-4]*.json` were rewritten back to bare auto-namer output (`REL_30PCT_8X`, `REL_100PCT_5X`) — VIP prefix and MIN suffix patches were lost. Mtimes synchronized to 17:36:42 across all 10 files.

**Timeline (2026-05-20):**
1. Fixtures patched manually via `node -e` script: `VIP_REL_<pct>PCT_MIN<amt>_<TO>X`.
2. Live QPRO4 batch ran cleanly — all 10 used patched codes (IDs 353-362).
3. Live QP2C batch started.
4. P075–P080 saved correctly with patched codes (IDs 1182-1187).
5. **At 17:36:42 — all 10 fixtures rewritten to bare auto-namer codes.**
6. P081 saved with bare `REL_30PCT_8X` (id=1188 — WRONG, orphan).
7. P082–P084 collided on the bare code (idempotency block, ec=5).
8. Workaround: re-patched fixtures, re-ran P081-P084 → IDs 1189-1192. Archived orphan id=1188.

**What did NOT cause it (checked):**
- `bin/canary-api.js`, `bin/canary-api-qp2.js` — no `writeFile`/`writeFileSync` on `captures/requests/`.
- `src/planner.js`, `src/promo-namer.js`, `src/bo-cache.js`, `src/session-cache.js` — read-only on requests/.
- `src/api-mapper-qp2.js`, `src/api-mapper-qpro.js`, `src/api-client.js` — no fixture write.
- No `sheets-ingest` / `ingest-requests` call from canary path.
- The local CORS server `bin/_serve-plans.mjs` was still running but is read-only (and operates on `tmp-plans/`, not `captures/requests/`).

**Candidate causes to investigate next time:**
- A watch/auto-ingest hook somewhere — maybe a hidden cron/scheduled task, or VS Code "format on save" running on the fixtures.
- A backgrounded `ingest-requests.js` from an earlier turn that I thought was killed but wasn't.
- Sheets-writeback flow that runs on a timer.
- `node_modules` postinstall or something mutation-y triggered by canary's session refresh.
- File-system watcher in Claude Code or another tool that auto-syncs `captures/` from a remote.

**Mitigation while root cause is unknown:**
- Re-verify fixtures (`for f in P###*.json; do node -e "console.log(require('./'+f).promo_code)"; done`) immediately before any canary --commit run.
- If running a batch, re-patch BEFORE EACH `canary-*` invocation, not just once.
- Better long-term fix: extend `src/promo-namer.js` to auto-add `MIN<amt>` suffix when min_deposit is the discriminator + honor explicit code overrides without being overwritten. That eliminates the need for manual patches entirely.

**Saves recovered cleanly — no business impact.** All 20 final saves are correct:
- QPRO4: IDs 353-362
- QP2C: IDs 1182-1187 + 1189-1192 (with id=1188 archived as orphan)
