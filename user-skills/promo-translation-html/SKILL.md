---
name: promo-translation-html
description: Translate iGaming/online casino promo Google Docs into ZH, TH, KM, ID, and/or BM, producing one paste-into-Google-Docs ready HTML file per language that mirrors the standard source styling (Calibri 12pt, plain white tables with thin black borders, bold table headers only, bold inline on dates and key phrases). Trigger whenever the user shares a Google Docs link (or paste) for a promo doc and specifies one or more target language codes — patterns like "Translation Request — Languages: ZH, TH, KM, ID" with a doc link, "translate this to ZH and ID", or any Slack/chat handoff combining a Drive URL with target language codes. Also trigger when the user pastes EN promo content directly and asks for it translated. Default to skipping the Chrome source-styling verification — this skill assumes the source follows the standard MY/EN promo template. Only verify in Chrome if the user passes `--verify-styling`, or if the Drive content hints at non-standard styling (colored markdown table syntax, unusual layout, custom fonts). Auto-appends new KM/ID glossary terms as they are discovered.
---

# Promo Translation → Google-Docs-Ready HTML

You are a promo translation engine. Given an EN source promo doc and a list of target languages, produce one HTML file per language that pastes cleanly into Google Docs with all formatting preserved.

## Workflow

### 1. Parse the request
- Extract the source doc link (Google Docs URL → file ID)
- Extract target languages: `ZH` (= Simplified Chinese unless user says Traditional), `TH`, `KM`, `ID`, `BM`
- Note any flags: `--verify-styling` (force Chrome screenshot check)

If the source is pasted text instead of a link, work from the paste — skip Drive fetch.

### 2. Fetch source content
- Use the connected Google Drive MCP server's `read_file_content` tool with the file ID (the tool's full name is `mcp__<server-uuid>__read_file_content` — the UUID differs per user; use whichever Drive MCP server is currently connected)
- If access fails → ask the user to paste the content directly. Do not guess.

### 3. Source-styling verification (default: SKIP)

**Skip by default.** This skill assumes the source follows the standard MY/EN promo template (Calibri 12pt, plain white tables, thin black borders, bold headers only).

**Verify in Chrome only when:**
- User passed `--verify-styling`
- Drive markdown shows colored cells, unusual fonts, or custom table syntax
- Source mentions "new template" or "redesign"
- You see styling signals you can't interpret from text alone

If verifying and the source diverges from the standard template → **stop and ask the user** before producing output. Do not invent styling.

### 4. Translate each section using the glossary

For each target language:
- Read approved terms from `references/glossary.md` and use them verbatim
- Apply natural phrasing for the rest — never word-for-word calque
- Preserve all do-not-translate items (see below)
- Preserve numbered list structure, table structure, bold inline markers

### 5. Auto-append glossary entries (KM/ID priority)

When you encounter an iGaming term being translated for KM or ID and either:
- the term is in the glossary but the KM/ID column is empty, OR
- the term is not in the glossary at all

Then:
1. Pick the natural translation
2. Append to `references/glossary.md`:
   - If row exists: fill in the KM/ID cell with `<translation> [auto-added YYYY-MM-DD]`
   - If row doesn't exist: add a new row with `[TBD]` for languages you didn't translate this round
3. List every auto-add in the final report so the user can review

Never auto-modify the ZH-Simplified, ZH-Traditional, TH, or BM cells — those are human-curated. If you spot a missing or inconsistent entry, flag it; don't overwrite.

### 6. Generate one HTML file per target language

**Filename:** `<BRAND>_<LANG>_translation.html` in the current working directory. `<BRAND>` matches the source title prefix (e.g. `MB8`, `RWS77`, `BP9`, `Microgaming_RTG`). `<LANG>` is the uppercase language code (`ZH`, `TH`, `KM`, `ID`, `BM`).

**Use `references/template-example.html` as the canonical scaffold.** Mirror its structure exactly — body inline styles, table cell styling, ordered-list padding — only swap the content for translated text.

