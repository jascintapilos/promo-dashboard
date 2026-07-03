---
name: FS game names are exact, not aliases
description: PP2 game variants (Super Scatter / 1000 / Xmas / Dice / Bingo) are distinct games. Do not silently up-shift "Gates of Olympus" to "Gates of Olympus Super Scatter" — they have different game codes and different RTP/mechanics.
type: feedback
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
When the operator writes a Free Spin game name in the sheet (e.g. `Gates of Olympus`), match it LITERALLY to the catalog entry of the same name (`vs20olympgate`). Do NOT auto-promote it to a "popular variant" you've seen before like `vs20olympgold` (Gates of Olympus Super Scatter).

**Why:** The PP2 catalog has multiple distinct games sharing a base name — "Gates of Olympus" (`vs20olympgate`), "Gates of Olympus Super Scatter" (`vs20olympgold`), "Gates of Olympus 1000" (`vs20olympx`), "Gates of Olympus Xmas 1000" (`vs20olympxmas`), "Gates of Olympus Dice" (`vs20olympdice`). They are *different games* with different RTP and bonus mechanics. Picking the wrong one ships a wrong-game promo to players. Past canary captures using `vs20olympgold` were that specific game, not a generic alias.

**How to apply:**
- In the FS game-code resolver, prefer EXACT stem-set match (input stems == game stems) over subset/substring matches.
- On ambiguous matches (multiple candidates with different stem sets), surface to operator — don't pick a "canonical" by length or popularity.
- Singular/plural normalization (Gate ↔ Gates) is fine, but anything beyond that — extra modifier words like "Super Scatter", "1000", "Xmas", "Dice" — must NOT silently extend the operator's input.
- When suggesting fixes or describing matches in chat, never assume an extended variant is what the operator meant. "Gates of Olympus" is "Gates of Olympus", full stop.
