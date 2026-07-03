---
name: Promo template — :merchantname for QP2, :brandname for QPRO, LITERAL always
description: Per-platform brand-placeholder rule for Section 6.6 Message Template body and subject. The placeholder strings must remain literal in the rendered output — the BO substitutes per-brand at display time. Never substitute them client-side.
type: feedback
originSessionId: bdcf6e25-b81a-451e-9f65-d950b7db70f8
---
Rule: rendered Message Template content for Section 6.6 MUST use:
- **`:merchantname`** for QP2 platform (brands QP2A, QP2B, QP2C, QP2D — IBC22 / KING333 / ACE66 / SPADE66 on `ibc22.qtp777.com`)
- **`:brandname`** for QPRO platform (QPRO1–QPRO19 on `*.mei707.com`)

Both placeholders stay **LITERAL** in the saved template content. The BO substitutes them at message-display time per brand. Substituting client-side would bake one brand's name into a template that may get reused/audited from another brand context.

**Why:** the QP2 platform supports four merchants behind one BO, so the BO uses `:merchantname` to select the active merchant's display name. QPRO has one brand per BO, so it uses `:brandname`. Mixing them up means the message renders with an unresolved literal in front of customers.

**How to apply:**
- When authoring new body files under `src/message-template-bodies/`, write them with `:brandname`. The renderer auto-swaps `:brandname` → `:merchantname` when `platform === 'qp2'`.
- Never call any function that substitutes `:brandname`, `:merchantname`, or `:url` with a real value before saving.
- The renderer's swap logic at `src/message-template-renderer.js` lines 326-329 implements this — DO NOT remove it.
- If asked to "fill in the brand name" or "make the merchant name show up" in a saved template, refuse and explain the literal-placeholder rule.
- **When cloning MT content from QPRO to QP2** (e.g. `clone-mt-qpro2-to-qpro1.mjs` adapted for QP2 target): always run a post-clone pass to swap `:brandname` → `:merchantname` in every locale's `message` field before finishing. The renderer swap (lines 326–329) only runs during new template generation, not during a raw PUT clone.
