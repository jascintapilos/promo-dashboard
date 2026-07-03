---
name: Promo auto-namer
description: When the operator leaves promo_code blank, the ingest pipeline derives it from bonus_type + parsed.* + remark + campaign. Promotion names (EN + ZH/ID) derived in lockstep — tier prefix appears in code only, not names. Wired into bin/ingest-requests.js; canary picks up derived values automatically and writes them back to the sheet as final step.
type: project
originSessionId: c72d4c31-9700-49d5-b99f-66f256fe39b9
---

`src/promo-namer.js` → `deriveNames(record)` → `{ promo_code, promotion_name_en, promotion_name_zh_id, source, missing }`.

## Code derivation (compose in this order)

### 1. Operator override (highest priority)
`instructions.code_name_override` → use it verbatim, skip all other steps.

### 2. Base pattern by bonus_type
| Bonus | bonus_sub_type | VIP signal | Pattern |
|---|---|---|---|
| Deposit | Welcome | — | `WELC_<pct>PCT_<TO>X` |
| Deposit | Reload | yes (campaign/remark has "VIP") | `VIP_REL_<pct>PCT_<TO>X` |
| Deposit | Reload | no | `REL_<pct>PCT_<TO>X` |
| Free Credit | — | yes | `VIP_<amt>FC_<TO>X` |
| Free Credit | — | no | `<amt>FC_<TO>X` |
| Free Spin | — | — | `<spins>FS[_<provider>]_<game_acronym>_<TO>X` |

### 3. FS-specific rules
- **Provider = PP2 (Pragmatic Play) is the DEFAULT** → omit from code: `100FS_GOO_20X`
- Non-default provider → include: `100FS_JILI_GOO_20X`
- Game acronym: first alpha letter of each whitespace-separated token, uppercase ("Gate Of Olympus" → `GOO`, "Sweet Bonanza Xmas" → `SBX`)

### 4. Suffix modifiers
| Source | Suffix |
|---|---|
| `instructions.category_only = "Slots"` | `_SLT` |
| `instructions.category_only = "Live Casino"` | `_LC` |
| `instructions.category_only = "Sports"` | `_SPT` |
| `instructions.category_only = "Table"` | `_TBL` |
| `instructions.category_only = "Fishing"` | `_FSH` |
| `instructions.category_only = "Arcade"` | `_ARC` |

### 5. Tier PREFIX (operator rule 2026-05-16 — moved from suffix)
Match against `remark + name_details` (case-insensitive `\bword\b`). First match wins. **Appears in code ONLY, NOT in promo names.**

| Match word | Code prefix |
|---|---|
| bronze | `BR_` |
| silver | `SIL_` |
| gold | `GLD_` |
| platinum | `PLT_` |
| diamond | `DMD_` |
| normal | `NRM_` (only the literal word — negative-lookbehind excludes "account manager: normal" etc.) |

### 6. TEST_ campaign prefix (applied LAST, sits at the very front)
If `campaign` matches `/^test\b/i` (trimmed) → prepend `TEST_`.

### Composed order
`TEST_<TIER>_<base>_<category_suffix>`

Examples:
- `TEST_100FS_GOO_20X` — TEST + FS 100 spins + Gate Of Olympus + 20x TO (no tier, PP2 default)
- `TEST_SIL_100FS_GOO_20X` — same + Silver tier prefix
- `GLD_REL_30PCT_3X` — Gold tier + Reload Deposit 30%/3x (no TEST)
- `TEST_PLT_50FC_5X` — TEST + Platinum + Free Credit 50/5x
- `DMD_WELC_100PCT_8X` — Diamond + Welcome Deposit 100%/8x
- `REL_30PCT_3X_SLT` — Slots-only Reload 30%/3x (production code, no tier)

## Names derivation (EN + ZH/ID)

Tier does NOT appear in names. Names use the base bonus pattern only.

| Bonus | EN | ZH/ID |
|---|---|---|
| Deposit/Welcome | `<pct>% Welcome Bonus` | `<pct>% 欢迎奖励` |
| Deposit/VIP Reload | `VIP <pct>% Reload Bonus` | `VIP <pct>% 充值奖励` |
| Deposit/Reload | `<pct>% Reload Bonus` | `<pct>% 充值奖励` |
| FC/VIP | `Exclusive <amt> Free Credit` | `VIP <amt> 免费体验金` |
| FC | `Exclusive Offer - <amt> Free Credit` | `独家优惠 - <amt> 免费体验金` |
| FS (game known) | `<spins> Free Spins on <game>` | `<spins> 次免费旋转 — <game>` |
| FS (no game) | `<spins> Free Spins` | `<spins> 次免费旋转` |

## Return shape

```
{
  promo_code: "TEST_100FS_GOO_20X",
  promotion_name_en: "100 Free Spins on Gate Of Olympus",
  promotion_name_zh_id: "100 次免费旋转 — Gate Of Olympus",
  source: "derived" | "override" | "incomplete" | "unsupported",
  missing: []   // populated when source = 'incomplete'
}
```

## Wiring

`src/sheets-ingest.js` calls `deriveNames` per row when `promo_code` is empty, sets `rec.promo_code` + (when also empty) `rec.promotion_name_*`. Stamps `rec.auto_named = { source, missing? }` on the record so the fixture preserves provenance.

`bin/ingest-requests.js` summarises namer outcomes per run (e.g. "66 already named, 2 derived, 0 incomplete").

`bin/canary-multi-brand.js` validation gates on `promo_code`; `derived` rows pass through. Final sheet write-back pushes `promo_code` + names + `status="Created"` back to the source row when the canary commits at least one brand successfully.

## Verified live 2026-05-16

- P066 Deposit/Reload 20%/3x → `REL_20PCT_3X` (dry-run only, real code, kept dry per operator)
- P067 Free Spin 100 / Gate Of Olympus / 20x → `TEST_100FS_GOO_20X` (PP2 default omitted, GOO acronym, TEST campaign prefix)
- Unit-tested across all tier × bonus combinations

## Not auto-named

- Rows with non-empty `promo_code` (operator values win)
- Cashback bonus type (no T&Cs authored, mapper bails)
- FS missing both `spin_count` AND `to_multiplier` → `source: 'incomplete'`
