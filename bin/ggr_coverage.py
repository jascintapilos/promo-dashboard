#!/usr/bin/env python3
"""GGR coverage (house edge vs bonus) for retention + acquisition managed codes.

Replicates VIP's ggr_coverage exactly so all three pillars read the same way:
  coverage = sum(7-day GGR over 7-day-matured claimers) / total bonus spend
  7-day GGR = the house's gross gaming revenue on days 0..6 after the first claim.
>=1x = the edge covered the giveaway (a negative net-revenue return is mostly variance / players got
lucky); <1x = structurally underwater. VIP already carries this from its own pipeline; this fills the
gap for retention + acquisition (their claim-rows never pulled raw window GGR).

Writes scratchpad/ggr-coverage-{MK}.json = {code: coverage}. Run: python bin/ggr_coverage.py
"""
import sys, json
from pathlib import Path
from datetime import timedelta

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SITE_EDIT, START, END_INCL, AS_OF_DATE, MARKET

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"


def main(mk):
    va = json.load(open(SCR / f"verify-allcodes-{mk}.json", encoding="utf-8"))  # Codes-tab statistic lookup: every code
    codes = sorted({o["code"] for o in va["codes"] if o["pillar"] in ("Retention", "Acquisition")})
    if not codes:
        print(f"[{mk}] no ret/acq codes"); return {}
    inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)
    mat7 = (AS_OF_DATE - timedelta(days=6)).isoformat()

    SQL = f"""
    WITH
    claims AS (
      SELECT trimBoth(BonusCode) code, MEMBER_ID, SITE, min(toDate(BonusTime_gmt8)) claim_date, sum(BonusAmount) bonus_cost
      FROM WORKSPACE.GetBonus_ABC
      WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
        AND trimBoth(BonusCode) IN ({inlist})
        AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) <= '{END_INCL}'
      GROUP BY code, MEMBER_ID, SITE
    ),
    ggr AS (
      SELECT MEMBER_ID, SITE, SnapshotDate, GGR FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CURRENCY}' AND GGR!=0 AND SnapshotDate >= '{START}'
      UNION ALL
      SELECT MEMBER_ID, SITE, SnapshotDate, GGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CURRENCY}' AND GGR!=0 AND SnapshotDate >= '{START}'
    )
    SELECT c.code code, c.claim_date claim_date, c.bonus_cost bonus_cost,
      sumIf(g.GGR, g.SnapshotDate >= c.claim_date AND g.SnapshotDate < addDays(c.claim_date,7)) w7_ggr
    FROM claims c
    LEFT JOIN ggr g ON g.MEMBER_ID=c.MEMBER_ID AND g.SITE=c.SITE
    GROUP BY c.code, c.MEMBER_ID, c.claim_date, c.bonus_cost
    """
    cl = get_client(send_receive_timeout=600)
    SET = {"readonly": 1, "max_execution_time": 590, "max_memory_usage": 80000000000,
           "max_result_rows": 8000000, "result_overflow_mode": "break", "join_algorithm": "hash"}
    print(f"[{mk}] ggr-coverage over {len(codes)} ret/acq codes...")
    rows = cl.query(SQL, settings=SET).result_rows

    from collections import defaultdict
    from datetime import date
    agg = defaultdict(lambda: {"ggr_m7": 0.0, "spend": 0.0})
    for code, cd, cost, w7 in rows:
        code = code.strip()
        cd = cd if isinstance(cd, date) else date.fromisoformat(str(cd))
        agg[code]["spend"] += float(cost or 0.0)
        if cd <= AS_OF_DATE - timedelta(days=6):          # 7-day matured
            agg[code]["ggr_m7"] += float(w7 or 0.0)
    out = {code: round(a["ggr_m7"] / a["spend"], 1) for code, a in agg.items() if a["spend"]}
    json.dump(out, open(SCR / f"ggr-coverage-{mk}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"  wrote ggr-coverage-{mk}.json ({len(out)} codes)")
    for c in codes[:6]:
        print(f"    {c[:34]:34s} coverage {out.get(c)}x")
    return out


if __name__ == "__main__":
    main(MARKET)
