---
name: Promo Translation Automation — Current State (as of 2026-05-15)
description: What works, what doesn't, and edge cases learned during the build. Read before any promo translation task or when planning enhancements.
type: project
originSessionId: f9eb932f-eada-4a12-a015-1128648a84f2
---
**Status:** ✅ HTML+paste pipeline is the production path for promo translations.

## ✅ What works

- **Skill location:** `~/.claude/skills/promo-translation-html/` (activates after Claude Code restart; until then, manual workflow follows the same rules — same output)
- **Languages supported:** ZH (Simplified default), TH, KM, ID, BM
- **Output:** one HTML file per language in working directory, named `<BRAND>_<LANG>_translation.html`. User copy-pastes from the Launch preview panel into the target Google Doc; tables, bold, numbered lists, hyperlinks all carry over
- **Styling match:** Calibri 12pt, plain white tables with thin black borders, bold headers only, bold inline on dates and key phrases. No colors, no fancy fonts — mirrors source standard template
- **Glossary canonical:** `~/.claude/skills/promo-translation-html/references/glossary.md`. Shared between this skill and the `translation-qc-engine` (the QC engine's `references/glossary.md` was replaced with a pointer stub 2026-05-14). Auto-appends KM/ID entries with `[auto-added YYYY-MM-DD]` markers for review
- **Source-styling Chrome verification:** skipped by default (template is consistent across all tested docs); `--verify-styling` flag forces a screenshot pass

**Tested successfully on (4 languages each — ZH/TH/KM/ID):**
- MB8 Mid-Year Mega Draw
- RWS77 Mega-Gear Giveaway
- BP9 Mid-Year Spend & Win
- Microgaming Road to Glory
- PP Daily Wins Season 9 Level 3

## ❌ What doesn't work

- **Auto-create translated Google Docs in source's Drive folder.** Drive MCP `create_file` doesn't convert HTML→Doc — only `text/plain → Doc` and `text/csv → Spreadsheet` get auto-converted. Tested 2026-05-14, both attempts (with and without deprecated `mimeType=application/vnd.google-apps.document`) produced raw `text/html` files. Two test files left in My Drive root (`TEST 2026-05-14 — Promo Translation Drive Write Test (EN)` and `v2`) — no delete tool in this MCP, user trashes manually. **Decision:** stay with HTML+paste; revisit only if volume grows enough to justify a Docs-API-specific MCP.

## Edge cases observed (apply when translating)

- **USD-denominated docs (not MYR):** PP Daily Wins uses USD. Currency code preserved exactly; never converted to local currency.
- **No-table docs:** Some docs (PP Daily Wins) have zero tables — just bullet list (Promotion Details) + numbered lists. Same template applies (bold inline labels, hyperlinks preserved).
- **Embedded hyperlinks in T&C:** Anchor text translated per language (ZH `此处`, TH `ที่นี่`, KM `ទីនេះ`, ID `di sini`), URL preserved verbatim.
- **`:brandname` placeholder in source (e.g. BP9):** preserve literal in all translations; flag in report. Do NOT auto-substitute the title's brand name even when obvious.
- **Source content inconsistencies (e.g. PP Daily Wins had two different prize-pool numbers `USD 1,900,000` vs `USD 7,500,000`):** preserve both verbatim, flag at end. Translator does not fix source issues — that's a separate task for the writer.
- **Campaign feature names:** keep in English across all languages — `Daily Tournaments`, `Weekly Wheel Drops`, `Wheel Pieces`, `Daily Wins`, `Tech Refresh`, `Road to Glory`, `Daily Slot Tournaments`.
- **Tournament-style docs with rank tables:** Microgaming RTG had Daily/Grand rank tables (2-col rank/reward). Same template applies — bold header row only, centered cells, no fill.
- **Single-column tables:** Microgaming "Participating Games" used a 1-col 2-row table (header + game list). Template handles.
- **All-caps brand/provider names:** preserve case — `MICROGAMING`, `PRAGMATIC PLAY`, `MB8`, `RWS77`, `BP9` stay exactly as source.
- **Date format:** mirror source. DD/MM/YYYY → mirror as-is. "25 May 2026" with English month names → either mirror EN months or localize months consistently; the user has not corrected either approach yet.

## Pending work

- **Share skill with colleague:** before distribution, generalize the hardcoded Drive MCP tool UUID in `SKILL.md` (currently `mcp__d9e74fd6-...`) to "the Google Drive MCP server's `read_file_content` tool" so it works on a colleague's Drive connector. Then either zip-and-copy to colleague's `~/.claude/skills/` or package via `cowork-plugin-management:create-cowork-plugin`. Colleague needs their own Drive MCP connector active.
- **Test files cleanup:** two `TEST 2026-05-14 ...` HTML files in user's My Drive root need manual trashing.
