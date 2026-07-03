---
name: Always re-ingest the spreadsheet before any end-to-end run
description: Before running canary-multi-brand (or any per-brand canary) for a P### request, ALWAYS run `node bin/ingest-requests.js` to refresh the fixture from the current sheet state. Never hand-edit the fixture or assume yesterday's ingest is current.
type: feedback
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
Before kicking off the canary on any P### / B### request, re-run `node bin/ingest-requests.js` to overwrite `captures/requests/<handle>.json` with the latest sheet snapshot. The operator updates the sheet between runs — new remarks, prefix changes ("Add TEST to code"), validity edits, brand additions — and a stale fixture will save the wrong thing.

**Why:** Per Jascinta 2026-05-18. On P071, an earlier hand-edited fixture (synthesized from a "Pls refer" source promo) skipped a fresh ingest. The operator had added `"Add TEST to code"` to the remark after the first try, and also corrected validity/max_per_player values. The run saved with the wrong code (no TEST_ prefix) and wrong values on QPRO6/QPRO8, plus extended an unrelated production QP2 promo (id=922) with the wrong merchant attachment. Required archive + revert cleanup.

**How to apply:**
- Step 1 of EVERY `/run pXXX` flow: `node bin/ingest-requests.js`. Even when re-running a request that was ingested seconds ago — the operator may have edited the row.
- Never hand-edit `captures/requests/<handle>.json` to fill gaps. If the fixture is incomplete (gaps array non-empty, blank promo_code, blank promotion_name), STOP and surface to operator. Don't synthesize from a "Pls refer" source — let parseInstructions resolve the source via `duplicate_source` / `refer_to` (and improve the parser if it misses).
- If a hand-edit is unavoidable (one-off recovery), narrate the change to the operator before the run. Don't run silently.
- The fixture's `status` field reflects sheet state; "Created" means an earlier run already committed — the new ingest will overwrite it, and the canary's idempotency check is the safety net against double-saves.