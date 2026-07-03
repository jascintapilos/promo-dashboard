---
name: QP2 promotions share a code across merchants via merchant_ids
description: On ibc22 (QP2A/B/C/D), do NOT use 4 different codes for the same promo. Create the code on one merchant, then ADD the other merchants to that promotion's merchant_ids. Dialog popups: duplicate via the BO's Duplicate button (or extend merchant scope).
type: feedback
originSessionId: 72c541b7-856b-4f42-922a-ad9a49ab99db
---
For QP2 promos that target multiple of QP2A/B/C/D with identical config, the BO supports ONE promotion code attached to multiple merchants via `merchant_ids`. This is the correct pattern — NOT creating 4 separate codes with suffixes (`_QP2A`, `_QP2B`, etc).

**Why:** ibc22 enforces global code uniqueness across QP2A/B/C/D. Operator's intent for a multi-merchant promo is one code, four merchant attachments. The earlier idempotency-skip behavior in `canary-api-qp2.js` (skip when code exists globally) treats this as a collision, but the correct response is to ADD the new merchant to the existing promo. Per Jascinta 2026-05-16: "QP2B/C/D can always share a code with QP2A on ibc22."

**How to apply:**
- In the QP2 canary flow, when an existing promo with the same code is found on ibc22 and the request's brand isn't already in its `merchant_ids`, do a PUT to APPEND the new brand's merchant_id (not a 4th create).
- **Dialog popup is per-merchant on QP2.** Verified 2026-05-16: popups carry a `site_id` field that maps 1:1 to merchant id (1=IBC22, 2=KING333, 3=ACE66, 4=SPADE66). A popup with site_id=1 only renders on QP2A's player UI — it does NOT propagate to the other merchants even when the promo's merchant_ids is extended. The BO UI's "Duplicate" button is the operator's manual equivalent.
- **API equivalent:** for QP2B/C/D, POST a new popup with the same body but `site_id` set to the target merchant's id, then PUT the promo with `dialog_popup_list` containing ALL the popup rows (one per merchant). The PUT shape expects the FULL popup row (`{ ...popupFullRow, promotion_id }`), NOT the join-table row — passing a join row corrupts `popup_id` to point to the join-id itself.
- **Member groups are ALSO per-merchant.** Each merchant has its own ~29 groups partitioned by `site_id`. The promotion's `member_group_ids` lists eligible tiers; without extending it to include each new merchant's groups, those merchants' players can't claim the promo even though they're in `merchant_ids`. `resolveQp2MemberGroupIds(site, merchantIds)` in `src/api-mapper-qp2.js` resolves the eligible name-set (Normal, Bronze/Silver/Gold/Platinum 1–3, Diamond + their Trial variants + PRO-GOLDVIP + PRO-PLATINUM-VIP) across the given merchants. Excludes `*Shadowban` and the Diamond 2/3 tiers (operator's QP2A pattern as of 2026-05-15). Case-insensitive — QP2A names use Mixed Case, B/C/D use UPPERCASE.
- **`QP2_BRAND_TO_IDS` in `src/api-mapper-qp2.js`** must give each brand its correct siteId (=merchantId). Earlier the map had `siteId: 1` for all four — silent bug because popups looked correct in QP2A's view but were invisible on B/C/D.
- **Verify endpoint for site_id ↔ merchant mapping:** `GET /api/bo/merchantsites` on ibc22 returns the 4 rows `{id, name, prefix}` — site_id IS this `id`.
- Message templates remain merchant-agnostic (one template_id, one shared body) — no per-merchant duplication.
- The multi-brand orchestrator treats QP2B/C/D as "extend the QP2A promo + clone popup per merchant + expand member_group_ids", not "create a new promo".
