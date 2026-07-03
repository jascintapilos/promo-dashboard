---
name: Dialog Popup defaults (QP2 + QPRO)
description: Operator-confirmed defaults for the canary's Dialog Popup auto-create flow on Section 15.1.2 (QP2) / 14.1.2 (QPRO). Used when a promo request has `popup_dialog: true`.
type: feedback
originSessionId: bdcf6e25-b81a-451e-9f65-d950b7db70f8
---
Confirmed 2026-05-15. The canary should auto-create a Dialog Popup entry for any promo request where `popup_dialog: true`, then link it on the promo code's Edit modal.

## Workflow

1. Navigate to `/settings/dialog` (same URL on both QP2 and QPRO).
2. On QP2: switch to the merchant tab matching the promo's brand (IBC22 / KING333 / ACE66 / SPADE66). QPRO has no merchant tabs (one BO per brand).
3. **Click "+ Create New Content"** button (above the list). The top-bar "Duplicate" button is NOT available for Dialog Popups — use Create instead.
4. Fill the form (defaults below).
5. Submit → BO returns a 5-letter random Code.
6. Navigate back to the promo code's Edit modal → pick the Code in the "Dialog Popup" kt-dropdown (parallel to Message Template link).

## Form defaults (operator-confirmed)

**Form-wide scalars:**
- `Platform` = All
- `Location` = All
- `Start Date` = now (same convention as Valid From on the promo code form)
- `End Date` = (empty / open-ended) — **intentional**, confirmed operator preference 2026-05-26 (P106-P115 batch QC). Popup runs until operator manually deactivates; do not auto-derive from promo end_date.
- `Position` = **99** (fixed for all bonus types)
- `Session` = **After Login** (fixed)
- `Always Pop` = OFF
- `Affiliates Visibility` = OFF

**Per-locale repeating block** (loop through each tab that matches a request locale):
- `Media Type` = (leave default — operator confirmed **no media needed**; bot doesn't upload any image/video)
- `CTA Button Type` = **DUAL**
- `CTA Button Text` = **LOCALIZED PER LOCALE** (operator practice confirmed 2026-05-15 via probe):

| Locale | CTA Left (Text) | CTA Right (Text) |
|---|---|---|
| `*_EN` (MY_EN, SG_EN, ID_EN, US_EN) | **CLAIM NOW** | **READ MORE** |
| `*_ZH` (MY_ZH, SG_ZH) | **立即领取** | **阅读更多** |
| `ID_ID` | **Klaim Sekarang** | **Info Lanjut** |
| `TH_*` (when authored) | TBC | TBC |

- `CTA Button Link (Left)` = **branches on `min_deposit`**:
  - `min_deposit > 0` (Deposit / Cashback / FS-with-transfer) → **`/member/deposit`** (operator practice)
  - `min_deposit == 0` (FC, no-deposit FS) → **`/member/reward`** (FC claim mechanic)
- `CTA Button Link (Right)` = **`/member/message`** (uniform)
- `Title` = **`"CONGRATULATIONS, YOU HAVE [X] [BONUS_TYPE]!"`** style exclamation, NOT the bare `promotion_name_en` (corrected 2026-05-26 via QC on P106 / P108 FS popups). Examples confirmed in production:
  - FS: `"CONGRATULATIONS, YOU HAVE 28 FREE SPINS!"` / `"恭喜您，您获得了28次免费旋转！"`
  - Same exclamation format applies to FC, Deposit, etc. — operator confirmed keep this convention across all bonus types.
- `Content` = **Short promotional teaser per bonus type per locale** — NOT the full Message Template T&C body. Operator's real bodies are ~150-200 chars EN, ~80-130 chars ZH. Bot needs authored teaser bodies (separate from Message Template bodies) at `src/dialog-popup-bodies/{bonus_type}/{locale}.html`.

For FS-themed promos specifically, the "Left" CTA text variant may be **"SPIN NOW" / "立即旋转"** instead of "CLAIM NOW" / "立即领取" — operator preference (seen in Double 6.6 promo).

## Linking to the promo code

After Submit, the bot reads back the new 5-letter Code from the saved row OR from the API response. Then on the Edit modal:
- Find the `Dialog Popup` kt-dropdown trigger (parallel to the `Message` kt-dropdown).
- Open it and pick the option whose label contains the new Code.

The kt-dropdown picker pattern is the same as the existing Message Template link.

## Skip when

- `popup_dialog: false` in the request → mapper should NOT push `dialog_popup_create`. Most current promo requests have this false.
- `formSaveSucceeded === false` (main form failed) → skip Dialog Popup phase, same gate as Message Template phase.

## Open questions (not blocking)

- What if the request has TH locale? Currently TH bodies aren't authored; bot skips TH tabs for Message Template. Same behavior expected here.
- Media Type radio — `IMAGE` vs `VIDEO`. Form may auto-default to one. If Submit fails because Media is required and empty, bot may need to pick `IMAGE` explicitly without uploading (and accept whatever the BO defaults the file fields to).
- Position 99 — does this affect display order? If multiple Dialog Popups have position 99, what's the tiebreaker?
