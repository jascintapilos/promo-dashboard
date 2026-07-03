---
name: promo-translation-html skill
description: User-level skill at ~/.claude/skills/promo-translation-html/ that automates iGaming promo translation into ZH/TH/KM/ID/BM with one HTML file per language, paste-into-Google-Docs ready.
type: reference
originSessionId: f9eb932f-eada-4a12-a015-1128648a84f2
---
User-level skill: `C:\Users\vdiuser\.claude\skills\promo-translation-html\`

**Triggers on:** Google Docs link + target language codes (ZH, TH, KM, ID, BM). Patterns like "Translation Request — Languages: ZH, TH, KM, ID" with a Drive URL, "translate this to ZH and ID", or pasted EN content with language codes.

**What it does:**
1. Fetches source via Drive `read_file_content`
2. Skips Chrome source-styling verification by default (the standard MY/EN promo template is consistent — Calibri 12pt, plain white tables, thin black borders, bold headers only). Only verifies if `--verify-styling` flag or source has unusual styling signals.
3. Translates each section, applying the glossary at `references/glossary.md`
4. Auto-appends new KM/ID terms to the glossary (marked `[auto-added YYYY-MM-DD]`)
5. Writes one HTML file per language to the working directory: `<BRAND>_<LANG>_translation.html`
6. Reports glossary auto-adds, items kept in English, and anything needing user confirmation

**Files in the skill:**
- `SKILL.md` — main instructions, styling rules, do-not-translate list, per-language conventions
- `references/glossary.md` — the canonical glossary (mutable; auto-appended)
- `references/template-example.html` — canonical HTML scaffold to mirror
- `references/tnc-links.md` — brand × language T&C URL map for QPRO1–19 + QP2A–D, used to hyperlink the T&C section heading. Source of truth: TNC link tab in the Directory sheet.

**T&C hyperlinking (added 2026-05-17):**
- The translated T&C section heading is wrapped in `<a href="...">` when brand is QPRO/QP2 AND a URL exists in `tnc-links.md` for that brand × target language
- Default locale is MY (zh-my for QPRO, ?lang=MY_ZH for QP2). SG variants are tracked for ZH only.
- TH and KM almost always fall through to plain-text fallback (no QPRO/QP2 brand has those T&C URLs). ID only QPRO1 has one.
- WS1/WS2/other brands → always plain text for now (scope set by user 2026-05-17)
- Final report lists per-file: `T&C linked → <URL>` or `T&C plain text (reason: ...)`

**Khmer T&C phrase:** `ច្បាប់ និងលក្ខខណ្ឌ` (confirmed 2026-05-17, matches TNC link tab style — replaced the prior auto-added `លក្ខខណ្ឌនិងលក្ខន្តិកៈ`).

**Glossary handling:**
- ZH-Simp / ZH-Trad / TH / BM columns are human-curated — never auto-modify
- KM / ID columns are auto-built — every auto-add flagged in the report for review
- New term not in glossary at all → new row added with `[TBD]` in unfilled cells

**Source styling assumption:** the skill assumes Calibri 12pt, plain white tables, thin black borders, bold headers only — the standard template across MB8, RWS77, BP9, MICROGAMING, etc. If a future doc breaks this assumption, the user can pass `--verify-styling` to force a Chrome screenshot pass.

**Related — QC engine sync (as of 2026-05-14):**
- `anthropic-skills:translation-qc-engine` (plugin skill) has been patched to read its glossary from the canonical path: `~/.claude/skills/promo-translation-html/references/glossary.md`
- The QC engine's local `references/glossary.md` is now a one-page stub pointing at the canonical
- The QC engine's SKILL.md was edited so every `references/glossary.md` reference becomes the canonical path
- **If the plugin updates and clobbers the patch:** re-apply by (1) replacing the QC engine's `references/glossary.md` with a pointer stub and (2) global-replacing `references/glossary.md` → canonical path in its `SKILL.md`. Both files live under `C:\Users\vdiuser\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\<uuid>\<uuid>\skills\translation-qc-engine\`. The UUIDs change on re-install — find the current ones via `Glob` on `SKILL.md`.
