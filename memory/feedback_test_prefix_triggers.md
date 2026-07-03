---
name: Code prefix triggers — TEST_ plus operator-named prefixes (VIP/FT/GLD/etc.)
description: Operator's remark instruction can name any prefix (VIP/FT/GOLD/etc.) that must be prepended to promo_code. TEST_ has additional campaign + requestor triggers and sits outermost.
type: feedback
originSessionId: 6baee7b0-ead2-43e6-a52c-73cd53df7d6e
---
Operator-named code prefixes are extracted from the remark column and prepended to the derived promo_code. TEST_ is special-cased with extra triggers; all other prefixes (VIP, FT, GLD, etc.) come exclusively from the remark.

## TEST_ — three independent triggers (any wins, applied OUTERMOST)

1. **`campaign` column** starts with `"test"`. Pattern: `/^test\b/i`.
2. **`requestor` column** has `test` at any word start. Pattern: `/\btest/i`. Catches `Testbot` (no space), `Test Bot`, `Tester`, `QA Tester`, `TestQC`. Does NOT match `Latest`/`Greatest`.
3. **`instructions.add_test_prefix`** parsed from remark. Accepts all of:
   - `Add TEST to code` / `Add 'TEST' to code` / `Add "TEST" to code`
   - `Add TEST` (no trailing "to code")
   - `Include TEST prefix` / `Use TEST code` / `Mark as TEST`
   - `TEST prefix` / `prefix TEST` / `TEST code`
   - Quotes optional. Verbs: add, append, include, use, tag, mark.

## Operator-named prefixes (instruction L) — `instructions.code_prefixes: string[]`

Patterns the parser matches in remark/details (case-insensitive, normalized to UPPER):

- `Add <X> to code` / `Add <X> to the code` / `please add <X> to the code`
- `Include <X> prefix` / `Use <X> code` / `Tag <X> code`
- `<X> prefix` / `prefix <X>` / `<X> code` (bare phrasing)
- Quotes around `<X>` optional: `Add 'VIP' to code`, `Add "GOLD" to code`

Tier name normalization (PREFIX_ALIAS in `src/ingest.js`):
- `GOLD → GLD`, `SILVER → SIL`, `BRONZE → BR`, `PLATINUM → PLT`, `DIAMOND → DMD`, `NORMAL → NRM`

False-positive guards:
- Token must be 2-8 chars, letters/digits only.
- Stopwords skipped: TO/ON/IN/AS/OF/OR/AT/BY/FOR/WITH/AND, ADD/APPEND/INCLUDE/USE/TAG/MARK, PLEASE, THE/A/AN/THIS/THAT, ELIGIBLE/LINK/ALL/ONE/PROMO/PROMOTION/PLAYER(S)/NAME(S), NEW/OLD/SAME/NEXT/BACK/NEAR, NO/YES.
- Bare regex uses `[ \t]+` not `\s+` so "prefix\n\nInfo Ready" does NOT capture "INFO".
- TEST is excluded from this list (handled via `add_test_prefix` instead).

## Ordering when both apply

Prefixes are prepended in mention order, with TEST_ applied last → ends up at the very front.

Example: remark "Add VIP to code, Add GOLD to code" + requestor "Testbot" + base `REL_25PCT_8X`:
- After VIP prepend: `VIP_REL_25PCT_8X`
- After GLD prepend: `GLD_VIP_REL_25PCT_8X`
- After TEST_ prepend: `TEST_GLD_VIP_REL_25PCT_8X`

De-dup: if `code.startsWith('<PREFIX>_')` already, skip that prepend.

## Where the logic lives (must stay in sync)

- **Parser** — `src/ingest.js` instruction K (TEST) + L (general). Emits `instructions.add_test_prefix: bool` and `instructions.code_prefixes: string[]`.
- **Auto-namer** — `src/promo-namer.js`. Runs when column W is empty. Applies category suffix → tier prefix → code_prefixes → TEST_.
- **Refer-resolver** — `bin/resolve-refer-source.mjs`. Runs when remark has "Pls refer X". Applies code_prefixes + TEST_ to the merged code (after pulling source).

**Why:** Operator's explicit remark instruction must be honored — `requestor=Testbot` on P073 should have produced `TEST_FT_REL_SPORTS_25PCT` automatically (2026-05-18). And rows 19-43 in May 2026 sheet have "Add VIP to code prefix" that the system was silently ignoring. Generalizing this avoids a brittle one-off per prefix.

**How to apply:**
- After any code change in this area, re-run `node bin/ingest-requests.js` so all fixtures pick up the new flags.
- When operator coins a new prefix phrasing not in the regex, broaden the regex rather than special-casing it.
- Existing column-W codes ALWAYS win over derived names — the namer is bypassed when the operator pre-fills column W. Prefix instructions only activate on derived rows OR the refer-resolver path.
