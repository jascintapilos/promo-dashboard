---
name: fs-lines-resolver
description: FS reader now exposes raw amount_per_line + derived value_per_spin (= apl × lines_per_spin). Lines resolved via game-code prefix (Pragmatic Play vs<N>) with data/fs-games-lines.json overrides.
metadata: 
  node_type: memory
  type: project
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

`src/api-client.js:getPromotionDetail()` used to alias raw wire `amount_per_line` as `value_per_spin` — apples-to-oranges compare that hid a 20x-overpayment QP2 mapper bug for six weeks (2026-05-15 to 2026-07-02).

**Fixed 2026-07-02.** Reader now exposes both fields in `parsed` and `per_currency_overrides[<currency>]`:

- `amount_per_line` — raw wire (trust always)
- `value_per_spin` — computed `amount_per_line × lines_per_spin`
- `lines_per_spin` — resolver output (null = INCONCLUSIVE)

**Resolver: `src/fs-lines-resolver.js`** — `resolveLinesPerSpin(gameCode)`:
1. Override in `data/fs-games-lines.json:overrides[code]`
2. Variable-lines prefix match (Megaways etc.) → `null` (INCONCLUSIVE)
3. Pragmatic Play convention: `vs<N>...` → N lines (covers ~90% of in-use FS games)
4. Unknown → `null`. **Never guess a default** — that's how the mapper bug stayed live.

**Why:** Silent defaults hide real bugs. When Sentinel returns INCONCLUSIVE for a game, the operator must add it to `data/fs-games-lines.json` — not paper over it.

**How to apply:**
- Any consumer that compares source `value_per_spin` vs BO `value_per_spin` now works correctly (both sides use `× lines_per_spin` semantic).
- If a new PP2 game has a non-`vs<N>` code, add it to `overrides` in the catalog.
- If a non-PP2 provider ships FS, add its codes to `overrides` or a new prefix rule.

Related: [[fs-game-code-resolver]], [[qp2-fs-mapper-fix]], [[qp2-fs-amount-per-line-vs-value-per-spin]].
