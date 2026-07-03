---
name: project-handover-state-2026-07-01
description: "Current promo automation state as of 2026-07-01 — P003/P004 WS1 referral FS saved, referral exception logic added to all 3 QC agents."
metadata: 
  node_type: memory
  type: project
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

**State as of 2026-07-01 (end of session)**

## Completed today

### P003 + P004 — WS1 MY referral Free Spins (DONE)
- P003-r4: `FT_REFEREE_NODEP_88FS_GOO` — PromotionId 3745 — Activated — QC Completed
- P004-r5: `FT_REFERRER_NODEP_200FS_GOO` — PromotionId 3746 — Activated — QC Completed
- Both are MB8 Gates of Olympus FS, 0.20/spin, 10x TO, 7d validity, RedemptionType=Claim (no deposit)
- P003: 88 spins (Referee reward); P004: 200 spins (Referrer reward) — both are WS1 referral program exceptions
- ZH name = EN name (operator confirmed)

### Code fixes shipped
- `src/igmp-tnc.js` — `fsHowToApplyEn/Zh` now branches on `min_deposit`: Claim promos (minD=0) get "Head over to your Inbox or the Promotions page" instead of the deposit-flow step 1
- All 3 QC agents — `REFEREE_`/`REFERRER_` codes treated as referral exceptions: spin_count>88 and value_per_spin<0.50 downgraded from FAIL/RETURN to NOTE/WARNING
- `sentinel.md` — `detail.IsActive=false` explicitly suppressed (IGMP bundle artifact captured pre-activation)
- TSM Churn + TSM Retention added to campaign prefix rules and dropdown (done earlier in session)
- Summary table moved to CLAUDE.md step 1.5 (mandatory first output after ingest)

**Why:** WS1 referral program uses non-standard FS limits (>88 spins, <0.50/spin) by platform agreement. All three gate agents (Triage/Pre-QC/Sentinel) now carry operator-confirmed suppression so future referral promos don't block.

## July 2026 sheet state
- P001, P002: pre-existing rows (unknown status)
- P003-r4: QC Completed (row 4)
- P004-r5: QC Completed (row 5)
- Rows 6-9: 5 other records parsed at ingest; status unknown — not processed this session

## Next pick-up
- Check remaining July 2026 requests (rows 6-9 in the sheet)
- Note: agents re-fire stale results after file edits — first clean run is authoritative; ignore duplicate FAIL notifications from same agent IDs
