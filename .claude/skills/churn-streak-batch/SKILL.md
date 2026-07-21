---
name: churn-streak-batch
description: Canary + T&C-finish a Churn-Reactivation "Day N streak" promo batch on WS1 (MB8), end to end. Use for Day-4, Day-5 (and beyond) of the CRM Churn - Reactivation campaign — phrasings like "canary the day 4 set", "do day 5", "fire the day 4 churn batch". Each day = a Free Credit block (18FC Silver / 38FC Gold+, ×V1/V2 churn windows) + a Free Spin block (Gates of Olympus, 0.40/spin, ×spin-count per segment) on WS1 MY+SG. Handles the dup-name override, the vs20mb88gates FS game, the 0.40 spin-value override, and the mandatory post-save T&C edits (Day-N streak header, game-name cleanup, FS 1-day validity). Built from the Day-1/2/3 runs (2026-07-20).
---

# Churn-Reactivation Day-N Streak Batch (WS1 / MB8)

End-to-end runner for one "day" of the CRM **Churn - Reactivation** streak campaign on WS1 (MB8), MY + SG. Established across Day-1/2/3 (2026-07-20). Pairs with the standard auto-flow in CLAUDE.md; this skill adds the churn-specific overrides and the **mandatory post-save T&C edits** that each day needs.

## 1. Identify the Day-N handles

Re-ingest first (`node bin/ingest-requests.js`), then scan the current-month request files for `Day N` in `name_details_raw`:

```bash
node -e 'const fs=require("fs"),p=require("path");const d="captures/requests";const N=<N>;const by=new Map();
for(const f of fs.readdirSync(d)){if(!f.endsWith(".json"))continue;let r;try{r=JSON.parse(fs.readFileSync(p.join(d,f)))}catch{continue}
const m=(r.request_id||"").match(/^P(\d+)$/);if(!m)continue;const sl=+r.source_line||0,c=by.get(r.request_id);if(!c||sl>c._sl){r._sl=sl;by.set(r.request_id,r)}}
for(const r of [...by.values()]){if(new RegExp("day\\s*"+N+"\\b","i").test((r.name_details_raw||"")+" "+(r.campaign||"")))
console.log(r.request_id,r.handle,r.bonus_type,r.promo_code)}'
```

A day = **8 handles**, but the **bonus TYPE varies by day** (confirm from the scan, don't assume):
- **Day 1–3:** 4 Free Credit (Silver 18FC / Gold+ 38FC, ×V1/V2 churn windows) + 4 Free Spin (Gates of Olympus, 0.40/spin, spin counts per segment). Min dep 0 (Claim).
- **Day 4:** 8 **Deposit/Reload** promos (20% reload) — two sub-blocks: **18× / All Games ex-Blackjack** (min dep 250 Silver / 500 Gold+) and **12× / Slots-only** (same min deps), each ×V1/V2. NOT FC/FS. (Verified Day-4 2026-07-20.)
- **Day 5:** mixed — FC + Deposit rows (two per segment). Verify structure from the scan before running.

All WS1 · MY+SG · MYR+SGD · reward validity 1 day · inbox "Indicate Day N Streak".

**Deposit-day (Day 4) specifics** — the FC/FS overrides do NOT apply; instead:
- Commit: `--allow-dup-name` (names collide within pairs); no `--fs-game`, no 0.40 override.
- 18× TO is above the usual 10–12× Reload range — Pre-QC WARNs; confirm with operator (operator-confirmed intentional on Day-4).
- Slots-only sub-block is category-restricted → Categories + Game Providers must both be set (triage NOTE).
- RewardId for T&C edits: `GetBonusInfo`.data.Promotion.PromotionRewards[0].RewardId.
- Streak-header T&C anchor: EN `Boost your balance!` → `🔥 Day N Streak Reward Unlocked!`; ZH `提升您的余额！` → `🔥 第 N 天连续奖励已解锁！`. (No FS game-name cleanup / no validity edit needed — Deposit already emits "one (1) day".)
- Deep-QC = WARNING/no-FAIL (only the non-verifiable per-player cap) → QC Completed normally.

## 2. Pre-flight: codes must carry `_DN`

FC codes must be `..._SIL_DN_V1` / `..._SIL_DN_V2` / `..._GLD_DN_V1` / `..._GLD_DN_V2`; FS codes `..._GOO_SIL_DN` / `..._GOO_GLD_DN`. If a day's codes are missing the `_DN` marker (or the FC `_V1/_V2`), they collide with prior days / existing BO records — **stop and have the operator add the suffixes on the sheet**, then re-ingest. (Day-3 arrived without `_D3`; the operator fixed it before canary.)

## 3. Standard QC flow

Run the CLAUDE.md auto-flow for all 8: `ingest → /qc-engine → canary dry-run → /pre-qc → WAIT → commit → /deep-qc → sheets-writeback`. Log every gate to the QC Results Log (`bin/log-qc-results-batch.mjs`). Expected verdicts: FC triage NOTE (LC-only category), FS triage READY.

## 4. Commit flags (the churn-specific part)

- **FC block:** `node bin/canary-multi-brand.js <handle> --commit --parallel --parallel-qc --allow-dup-name`
  Names duplicate the prior days' FC twins (mechanics tag can't encode the day) — `--allow-dup-name` is required and operator-accepted.
