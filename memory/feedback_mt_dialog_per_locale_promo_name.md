---
name: feedback_mt_dialog_per_locale_promo_name
description: "MT body reward-name + dialog body promo-name must use the per-locale configured promo name (ZH/ID → zh_id name), not the EN name or the email subject."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e8cf9e51-b075-4665-98f4-d4120d149bd7
---

In MT + dialog bodies, the ZH (and ID) locale must reference the **configured per-locale promo name**, not the EN name and not the campaign email subject.

Two bugs fixed 2026-06-15 in `src/message-template-renderer.js`:

1. **MT FC body `[{{reward_name}}]`** (the name the player searches for on the [Reward] page) was set to `subject`. Once campaign-themed subjects (World Cup etc.) diverged from the promo name, this mismatched the actual reward name. Fix: `vars.reward_name = promotionNameLocalized` (EN → `promotion_name_en`; ZH/ID → `promotion_name_zh_id`).

2. **Deposit dialog body + Free-Spin MT body** hard-referenced `{{promotion_name_en}}` for all locales → ZH showed the EN name. Fix: added a per-locale `{{promotion_name}}` var in both `renderBody` + `renderDialogBody`, and switched these template files to `{{promotion_name}}`: `dialog-popup-bodies/deposit/{EN,ZH}.html`, `message-template-bodies/free-spin/{EN,ZH,ID}.html`.

**Why:** Player-facing reward/promo references must match the actual BO record name per locale, else the player can't find the reward.

**How to apply:** Resolve `promotionNameLocalized = (docKey==='ZH'||docKey==='ID') ? (promotion_name_zh_id || promotion_name_zh || promotion_name_en) : promotion_name_en`. Dialog title was already per-locale via the mapper; only body content + FC reward-name needed fixing. Note: dialog *title* comes from `buildDialogPopupBody`, body content comes from the rendered template — both must be localized. See [[project_handover_state_2026-06-08]], [[feedback_qpro_name_from_column_m]].

**Campaign intro injection (single intro line):** When `generateCopy` returns an `mt.intro`, the renderer injects it as the body's single opening paragraph. Free-credit + free-spin bodies ALREADY open with a plain intro line ("Congratulations! You have been rewarded..." / "As a reward for joining us..."), so the intro must REPLACE that leading `<p>` — NOT prepend (which renders two intro lines). Deposit body opens with a `<p><strong>Promo Details:</strong></p>` header, so the intro is prepended there. Rule: replace the first `<p>…</p>` iff its inner content does NOT start with `<strong>`; else prepend. **QC bodies line-by-line top-to-bottom, not just by field pattern-match** — field-only QC missed the duplicate intro.
