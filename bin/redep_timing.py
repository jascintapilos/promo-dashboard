#!/usr/bin/env python3
"""Redeposit TIMING pull — the one guardrail dimension claim-rows lack.

claim-rows carry deposit-active-day COUNTS (dep_days / redep_days), not days-to-FIRST-
redeposit. The guardrail card wants "expected behaviour: redeposit within X days", so this
pulls, per (member, claim_date), the days from the bonus claim to the member's next deposit
(ASOF join to the daily snapshots). guardrail_grid.py joins it back to claim-rows (which have
tier + recency-at-claim + code->mechanic/size) to build the lifecycle x tier x mechanic x size
grid at YG's "Cooling Diamond + Free Credit" granularity.

Config only in spirit (aggregate timing; no member data persisted beyond the join key).
Out: scratchpad/redep-timing-{MK}.json = {"member|claim_date": days_to_redep or null}
Run: python bin/redep_timing.py   (both markets in one pass)
"""
import sys, json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


c = get_client(send_receive_timeout=600)

for MK, CUR in (("MY", "MYR"), ("SG", "SGD")):
    ret, vip = load(f"ret/ret-metrics-{MK}.json"), load(f"vip/vip-metrics-{MK}.json")
    if not ret or not vip:
        print(f"[{MK}] skip — metrics missing")
        continue
    codes = sorted({c2["code"].strip() for c2 in ret["codes"]} | {c2["code"].strip() for c2 in vip["codes"]})
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)

    q = f"""
    WITH claims AS (
      SELECT DISTINCT MEMBER_ID, toDate(BonusTime_gmt8) AS claim_date
      FROM WORKSPACE.GetBonus_ABC
      WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0
        AND trimBoth(BonusCode) IN ({inlist})
        AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'
    ),
    deps AS (
      SELECT MEMBER_ID, SnapshotDate FROM (
        SELECT MEMBER_ID, SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0
        UNION ALL
        SELECT MEMBER_ID, SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0
      ) WHERE MEMBER_ID IN (SELECT MEMBER_ID FROM claims)
    )
    SELECT c.MEMBER_ID, c.claim_date, dateDiff('day', c.claim_date, d.SnapshotDate) AS days_to_redep
    FROM claims c
    ASOF LEFT JOIN deps d ON c.MEMBER_ID = d.MEMBER_ID AND c.claim_date < d.SnapshotDate
    """
    rows = c.query(q).result_rows
    out = {}
    for mem, cd, dd in rows:
        # ASOF LEFT JOIN returns a garbage far-past date on no-match (not null) -> huge negative
        # dateDiff. A real redeposit is strictly AFTER the claim, so keep only days_to_redep > 0.
        out[f"{mem}|{cd.isoformat()}"] = (int(dd) if (dd is not None and dd > 0) else None)
    got = sum(1 for v in out.values() if v is not None)
    path = SCR / f"redep-timing-{MK}.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"[{MK}] wrote {path.name} — {len(out):,} (member,claim_date) keys, {got:,} with a later deposit "
          f"({round(100*got/len(out)) if out else 0}%)")
