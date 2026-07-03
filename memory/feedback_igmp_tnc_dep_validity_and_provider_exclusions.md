---
name: IGMP Deposit T&C — use rewards_validity_days + add provider exclusions to point 3
description: WS1/MB8 Deposit-bonus T&C list has two bugs in src/igmp-tnc.js — point 1 reads wrong field, point 3 missing MEGA888/Habanero/King Midas/Allbet exclusion clause
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
Operator amended the bot-generated T&C on P085–P090 (WS1 / MB8 / IGMP, Comeback Rush) on 2026-05-21. Two specific issues to fix.

### Issue 1 — point 1 validity day count reads the wrong field

Current behavior (`src/igmp-tnc.js:101`, `:127`):
```js
const days = Number(rec.validity_days ?? 1);
```
Then line 113 (EN) / line 139 (ZH):
```
1. Bonuses are valid for ${days} day(s) upon issuance unless stated otherwise.
1. 红利自发放之日起有效期为 ${days} 天，除非另有说明。
```

Bug: `validity_days` is the promo-availability window (how many days the promo code is claimable). The line is about the BONUS lifetime once issued — that is `rewards_validity_days` on the request record. Must switch to `rec.rewards_validity_days ?? rec.parsed?.rewards_validity_days ?? rec.validity_days ?? <fallback>`.

Same fix applies in **all four IGMP T&C generators** in `src/igmp-tnc.js`:
- `buildDepEn`, `buildDepZh` (Deposit)
- `buildFcEn`, `buildFcZh` (Free Credit)
- (and FS variants if present)

### Issue 2 — point 3 needs provider-exclusion clause

Current line 115 (EN) / line 141 (ZH):
```
3. This promotion is valid across all game categories (excluding Blackjack and Virtual Sports).
3. 本次促销活动适用于所有游戏类别（不包括二十一点和虚拟体育）。
```

Operator-edited live shape (per 2026-05-21 screenshot from P085–P090):
```
3. This promotion is valid across all game categories (excluding Blackjack and Virtual Sports). Please note that all games under provider MEGA888, Habanero, King Midas, and Allbet are entirely excluded from this promotion.
```

The added sentence lists **brand-side excluded providers** on MB8/WS1. List as of 2026-05-21: **MEGA888, Habanero, King Midas, Allbet**.

ZH equivalent (to be confirmed with operator if differs from this guess):
```
3. 本次促销活动适用于所有游戏类别（不包括二十一点和虚拟体育）。请注意，本促销不适用于 MEGA888、Habanero、King Midas 和 Allbet 提供商旗下的所有游戏。
```

### How to apply

1. Patch `src/igmp-tnc.js`:
   - Switch `days` calculation to prefer `rewards_validity_days`.
   - Append the provider-exclusion sentence after the existing category-exclusion clause in point 3. Keep both clauses on the same numbered item.
   - The provider list should be a constant (e.g. `const IGMP_EXCLUDED_PROVIDERS = ['MEGA888', 'Habanero', 'King Midas', 'Allbet']`) so it's easy to update when the brand changes the list.

2. The operator's amended list (provider-exclusions) may vary by promo type or brand — confirm before broadening:
   - Applies to MB8 (WS1 MY/SG/ID/TH/KH) — verified on 2026-05-21 from a SG Comeback Rush screenshot.
   - WS2 (RWS77) may use a different provider exclusion list.
   - QPRO/QP2 T&C uses an entirely different template (8-item shape) and is NOT affected by this fix.

### Retroactive: do I patch P085–P090?

The operator already manually amended the live IGMP saves for P085–P090. Don't re-PUT those unless the operator asks — they took the manual edit and likely don't want it overwritten. The fix in `src/igmp-tnc.js` is for **next batch**.

### Related rules

- [Feedback — promo template / inbox copy rules](feedback_promo_template_copy_rules.md) — covers FC inbox conventions; doesn't address the validity-days field bug.
- [Feedback — Free Credit inbox template rules](feedback_promo_fc_inbox_rules.md) — same.
- [Session 2026-05-20 — iGMP T&C auto-gen + FS catalog probe](session_2026-05-20_igmp_tnc_and_fs_catalog.md) — `igmp-tnc.js` introduction. Validity-field bug was present at introduction.