**Resolve the T&C hyperlink before emitting the T&C section:**
1. Map the source title's merchant prefix → brand code via the alias table in `references/tnc-links.md` (BP9 → QPRO1, IBC22 → QP2A, etc.).
2. If the brand code is QPRO1–19 or QP2A–D, look up the URL for (brand × target language) in the URL table. Default to the MY column unless the source clearly indicates SG.
3. If a URL exists, wrap the T&C heading in `<a href="...">`. If empty / brand out of scope, emit plain `<strong>` heading only.
4. List the resolved (or skipped) T&C link in the final report so the user can verify.

Write each file with the `Write` tool. After each write, the Launch preview panel will display it — mention this to the user.

### 7. Final report

After all files are written:
1. List every file produced (markdown links)
2. List every glossary auto-add: `[EN Term] → [LANG]: [Translation]` (so user can confirm)
3. List items kept in English (brand names, products, currencies)
4. Flag anything that needs user confirmation (placeholder tokens like `:brandname`, ambiguous phrasing, missing source content, etc.)
5. Note KM/ID translations remain provisional until reviewed by a native speaker — surface this when a doc has heavy KM or ID content
6. **T&C link decision per file** — for each output, state either `T&C linked → <URL>` or `T&C plain text (reason: <brand out of scope | no URL for this language | locale=SG fallback>)`

## Styling Rules (the standard template — mirror exactly)

**Font:** `Calibri, 'Microsoft YaHei', 'PingFang SC', 'Khmer OS', 'Helvetica Neue', Arial, sans-serif` (Calibri first, language-appropriate fallbacks)
**Size:** 12pt body throughout — NEVER larger for headings or titles
**Color:** black `#000000` on white — no colored headers, no fills, no accents
**Line height:** 1.5 (1.6 for TH, 1.7 for KM — both languages need extra leading)

**Tables:**
- `border-collapse: collapse; width: 100%`
- Cell: `border: 1px solid #000000; padding: 10pt; text-align: center`
- Header cell: add `font-weight: bold` — that's the only difference. No background fill.

**Title (e.g. "MB8 Mid-Year Mega Draw"):** `<p style="margin: 0 0 12pt 0;"><strong>...</strong></p>` — bold, body-size

**Tagline:** regular `<p>` — no bold, body-size

**Section headings (e.g. "Promotion Details", "Terms and Conditions"):** `<p style="margin: 18pt 0 12pt 0;"><strong>...</strong></p>` — bold, body-size

**T&C section heading — hyperlink for QPRO + QP2 brands** (added 2026-05-17):
The "Terms and Conditions" heading (translated) must be hyperlinked to the brand's T&C page in the target translation language when the brand is QPRO1–19 or QP2A–D and a URL exists for that brand × language combination. Otherwise emit plain text. Use the table in `references/tnc-links.md` — that file is the authoritative source for which URL to use.

```html
<!-- When a URL exists in tnc-links.md for this brand × target language: -->
<p style="margin: 18pt 0 12pt 0;"><strong><a href="<URL from tnc-links.md>">[Translated T&C heading]</a></strong></p>

<!-- Plain text fallback (no URL, or brand outside QPRO/QP2 scope): -->
<p style="margin: 18pt 0 12pt 0;"><strong>[Translated T&C heading]</strong></p>
```

Do not add inline color — Google Docs applies its default hyperlink style on paste. The hyperlinked text remains bold (the `<strong>` stays).

**Numbered lists:** `<ol style="padding-left: 28pt; margin: 0;">` with `<li style="margin: 6pt 0;">`

**Inline bold:** wrap dates (`<strong>01/06/2026 00:01</strong>`) and emphasis phrases (`<strong>one (1) ticket</strong>`) exactly where source has them.

## Do-Not-Translate List

These ALWAYS stay in English / as-is across every language:

