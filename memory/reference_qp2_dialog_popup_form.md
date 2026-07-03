---
name: QP2 Dialog Popup — page structure (15.1.2 Dialog)
description: Reference for the QP2 BO Dialog Popup management page at /settings/dialog. Used to build the canary's Dialog auto-create + link flow (parallel to the Message Template 6.6 flow).
type: reference
originSessionId: bdcf6e25-b81a-451e-9f65-d950b7db70f8
---
## Page

- **URL:** `https://{merchant}.qtp777.com/settings/dialog`
- **Sidebar path:** 15. CMS Settings → 15.1 Announcements → 15.1.2 Dialog Popup
- **Per-merchant tabs at top:** IBC22 / KING333 / ACE66 / SPADE66 (the list scopes to the active merchant)

## List columns

`(checkbox) | ID | LOCALE | CODE | DESKTOP | MOBILE | PLATFORM | TITLE | SESSION | POSITION | START DATE | END DATE | STATUS | ACTIONS`

- `ID` — numeric primary key (e.g. 1061)
- `CODE` — 5-letter random code (e.g. `OVKTY`, `P5PVJ`, `UM2ZF`)
- `LOCALE` — comma-joined list (e.g. `MY_EN, MY_ZH, SG_EN, SG_ZH`)
- `DESKTOP / MOBILE` — image thumbnail per locale
- `TITLE` — human-readable promo title (e.g. "🛍️ Payday Promo 🛍️")
- `SESSION` — when the popup fires (e.g. "After Login")
- `POSITION` — display order (e.g. 99)
- `ACTIONS` — per-row eye/settings/duplicate icons

## Create / Edit / Duplicate form fields

**Top scalars** (form-wide, not per-locale):
- `Platform *` — select (default "All")
- `Location *` — select (default "All")
- `Start Date *` — datetime picker
- `End Date` — datetime picker (optional)
- `Position *` — number
- `Session *` — select ("After Login" is common)
- `Always Pop` — toggle (default OFF)
- `Affiliates Visibility *` — toggle (default OFF)

**Per-locale tabs** (6 visible on QP2: MY_EN, MY_ZH, SG_EN, SG_ZH, ID_EN, ID_ID). Tabs with content have an "X" button next to them; empty tabs don't.

**Per-locale fields:**
- `Media Type` — radio: IMAGE / VIDEO
- (Image upload area when IMAGE is picked — DESKTOP image + MOBILE image, per locale)
- `CTA Button Type` — radio: SINGLE / DUAL
- `CTA Button Text (Left)` — text (e.g. "CLAIM NOW")
- `CTA Button Link (Left)` — text (e.g. `/member/deposit`; helper text lists: external, inbox, deposit, promotion, referral)
- `CTA Button Text (Right)` — text (when DUAL — e.g. "READ MORE")
- `CTA Button Link (Right)` — text (when DUAL — e.g. `/member/message`)
- `Title` — text (e.g. "🛍️ Payday Promo 🛍️"). Usable variables: `:merchantprefix`, `:merchantname`
- `Content` — CKEditor rich text body

## List page workflow

- **Duplicate**: tick row checkbox → click top-bar "Duplicate" button (right side). The button is greyed out until at least one row is selected.
- **+ Create New Content**: prominent button above the rows on the list. Opens a blank create form.
- Per-row icons in ACTIONS column: eye (view?), settings (edit).

## Linking to a promo code

After saving the Dialog Popup, it gets a 5-letter `CODE`. That code goes into the **"Dialog Popup" kt-dropdown** on the promo code's Edit modal (alongside the existing "Message" link for the Message Template).

## Implementation notes for the canary

Workflow parallels Message Template 6.6 but with richer per-locale fields:
1. Navigate to `/settings/dialog`, switch to the right merchant tab (IBC22/KING333/ACE66/SPADE66 — needed unless the active merchant matches the promo's brand).
2. Tick row 0 checkbox + click top-bar "Duplicate" — OR click "+ Create New Content" for from-scratch.
3. Fill top scalars: Position, Session, Start Date (now), End Date (validity_days from now).
4. For each request locale, walk the tab and fill: Media Type=IMAGE (image upload — see below), CTA Button Type=SINGLE (for simplest case) + CTA Button Text/Link, Title, Content.
5. Submit → BO returns new Code.
6. On the promo code Edit modal, pick the Code in the "Dialog Popup" kt-dropdown.

**Image upload is the hard part.** Each locale needs Desktop + Mobile images. Options:
- Duplicate-from-source: source image carries through, bot doesn't re-upload.
- Pre-stage per-bonus-type "donor" Dialog Popup entries that the bot duplicates (operator pre-uploads images once).
- Skip image upload entirely (some entries may show `-` in the list — possibly empty image fields are allowed?).

Open questions (TBC with operator):
- Per-bonus-type CTA defaults? (Deposit → Deposit Now / Read More? FC → Claim Now / Read More? FS similar?)
- Per-bonus-type body content templates? (Same as the inbox Message Template body, or different?)
- Image strategy (duplicate vs. fresh upload vs. skip)
- Default values for Position / Session / Platform / Location / Affiliates Visibility per bonus type.
