---
name: Dialog popup CTA labels must match link target
description: "CLAIM NOW" → /member/reward; "DEPOSIT" → /member/deposit. Never mix label/link.
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
The dialog popup left-CTA button label must agree with its link target:

| Label (EN) | Label (ZH) | Link            | When to use |
|------------|-----------|-----------------|--------------|
| CLAIM NOW  | 立即领取   | /member/reward  | Reward auto-credited — Free Credit, Free Spin, no-deposit-required promos |
| DEPOSIT    | 立即存款   | /member/deposit | User must deposit to claim — Deposit / Reload / Welcome / Cashback bonuses |

Right-CTA stays:
- EN: "READ MORE" → /member/message
- ZH: "阅读更多" → /member/message

**Why:** Jascinta 2026-05-20: the button label has to tell the user what action will happen next. "CLAIM NOW" → /member/deposit is misleading (it routes to the deposit page, not a claim). For Deposit-style promos the button must say "DEPOSIT".

**How to apply:**
- In `src/api-mapper-qpro.js:buildDialogPopupBody` and `src/api-mapper-qp2.js:buildDialogPopupBody`, derive label from bonus_type + min_deposit:
  - If `bonus_type` includes "deposit" / "reload" / "welcome" / "cashback" → label = "DEPOSIT" / "立即存款", link = /member/deposit
  - Otherwise (Free Credit, Free Spin, no min_deposit) → label = "CLAIM NOW" / "立即领取", link = /member/reward
- Right-CTA stays "READ MORE" / "阅读更多" → /member/message regardless.

**Past slip (corrected 2026-05-20):** P075-P096 popups initially saved with "CLAIM NOW" labels but `/member/deposit` links — operator caught the mismatch and asked for fix.