- **FS block:** `node bin/canary-multi-brand.js <handle> --commit --parallel --parallel-qc --allow-dup-name --fs-game=vs20mb88gates`
  - `--fs-game=vs20mb88gates` because the sheet's game line ("…, MB8 GOO\nNo min dep…") mis-parses to `parsed.game="MB8 GOO No"`, a garbled hint the resolver can't match. (The resolver auto-prefers the MB8 skin for a CLEAN "Gates of Olympus" hint, but not for the garbled one.) `vs20mb88gates` is the only GOO variant that accepts 0.40/spin.
  - `--allow-dup-name` — FS names collide with prior days too.
  - **If AddFreeSpinReward fails** (vendor rejects, leaving empty shells): recover by attaching the reward to the existing PromotionId — model on `bin/complete-ws1-fs-shells-day2.mjs` (iGMP blocks recreate + has no delete endpoint). Day-3 committed cleanly with the flag, so this is only a fallback.

See [[project_igmp_fs_mb8_game_skin]] and [[project_igmp_session_refresh_creds]] (refresh WS1 session if endpoints 500).

## 5. FS 0.40 spin-value is an operator override

Sentinel deep-QC **FAILs** every FS on `0.40 < 0.50/spin` (it only exempts referral codes). This is operator-authorized: 0.40 is intentional and valid on `vs20mb88gates`. After deep-QC, still write `status="QC Completed"` for the FS block as the override (the log keeps the FAIL as the documented reason). FC block gets QC Completed normally (INCONCLUSIVE/no-FAIL).

## 6. MANDATORY post-save T&C edits

The saved reward T&C content needs three fixes per day (via `GET /PM/GetPromotionRewardContents {RewardId}` → edit → `POST /PM/BulkAddorUpdatePromotionRewardContents {RewardId, PromotionRewardContents:[{RewardId,Locale,Content}]}`; RewardId from `GetFreeCreditInfo`.data.Promotion.PromotionRewards[0] for FC, `GetFreeSpinPromotionInfo`.data.PromotionRewards[0] for FS). Apply to all 8 codes × MY+SG × EN+ZH. **Dry-run + preview + confirm before committing** (member-facing). Model scripts: the Day-3 tmp updaters.

**a. Day-N streak header** (both FC and FS intro):
| | from | to |
|---|---|---|
| FC EN | `Free credits, real wins!` | `🔥 Day N Streak Reward Unlocked!` |
| FC ZH | `免费分数，真实奖金！` | `🔥 第 N 天连续奖励已解锁！` |
| FS EN | `Spin to win!` | `🔥 Day N Streak Reward Unlocked!` |
| FS ZH | (prepend to `italic;">领取`) | `🔥 第 N 天连续奖励已解锁！领取…` |
Keep the rest of each intro (amount/currency/spin count) intact. Verify with an ASCII anchor (`Day N Streak Reward Unlocked` / `第 N 天连续奖励已解锁`) — the emoji trips up heredoc string checks.

**b. FS game-name cleanup:** the FS T&C body carries the garbled `MB8 GOO No` (parser bug) in TWO spots per locale — the intro AND the "launch the game …" How-to-Apply step. Replace **all** `MB8 GOO No` → `Gates of Olympus` (EN + ZH). The PromotionName is already correct; only the body is garbled.

**c. FS bonuses valid 1 day** (the reward validity is 1 day, but the FS template emits 3):
| | from | to |
|---|---|---|
| FS EN | `three (3) days` | `one (1) day` |
| FS ZH | `3 天内有效` | `1 天内有效` |
(FC already emits "one (1) day" correctly — no FC validity edit needed.)

After editing, re-read and confirm content is non-empty (BulkAddorUpdate can wipe on bad input).

## 7. Inbox (NM) templates

Each day's requests say inbox "Yes — Indicate Day N Streak". Create the NM templates via `POST /NM/AddTemplate {TemplateCode:<promo_code>, EmailSubject, Message(html), Locale:'en'|'zh', TemplateType:'html', IsActive:true}` on both sites — model on `bin/create-ws1-churn-inbox.mjs`. Standard subject `Exclusive Offer - N Free Credit` / FS equivalent; put the **Day N streak** in the body header (`🔥 Day N Streak Reward Unlocked!`). This creates the template only — the blast is CRM's step; never send.

## Standing follow-ups (deferred by operator, 2026-07-20)

- **Parser**: still mis-reads the FS game as "MB8 GOO No" — until fixed to read the explicit `Game:` line, FS needs `--fs-game` + the game-name T&C cleanup each day.
- **Sentinel**: still FAILs 0.40 MB8-skin FS (no MB8 exception) — override to QC Completed each day.
