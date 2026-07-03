---
name: Dialog popup CTA — left button text must match link
description: Left CTA button text and link are paired. CLAIM NOW ↔ /member/reward; DEPOSIT ↔ /member/deposit. Switch text AND link together based on min_deposit, not just the link.
type: feedback
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
Pairing rule (operator 2026-05-20):

| Button text (EN / ZH / ID)            | Link               | When |
|---|---|---|
| CLAIM NOW / 立即领取 / Klaim Sekarang | `/member/reward`   | `min_deposit == 0` (Free Credit, Free Spin, deposit promos with no min) |
| DEPOSIT / 存款 / Deposit               | `/member/deposit`  | `min_deposit > 0` (Reload, Welcome, any deposit-required promo) |

Right button stays "READ MORE" / 阅读更多 / "Info Lanjut" → `/member/message` (always).

**Why:** P091-P096 (2026-05-20) all saved with `text_1="CLAIM NOW"` but `link_1="/member/deposit"` — the mapper was switching the link by `min_deposit` but leaving the text fixed at "CLAIM NOW". Operator flagged the mismatch. Twelve live popups patched after the fact via `bin/fix-p091-p096-cta-button.mjs`. Both QP2 and QPRO mappers updated to switch text + link as a pair.

**How to apply:** When writing or reviewing dialog popup CTA code, treat `cta_button_text_1` and `cta_button_link_1` as a single unit. The locale dictionary now exposes both `claim` and `deposit` text variants per locale; `useDeposit = (min_deposit > 0)` picks the right pair. ID locale uses English "Deposit" (per operator preference 2026-05-20).
