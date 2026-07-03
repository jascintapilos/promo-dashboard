---
name: feedback-qp2-conditions-divergence
description: "QP2 bonus-condition checkboxes where the bot's api-mapper diverges from operator-saved reference promos — Auto Reward Activation + Free Spin Check should likely be ON, not OFF."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9261e5d7-0ac9-4bc6-801a-3f4ca8df2ed2
---

While building a QP2 "what-to-tick" reference (2026-06-05), probing real operator-saved QP2 reference promos in `captures/probe-fc-fs/ibc22-RAW-*.json` against `src/api-mapper-qp2.js` surfaced **two checkbox divergences**:

1. **Auto Reward Activation (`auto_reward_activation`)** — operator refs (FC `VM_FC_1088_5X`, FS `FT_DOUDLEDATE_JUNE_250FS`) save it **=1 (ON)**. The api-mapper hardcodes **0 (OFF)**. Already remediated post-save by `bin/set-auto-reward-api.mjs` + `bin/tick-auto-reward.js` (target list `captures/auto-reward-off.json`, created_by==='promo_testbot'). → **Supposed to be ON.** Mapper is the lagging source; fixing `buildPromotionBody`/`buildUpdateBody` to `auto_reward_activation: 1` would remove the post-hoc fix step.

2. **Free Spin Check (`freespin_check`)** — operator refs show **=1 (ON) on BOTH FC and FS**. api-mapper hardcodes **0**; `bo-mapper-qp2.js` (UI path) sets it `=isFs` (ON for FS only). Three sources, three answers — **needs a live QP2A Create-Promotion probe to settle** before changing the mapper.

Empirical split across captures: `freespin_check` 174×0 / 18×1 (the 1s are operator manual saves; 0s are bot dry-runs/run-logs).

**Confirmed MATCHING (bot == operator):** allow_deposit=0, allow_continuous_claim=0, allow_cancel=0, withdrawal_unlock=0, fingerprint_check=0, members_only=0, auto_approve=1, auto_unlock=1.

**Why:** "what is supposed to be selected" for QP2 conditions depends on operator practice, not just the mapper — the mapper is wrong on at least one (auto_reward) and unverified on another (freespin_check).

**How to apply:** When asked about QP2 conditions-to-tick, surface these two as ❓. Don't assert the mapper values as "correct" for these two fields. Relates to [[feedback_qp2d_allow_deposit_off]], [[feedback_blacklist_template_before_create]], [[project_handover_state_2026-05-27]].
