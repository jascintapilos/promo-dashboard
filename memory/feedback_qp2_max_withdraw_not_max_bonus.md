---
name: QP2 max_withdraw ≠ max_bonus
description: On QP2 promotion_currency, max_withdraw is a SEPARATE field from max_bonus — never copy one to the other. max_withdraw defaults to null (Unlimited) unless the request specifies a withdrawal cap.
type: feedback
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
`max_bonus` is the bonus cap (how much bonus a player can earn). `max_withdraw` is the withdrawal ceiling (how much they can cash out). They are unrelated on QP2 promotion_currency rows.

**Why:** P091-P096 (2026-05-20) saved with `max_withdraw=max_bonus` because `src/api-mapper-qp2.js:363` defaulted `max_withdraw` to `o.max_bonus ?? r.max_bonus ?? 0`. Operator flagged the conflation — the QP2 BO interprets a non-null `max_withdraw` as a Fixed Amount cap, which is wrong by default. Twelve rows patched after the fact via `bin/fix-p091-p096-max-withdraw.mjs`; mapper changed to `o.max_withdraw ?? r.max_withdraw ?? null`.

**How to apply:** When writing or reviewing QP2 mapper code, treat `max_withdraw` like `max_total_*` — null = Unlimited (matches BO blank-field rendering, see [feedback_qp2_max_total_unlimited.md](feedback_qp2_max_total_unlimited.md)). Only set a numeric `max_withdraw` if the request explicitly states a withdrawal cap (`parsed.max_withdraw` or `per_currency_overrides[cur].max_withdraw`). QPRO has a separate `max_transfer_out` field, not affected by this rule.
