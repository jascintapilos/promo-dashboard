---
name: Message template — Max Bonus column + "Exclusive Offer" subject
description: Promo Details table shows Min Deposit + Max Bonus (not % rate); subject is just "Exclusive Offer" / "独家优惠"
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
In the inbox Message Template (Section 6.6 on QP2 / 6.x on QPRO):

1. **Subject:** "Exclusive Offer" (EN) / "独家优惠" (ZH) — NOT the longer "<pct>% Reload Bonus - Exclusive Offer" the renderer produced before.
2. **Promo Details table:** 2 columns = Min Deposit + Max Bonus.
   - Column 2 header: "Max Bonus" (EN) / "最高红利金额" (ZH). NOT "Bonus Percentage" / "奖励".
   - Column 2 value: `<currency> <max_bonus>` (e.g. "MYR 500"). NOT the percentage.
   - Column 1 value: `<currency> <min_deposit>` with per-locale currency (RM for MY, S$ for SG, etc.).
3. **Bonus Condition Example calculation block** (updated 2026-05-20): drop the `%` label entirely. Use `max_bonus` (the cap, in dollars) as the bonus amount. Recompute total and turnover from there.
   - `Bonus amount = <ccy> <max_bonus>` (e.g. "Bonus amount = MYR 500"). NOT "Bonus amount (100%) = MYR 1,000".
   - `Total received amount [<ccy> <min_dep> + <ccy> <max_bonus>] = <ccy> <total>`
   - `Turnover requirement [<ccy> <total> x <to>] = <ccy> <tov_req>`
   - Per-locale currency in every line (RM for MY, S$ for SG).
   - ZH labels: 奖金 / 存款 + 奖金 / 流水量需求 (header stays 奖金计算示例).
4. T&C items unchanged (still mention `Max bonus for this promotion is <currency> <max_bonus>` etc.).

**Why:** Jascinta 2026-05-20: the table headline value should be the cap (max bonus in dollars), not the rate percentage. Operators read this table at a glance to confirm the cap.

**How to apply:**
- In `src/message-template-renderer.js`, update the Deposit/Reload body so the second `<th>` says "Max Bonus" / "最高红利金额" and the cell shows `<ccy> <maxBonus>`.
- Subject line: drop the `${pct}% Reload Bonus -` prefix; render only "Exclusive Offer" / "独家优惠".
- Apply per-locale currency in the table values (existing locale → ccy resolver already in the renderer).
- Patch script `bin/_fix-msg-template-content.mjs` retroactively updated the 32 P075-P096 templates already on QPRO4 + QP2C. Same pattern is reusable for future retroactive sweeps.

**Counter-rule for FS / FC:** Free Spin and Free Credit templates use a different table shape (game name + free-spin count, or free-credit amount + TO multiplier). Don't apply this Deposit/Reload patch to those.
