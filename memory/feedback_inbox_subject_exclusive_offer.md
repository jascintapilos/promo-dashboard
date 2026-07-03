---
name: Deposit inbox — subject is "Exclusive Offer"; body table = Min Deposit + Max Bonus
description: Deposit Bonus inbox template subject is plain "Exclusive Offer" / "独家优惠" / "Penawaran Eksklusif". Body table shows Min Deposit + Max Bonus (currency amounts), NOT the bonus percentage.
type: feedback
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
Operator rule (2026-05-20) for Deposit Bonus inbox/message templates:

| Field | Old | New |
|---|---|---|
| Subject EN | `{{bonus_pct}}% {{bonus_sub_type}} Bonus - Exclusive Offer` | `Exclusive Offer` |
| Subject ZH | `{{bonus_pct}}% {{bonus_sub_type_zh}} - 独家优惠` | `独家优惠` |
| Subject ID | `{{bonus_pct}}% Bonus {{bonus_sub_type}}` | `Penawaran Eksklusif` |
| Body table col 2 header | "Bonus Percentage" / 奖励 / "Persentase Bonus" | "Max Bonus" / 最高奖金 / "Bonus Maksimum" |
| Body table col 2 value | `{{bonus_pct}}%` | `{{currency_symbol}} {{max_bonus}}` |
| Bonus Condition Example bullet 2 | `Bonus amount ({{bonus_pct}}%) = {{currency_symbol}} {{bonus_amount_example}}` | `Bonus amount = {{currency_symbol}} {{max_bonus}}` |
| Example bullets 3+4 | computed from `min_dep * pct / 100` | computed from `max_bonus` (capped value) |

**Why:** Operator preferred showing the actual reward amount (the realized cap) over the percentage. Old percentage-derived `bonus_amount_example = min_dep * pct / 100` could exceed `max_bonus` (e.g. P091: 3000 × 30% = 900 vs max_bonus = 600) — misleading. New rule uses `max_bonus` directly, and downstream calculations (Total received, Turnover requirement) use the capped value. P091-P096 saves had the old form; 24 template-detail rows updated via `bin/fix-p091-p096-message-template.mjs` (ran twice — first pass for subject + table, second for Bonus Condition Example).

**How to apply:** SUBJECT_TEMPLATES in `src/message-template-renderer.js` (deposit slug) now hardcodes "Exclusive Offer" per locale. The three deposit body files (`src/message-template-bodies/deposit/{EN,ZH,ID}.html`) swap the bonus-percentage column for `{{currency_symbol}} {{max_bonus}}`. The "Bonus Condition Example" bullet list still uses percentages to show the math — operator didn't ask to change that, only the table.

**API gotcha — PUT shape for messagetemplate:**
```
PUT /api/bo/messagetemplate/{id}
{
  name, section, type, status,
  code?,                      // QPRO accepts; QP2 rejects with "code already taken"
  details: {                  // numeric-string-keyed by settings_locale_id
    "<locale_id>": { settings_locale_id, subject, message },
    ...
  }
}
```
Probed 2026-05-20. Different from popups (which use a flat `contents` array). Omit `code` on QP2; include on QPRO. `details` must be an object, not an array (array form returns 200 but ignores the body).
