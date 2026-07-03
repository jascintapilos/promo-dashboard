---
name: Promo template / inbox copy rules
description: House style rules for Section 6.6 Message Template bodies and subjects across deposit / free credit / free spin promos.
type: feedback
originSessionId: bdcf6e25-b81a-451e-9f65-d950b7db70f8
---
Rules confirmed 2026-05-14:

1. **FC subject + body MUST state the actual free credit amount** (not the wallet cap / max_transfer_out).
   - Subject pattern: `Free Credit - {{currency_symbol}} {{free_credit_amount}} Exclusive Offer`
   - Body opens with `You are entitled to a {{currency_symbol}} {{free_credit_amount}} Free Credit!`
   - **Why:** the customer reading the inbox needs to know how much credit they got, not the withdrawal cap. The cap is in the T&Cs (item 1).
   - **How to apply:** when authoring or editing FC bodies, always include the free_credit_amount line near the top. Never substitute it with max_transfer_out.

2. **EN category list: "Slots" plural, never "Slot"**.
   - The request sheet often supplies `'Slot'` singular; the renderer normalizes to `'Slots'` for EN only via `CATEGORY_TRANSLATIONS.EN`.
   - **Why:** house copy convention.
   - **How to apply:** if adding a new EN category, follow the same plural form (e.g. "Games", "Sports") unless the user says otherwise.

3. **2-item EN category list: no Oxford comma**.
   - "Slots and Live Casino" — NOT "Slots, and Live Casino".
   - 3+ items keep the Oxford comma: "Slots, Live Casino, and Sports".
   - **Why:** reads more naturally with two items.

4. **FS body must NOT contain the provider code prefix** (e.g., `PP2 -`).
   - Renderer strips `^[A-Z0-9]+\s*-\s*` from `r2.game_provider` before exposing the placeholder.
   - "PP2 - Pragmatic Play" → "PRAGMATIC PLAY" in output.
   - **Why:** the BO-internal provider shortcode is meaningless to customers.
   - **How to apply:** when adding a new provider mapping or game, the human-readable name is enough. Code prefixes belong in the BO config, not the inbox copy.

5. **No footer** (clauses 11.x in the source Inbox T&C docs).
   - **Why:** house rule — operator ignores the footer block during translation.

6. **`:merchantname` (QP2) / `:brandname` (QPRO) LITERAL always.**
   - See [feedback_promo_template_placeholders.md](feedback_promo_template_placeholders.md).
