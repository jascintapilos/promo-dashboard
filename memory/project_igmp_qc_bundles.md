---
name: project-igmp-qc-bundles
description: WS1/WS2 plan + QC bundles wired into canary-api-igmp.js so Pre-QC and Sentinel can inspect T&C on IGMP saves (closes the category sub-exclusion gap for WS1/WS2).
metadata: 
  node_type: memory
  type: project
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

`canary-api-igmp.js` writes plan + QC bundles in the same shape as canary-api.js / canary-api-qp2.js so the three QC agents work uniformly across QPRO + QP2 + WS1/WS2.

**Plan bundle** (always — dry-run AND commit):
- Path: `captures/qc-plans/<resolvedHandle>__<brand>.json`
- Brand label: `bundleBrand(siteId)` → `WS1_MY`, `WS1_SG`, `WS1_ID`, `WS1_TH`, `WS1_KH`, `WS2`
- `plan.promotion` = main POST body (was `plan.body`)
- `plan.messageTemplate.details["1"]` = EN T&C from `buildTncRow(rec, 'en', bonusType)`
- `plan.messageTemplate.details["2"]` = ZH T&C — only when `siteId ∈ {ws1-v3-my, ws1-v3-sg}` (matches BO's actual locale acceptance)
- `plan.followups` = chained calls (FS reward + locale rows)

**QC bundle** (commit path only, written after activation):
- Path: `captures/qc-bundles/<resolvedHandle>__<brand>.json`
- `live_state.list_row` = `/PM/GetPromotionInfoByCode` response (captured during QC L1)
- `live_state.detail` = `/PM/GetBonusInfo` or `/GetFreeCreditInfo` or `/GetFreeSpinPromotionInfo` (captured during QC L2)
- `live_state.tnc.messages[]` = `{locale, subject, message}` from `/PM/GetPromotionRewardContents` (captured during QC L3)
- `live_state.tnc.checks.sentence_11_has_link` = boolean (true if any row's Content has an `<a href>` wrapping `info-center/tnc`)

**Why:** Before this change, the Pre-QC and Sentinel agents could not read WS1/WS2 T&C at all (no bundle was written). The category sub-exclusion rule added 2026-06-23 (after the P134 LC/Blackjack incident) only fired on QPRO + QP2. Now it fires on all 3 platforms.

**How to apply:** Both fanout scripts (`bin/pre-qc-fanout.mjs`, `bin/qc-fanout.mjs`) glob `captures/qc-{plans,bundles}/<handle>__*.json` so WS1_* and WS2 bundles are picked up automatically alongside QPRO/QP2. No agent or skill changes needed — the criteria rows in [[promo-qc.md]] and [[sentinel.md]] already check `plan.messageTemplate.details["1"].message` and `live_state.tnc.messages`, which now exist for IGMP.

**Edge case:** ZH-locale gate is site-based (`ws1-v3-my` / `ws1-v3-sg` only), NOT record-based (`needsZh(rec)` would return true for any record with MY/SG regions, even when running against a non-ZH site like TH). The site gate matches what the BO actually persists.
