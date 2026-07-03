---
name: feedback-qc-all-platforms-regions-after-every-code-creation
description: "After any promo save, automatically QC BO config, MT, SMS/WS1 reward T&C, and Dialog for EVERY brand and region in the request — no reminder needed."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39cc7bb6-4a30-4216-9730-1f49e46c330b
---

## Rule

After every promo save (QPRO, QP2, WS1/IGMP), proactively QC each saved record against the **request template (fixture/sheet row)** — field by field — for every brand and region in the request. Do not wait for the operator to ask.

**QC = compare BO live state against request template values, not just existence checks.**

### 1. BO Configuration — match fixture fields

Pull the live promo record and verify each field against the fixture:

| Field | Source in fixture |
|---|---|
| `bonus_type` / `promo_type` | `bonus_type` |
| `promo_code` | `promo_code` (per brand) |
| `promotion_name` (all locales) | `promotion_name_en` / `promotion_name_zh_id` |
| `min_deposit` | `parsed.min_deposit` (per currency override if present) |
| `bonus_rate_pct` | `parsed.bonus_rate_pct` |
| `max_bonus` | `parsed.max_bonus` |
| `to_multiplier` | `parsed.to_multiplier` |
| `game_categories` | `categories_only` or default All |
| `member_group_ids` | `tier_constraint` (QP2 only; QPRO always []) |
| `currencies` | `currencies` list (per brand) |
| `valid_from` / `start_date` | UTC now at save time |
| `deposit_status` | min_deposit>0 → Last Deposit (2); =0 → None (1) — QP2 only |
| `allow_deposit` | always OFF on QP2 |
| `reset_frequency` | from fixture |
| `max_per_player` / `daily_max` | col T |

### 2. Message Template (MT) — match Column N + fixture

- Subject: matches expected pattern (streak phrase / promo name)
- Body: contains all Column N required content verbatim (streak phrase, congratulations text, Pick Your Boost option labels, Loss Rescue mechanics, etc.)
- T&C hyperlink: QPRO brand-specific `<a href>`; QP2 `:url/terms-conditions` placeholder
- All expected locales present (MY_EN, MY_ZH, SG_EN/ZH if SG in scope)
- `max_bonus`, `to_multiplier`, `min_deposit` values in body match fixture (not generic)

### 3. WS1 Reward Tab T&C — match Column N

- `PromotionRewardContents` EN+ZH on both ws1-v3-my and ws1-v3-sg
- Injected content matches Column N requirement (streak note / congrats paragraph / Pick Your Boost table + clauses)
- Currency amounts use correct symbol (RM/MYR for MY, SGD for SG)
- Per-currency min_deposit used correctly (e.g. P112: MYR 30 MY, SGD 50 SG)

### 4. Dialog Popup — match fixture

- `popup_dialog: true` in fixture → popup exists and is linked
- Position correct (in-house→1/2, PP→3/4, others→5)
- CTA: min_deposit>0 → DEPOSIT + /member/deposit; else → CLAIM NOW + /member/reward
- Title = `promotion_name` for each locale
- All locales present

### Platform coverage (all, every time)

- **QP2A**: IBC22 (+ QP2B/C/D if brands extend via merchant_ids)
- **QPRO**: every brand in `brands[]` array — QPRO2, QPRO6, QPRO8, etc.
- **WS1**: ws1-v3-my AND ws1-v3-sg for any promo with `platforms` including `igmp`

**Do not skip WS1.** P106–P115 showed WS1 reward T&C was missed entirely until explicitly flagged.

### Output format

Present QC results as a summary table (one row per brand × region) showing ✅/❌ per check dimension, with specific field mismatches called out for any ❌.
