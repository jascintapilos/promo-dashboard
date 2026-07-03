---
name: feedback-msg-template-categories-grammar
description: "Deposit template T&C categories line must use the \"All game categories are eligible\" structure when categories is empty (not \"are All\")."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 82477a57-d4ec-4d6b-a25e-ecac80954716
---

When the row's `categories` list is empty (= no game-category restriction), the message-template T&C item for eligible categories must NOT read "...are All." — that's grammatically wrong. Use the FC-style "All game categories are eligible" structure instead.

**Branching rule** — gate on the `all_categories` flag (`cats.length === 0`). The "all" branch MUST include the inverse-category exclusion clause (operator rule 2026-05-22) — matching the FC template's existing structure:

- EN: `{{#if_all_categories}}All game categories are eligible for this promotion except {{excluded_categories}}.{{else}}The eligible game categories for this promotion are {{eligible_categories}}.{{/if}}`
- ZH: `{{#if_all_categories}}除了 {{excluded_categories}} 外，所有游戏类别均适用于此优惠活动。{{else}}本优惠适用于以下游戏类别：{{eligible_categories}}。{{/if}}`
- ID: `{{#if_all_categories}}Semua kategori permainan memenuhi syarat untuk promosi ini kecuali {{excluded_categories}}.{{else}}Kategori permainan yang memenuhi syarat untuk promosi ini adalah {{eligible_categories}}.{{/if}}`

**Why:** The placeholder `{{eligible_categories}}` falls back to the literal "All" / "所有" / "Semua" when the categories list is empty, producing awkward sentences ("The eligible game categories for this promotion are All."). The FC template already uses the "All game categories are eligible for this promotion except X" structure — Deposit should mirror it for the unrestricted case.

**How to apply:** Lives in `src/message-template-bodies/deposit/{EN,ZH,ID}.html` (Deposit only — FC and FS are unaffected). Renderer adds `all_categories: cats.length === 0` to the `flags` object (`src/message-template-renderer.js`). Patched + applied retroactively to P102/P103 × QPRO3/4/5/9 (8 templates, 16 locale rows) via `bin/_fix-p102-p103-msg-template-categories-grammar.mjs` on 2026-05-22.

See also [[feedback-default-categories-all-games]] (the rule that "no category mention → all eligible"), [[feedback-promo-fc-inbox-rules]] (FC inverse-exclusion convention).
