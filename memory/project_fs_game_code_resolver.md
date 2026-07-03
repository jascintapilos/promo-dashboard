---
name: FS game-code resolver (Provider catalog endpoint)
description: How to resolve a Free Spin game CODE (e.g. vs20olympgate) from an operator-supplied display name. The BO exposes a per-provider game catalog at `GET /api/bo/gameprovider/freespingame/{providerCode}` returning all FS-eligible games with code+name+site_id.
type: project
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
For Free Spin promos the BO requires `free_spin_game_code` set to PP2's (or other provider's) internal game code, e.g. `vs20olympgate` for "Gates of Olympus". Operators usually write only the display name in the sheet. The mapper resolves the code dynamically per brand.

## Endpoint
`GET /api/bo/gameprovider/freespingame/<provider_code>`

- Path param is the provider CODE (uppercase): `PP2`, `PP`, `HSG`, `SPRIBE`, `BNG`, `JILI`, etc.
- Returns `{ rows: [{ id, code, name, frb_code, game_provider_code, game_provider_name, game_category_code, game_category_name, game_sub_category_name, free_spin, ... }] }`.
- Single-page response (no pagination). QPRO1's PP2 returned 624 games in one call.
- `code` is the BO's internal game identifier (`vs20olympgate`); `name` is the display label ("Gates of Olympus").

## Resolver algorithm (`src/api-mapper-qpro.js` + `src/api-mapper-qp2.js`)
1. If input has `" - "`, take the left side as the code verbatim (operator-supplied code wins).
2. Exact case-insensitive name match → return its code.
3. Token-stem set match — stems are lowercase, ≥3 chars, trailing 's' stripped ("gate"/"gates" → "gate"). Require ALL input stems present AND game stems identical (no extra modifiers). Singleton match → return its code.
4. Otherwise → null. The mapper then falls back to the raw label, which the BO rejects (HTTP 422 "selected game_code.0 is invalid") — fail-loud for operator visibility.

## Why exact-set match, not subset
Per [feedback_fs_game_name_exact.md](feedback_fs_game_name_exact.md): "Gates of Olympus" (`vs20olympgate`) is a different game from "Gates of Olympus Super Scatter" (`vs20olympgold`), "Gates of Olympus 1000" (`vs20olympx`), "Gates of Olympus Xmas 1000" (`vs20olympxmas`), and "Gates of Olympus Dice" (`vs20olympdice`). Subset matching would silently up-shift the operator's input to a variant — wrong RTP and wrong mechanics ship.

## Also exposed
- `getFreeSpinGames(site, providerCode)` in `src/api-client.js` — thin wrapper used by both mappers.
- `getGameProviderDetail(site, providerId)` in `src/api-client.js` — returns `{currency: [<ids>], category, supported_target_type, ...}`. Used for per-brand currency filtering (see `project_per_brand_currency_filter.md`).
