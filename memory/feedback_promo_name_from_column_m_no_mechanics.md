---
name: Promotion name follows column M descriptor, strip mechanics
description: promotion_name_* comes from the descriptive phrase in column M (name_details_raw) with mechanics removed
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
The customer-facing `promotion_name_en` / `promotion_name_zh_*` / `promotion_name_zh_id` etc. must follow what the operator wrote in column M (`name_details_raw`) — but strip all promo-mechanic values: Min Dep / Min Deposit, T.O. / TO / TOx, Max Cap / Max Bonus, max bns, currency-amounts (RM xxx / S$ xxx / Rp xxx).

Keep the descriptive phrase: percentage rate, promo category words (reload / comeback / welcome / new player / etc.), and game category words if they're part of the name (not when they're listed under "Game:" or "Game Categories:" — those are routing, not the name).

**Why:** Jascinta 2026-05-20: operators encode the promo identity in column M's lead phrase. Names should match what the operator wrote, not what the auto-namer guesses from bonus_type alone.

**How to apply:**
- Take the first phrase before `/` or newline in column M.
- Strip mechanic tokens: `min dep <amt>`, `min depo <amt>`, `T.O. <n>x`, `TO <n>x`, `TOx<n>`, `max cap <amt>`, `max bonus <amt>`, `max bns <amt>`, `RM<amt>`, `S$<amt>`, `Rp<amt>`.
- Title-case the remainder, keep `%` attached to its number.
- ALWAYS append "Bonus" suffix to the EN name (and the matching "奖励" / "Bonus" suffix in ZH/locale variants).
- Remark-stated prefixes (VIP, GLD, etc.) DO carry into the name when the operator explicitly wrote them. Order: `[<PREFIX>] <column-M descriptor> Bonus`. Per operator 2026-05-20: remark-stated prefix rule has priority over the "strip from column M" rule.
- DO NOT include `min_deposit` (already covered by feedback_min_deposit_not_in_name.md).
- ZH/ID translations follow the same descriptor minus mechanics, transliterated per existing convention.

**Examples (P085–P090, WS1/MB8):**
- "18% reload" → EN "18% Reload Bonus" / ZH "18% 充值奖励"
- "20% comeback reload" → EN "20% Comeback Reload Bonus" / ZH "20% 回归充值奖励"

**Examples (P075–P084, VIP):**
- Remark "Add VIP to code prefix" + column M "Deposit bonus 100%/ max bonus 500/ min depo 1000/ TOx8\n\nGame : Slots/Fishing reload" → EN "VIP 100% Reload Bonus" / ZH "VIP 100% 充值奖励". Remark-stated VIP carries into the name; column M's "Deposit bonus" descriptor reduces to "Reload Bonus" because the game-line says "reload" (the operative type) — VIP + rate + type + Bonus suffix.

**ZH glossary additions (operator-confirmed 2026-05-20):**
- "Comeback" → 回归
- "Reload" → 充值
- "Comeback Reload Bonus" → 回归充值奖励
- "Bonus" → 奖励

Counter-rule: if column M is blank or contains only mechanics (e.g. "100%/500/1000/TOx8"), fall back to the auto-namer's bonus-type-derived name.
