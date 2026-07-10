---
name: fs-provider-playtech-or-pragmatic
description: "Free Spin promos can be either Playtech or Pragmatic Play — never assume PP2 by default; extract and thread the operator's provider annotation end-to-end."
metadata: 
  node_type: memory
  type: project
  originSessionId: d0562004-d2d4-4c8b-9ad9-1dd191906302
---

Free Spin games in this operation come from **either Playtech or Pragmatic Play** — there is no single default provider. Confirmed 2026-07-10 on P053: "Fire Blaze: Green Wizard" is a Playtech-only title (game code `gpas_gwizard_pop`, provider code `PTI`) that does not exist in Pragmatic Play's catalog at all, verified directly against live BO data on both QPRO2 (`PTI`=id 59 there) and QP2/ibc22 (`PTI`=id 308).

**Root cause found and fixed (2026-07-10):** `src/ingest.js` parsed the game name from `name_details_raw` but deliberately stopped before any trailing `(Provider)` annotation and never captured it — so `parsed.game_provider` was always empty, and every FS mapper (`src/api-mapper-qpro.js`, `src/api-mapper-qp2.js`) silently defaulted to Pragmatic Play (`DEFAULT_FS_PROVIDER_LABEL` / `QP2_DEFAULT_FS_PROVIDER_LABEL = 'PP2 - Pragmatic Play'`) regardless of what the operator actually wrote. This affected the numeric `free_spin_game_provider_id`, `game_provider_ids`/`game_provider_codes`, the resolved FS game code, AND the MT/dialog copy's "To: <PROVIDER>" wallet-transfer line — i.e. the promo would have gone live restricted to the wrong provider's entire game catalog, not just wrong wording.

**Fix shipped:**
- `src/ingest.js` — added a `(Provider)` parenthetical extractor (`PROVIDER_ALIASES`: `playtech`, `pragmatic play`/`pragmatic`/`pp`) that populates `parsed.game_provider` from the operator's annotation, e.g. `"Fire Blaze: Green Wizard (Playtech)"` → `parsed.game_provider: "Playtech"`.
- `src/api-mapper-qpro.js` — `resolveFsProvider(site, label)` (replaces `resolveFsProviderId`) now matches the live `/api/bo/gameprovider` list by provider **name** as a fallback when the label isn't the legacy `"<CODE> - Name"` form, and returns `{id, code}` so the resolved BO code (not a re-derived guess) feeds the `freespingame` lookup.
- `src/api-mapper-qp2.js` — QP2's `/api/bo/gameprovider` LIST endpoint 500s on this platform (unlike QPRO), so dynamic lookup isn't available; added `QP2_FS_PROVIDER_ID_BY_PREFIX.PTI = 308` (Playtech, confirmed via the per-id detail endpoint `/api/bo/gameprovider/308`) and a `QP2_PROVIDER_NAME_TO_PREFIX` map (`playtech`→`PTI`, `pragmatic play`/`pragmatic`→`PP2`) consulted by the new `fsProviderPrefixFromLabel()` helper.

**Why this matters:** this was caught in pre-QC before commit only because the QC agents' verdicts on the same evidence disagreed with each other — some accepted "PRAGMATIC PLAY" in the copy as fine, others flagged the entity-encoding around it instead of the actual provider mismatch. It took reading the raw plan JSON and cross-checking the live BO game/provider catalogs directly to find the real defect. [[feedback_fs_game_name_exact]] (exact stem-set game matching) already guarded game *name* precision; this closes the same gap for provider *attribution*.

**How to apply:** when a new FS request names a provider other than Pragmatic Play or Playtech, extend `PROVIDER_ALIASES` in `src/ingest.js`, add the BO code to `QP2_FS_PROVIDER_ID_BY_PREFIX` (via the per-id detail endpoint probe, since the list endpoint doesn't work on QP2) and to `QP2_PROVIDER_NAME_TO_PREFIX`/`QP2_PROVIDER_NAME_TO_PREFIX`-equivalent on QPRO (QPRO resolves dynamically, no hardcoding needed there). Never trust a QC agent's "this default provider looks fine" verdict on an FS promo without checking `parsed.game_provider` against the operator's source annotation first.

**WS1/WS2 (IGMP) platform limitation, confirmed 2026-07-10:** IGMP kiosk BOs (checked ws1-v3-my and ws2) have **only one FS-enabled provider installed: Pragmatic Play** (`gamex-pragmaticplay`, Id=208). Playtech is not installed as an FS provider there at all — `resolveProviderId` in `src/igmp-fs-resolver.js` correctly throws "no FS-enabled provider matches Playtech" once given the right hint. This is a real platform gap, not a resolver bug: any FS promo whose game is Playtech-only (like "Fire Blaze: Green Wizard") cannot be created on WS1/WS2 until Playtech is installed there — surface this to the operator rather than trying to force a workaround.

Also fixed in the same pass: `bin/canary-api-igmp.js` read `rec.fs_provider` (a field nothing ever populates) instead of `rec.parsed?.game_provider` (the real source, already read correctly by `src/igmp-tnc.js:172`) — so IGMP always searched "all providers" and produced a confusing error instead of the accurate "provider not installed" one above. Fixed to read `rec.fs_provider || rec.parsed?.game_provider`.
