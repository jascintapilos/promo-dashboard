---
name: project-ws1-sg-legacy-name-dedupe
description: WS1 SG legacy dup-name dedupe done 2026-07-07 — 54 renamed with player-neutral mechanics suffixes; MIN18 config anomaly on FT_REL_70PCT_18X_MIN100_V1 pending.
metadata: 
  node_type: memory
  type: project
  originSessionId: b9f6f1d4-1561-4bb1-a956-5830b509a1dc
---

2026-07-07: WS1 SG (ws1-v3-sg) Bonus-type duplicate-name dedupe complete — 54 active promos across 20 dup groups renamed via `bin/_rename-ws1-sg-legacy-unique.mjs --active-only --commit`, using the player-neutral mechanics convention ([[feedback-player-neutral-rename-suffixes]]). Post-save re-pull: all names unique site-wide. brand-watch re-run: all 56 WS1_SG baseline dup-name findings resolved, QC Results Log updated (56 rows).

Status of follow-ups (2026-07-07):
- **WS2 dedupe DONE** same day: 6 renames (script gained `--site=` flag + plain-code-keeps-clean-name rule for numeral ties — channel variants like "Aff …" take the numeral). brand-watch: all 8 WS2 findings resolved; zero active dup names remain on WS2. Remaining site-wide WS2 dups are inactive-only legacy rows.
- **FT_REL_70PCT_18X_MIN100_V1 (id 2898) RESOLVED** by parallel session: intended min = 100 (reward T&C says SGD 100); name set to "(MIN100 / CAP888)" via bin/_fix-2898-min100.mjs. The min-deposit config field is CREATE-ONLY on WS1 (no edit endpoint, see [[feedback-igmp-min-deposit-create-only]]) so live value stays 18 — SUPPRESS_MIN entry kept in the rename script so reruns never derive a suffix from it. **Config swap still OPEN, needs operator go**: deactivate 2898 + recreate as `FT_REL_70PCT_18X_MIN100_V2` with min=100 (precedent: V-less pid 2882 carried the wrong MIN50 config and was deactivated → recreated as _V1) + relink any FastTrack campaign on the old code. Until swapped, the live promo (active, ends 31/12/2026) grants 70%/CAP888 on deposits as low as SGD 18.
- **WS1 MY rework**: [[project-ws1-legacy-name-dedupe]] renames (2026-07-06) used channel-token suffixes predating the neutral rule — rework session started 2026-07-07.
- Also observed: WELC_188PCT_25X / FT_WELC_188PCT_25X codes say 25X but BO TO=20 (existing name says TO20x, consistent with BO).