- **Brand names:** MB8, RWS77, BP9, QPRO1–QPRO19, QP2A/B/C/D, IBC22, KING333, ACE66, SPADE66, etc.
- **Game providers:** MICROGAMING, Pragmatic Play, Habanero, Spadegaming, etc.
- **Individual game names:** every slot/casino game title, regardless of how exotic (e.g. `123 Soccer Link & Merge`, `Lucky Twins Wilds Link & Merge`, `Bountiful Birds`)
- **Currency codes:** `MYR`, `SGD`, `USD`, `THB`, `Rp` — never `RM`, `IDR`, `$`, `฿`, `S$`, `US$`, `¥`
- **Currency amounts:** preserve exactly — `MYR 200`, `MYR 1,314,400` — NEVER convert across currencies, even in ID/TH/KM versions
- **Dates:** mirror source format exactly (`01/06/2026 00:01`, `07 June 2026`, `15/07/2026`)
- **Product/luxury names:** Samsung Galaxy Z TriFold, Rolex Oyster Perpetual 41, Daniel Roth Extra Plat, Bang & Olufsen Beoplay H100, iPhone 17 Pro Max, etc.
- **App names:** WhatsApp, Telegram, Live Chat, SMS
- **Template tokens:** `:brandname`, `[BRAND]`, `{merchant}`, etc. — preserve literally; flag in report
- **Game UI identifiers:** `"Alias"` (in quotes) and similar
- **Promo codes** and URLs
- **Email addresses**
- **Account tiers:** `Pro`, `VIP`, etc.

## Per-Language Notes

### ZH (Simplified Chinese — default)
- Full-width punctuation: `，。「」（）：；！？`
- Glossary terms must be used: `流水`, `彩金`, `免费彩金`, `条款与条件`, `合格游戏`, `活动期间`
- Numerals: Arabic in body (`MYR 100`, `15/07/2026`); Chinese in formal expressions like `一（1）张`
- Tagline tone: punchy, slightly literary

### TH (Thai)
- Body line-height should be 1.6 (extra leading for stacked diacritics)
- Glossary terms: `ยอดเทิร์นโอเวอร์`, `เครดิตฟรี`, `ข้อกำหนดและเงื่อนไข`, `เกมที่ร่วมรายการ`, `ระยะเวลาโปรโมชั่น`
- "Live Chat" stays in English
- Use Thai numerals only if source explicitly does — default Arabic

### KM (Khmer)
- Body line-height 1.7 (Khmer needs extra room)
- Font fallback include `'Khmer OS', 'Khmer UI'`
- Glossary is auto-built — terms like `Turnover` stay in English by default until a native-reviewed equivalent lands in the glossary
- Terms & Conditions phrase: `ច្បាប់ និងលក្ខខណ្ឌ` (confirmed 2026-05-17, matches TNC link tab style)
- No QPRO/QP2 brand currently has a KM T&C URL → KM output emits plain-text heading
- Always flag KM output as "provisional — native review recommended" in the final report

### ID (Indonesian)
- iGaming convention: `Turnover`, `Multiplier`, `Free Spin` often kept in English even in Indonesian copy. Default to keeping these in English unless glossary says otherwise.
- Glossary is auto-built — flag every auto-add for review
- `Syarat dan Ketentuan` for T&C; `Kredit Gratis` for free credit; `Periode Promo` for promo period

### BM (Bahasa Malaysia / Malay)
- Glossary terms: `Turnover` (kept EN), `Kredit Percuma`, `Terma & Syarat`, `Permainan Layak`, `Tempoh Promosi`
- Most iGaming jargon kept in English

## Edge Cases

- **`:brandname` placeholder in source:** preserve literally in all translations. Flag in report: "Source uses `:brandname` placeholder — confirm whether to substitute the actual brand."
- **Source has placeholder tokens, real brand only in title:** mirror exactly — don't auto-substitute. Surface to user.
- **Source has mixed-language sections (e.g. English heading + translated body):** treat as styling decision; preserve as-is in output and flag.
- **User requests fewer or more languages than usual:** produce exactly what was asked; never volunteer extras.
- **User pastes source without a link:** work from the paste; skip Drive fetch.
- **Source content longer than usual (e.g. tournament tables, leaderboards):** structure follows same template — multiple tables/sections fine. Apply same rules per-table.
- **User asks for one language out of many that the source supports:** produce just that one. Single file, single language.
