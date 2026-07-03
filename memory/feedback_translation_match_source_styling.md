---
name: Translation output must match source styling exactly
description: When producing translation deliverables, mirror the source doc's styling (colors, fonts, table formatting) exactly — never invent or substitute styling.
type: feedback
originSessionId: f9eb932f-eada-4a12-a015-1128648a84f2
---
When producing translation output (Google Docs paste-ready HTML or otherwise), the styling must match the **source document** exactly — table colors, header styling, fonts, sizes, alignment, everything.

**Why:** Jascinta needs the translated version to be a drop-in replacement for the English source. If the agent picks its own colors (e.g. red headers when source has gold, or plain when source has a tinted header row), the translation looks off-brand and she has to redo the styling manually before publishing.

**How to apply:**
- Before producing styled output, **see** the source doc's actual styling. The Drive `read_file_content` API only returns text/markdown — no color info. Use Claude_in_Chrome (navigate + screenshot) or ask the user to share a screenshot to confirm colors/fonts.
- Never add color, borders, or styling that aren't in the source. Never "enhance" with red headers, gold accents, or any default casino-style flourish just because it's an iGaming promo.
- If the source is plain (no colors, default Google Docs table), the translation should also be plain.
- If unsure what the source looks like, ask before committing to a color scheme.
