"""Windowed attribution grouped by the member's membership level AT CLAIM TIME
(ASOF join to dedup_PlayerMembershipLog_A). Same T1/T2 method (deposit+GGR+NGR).
Emits scratchpad/tier-attrib-<cur>.json. Usage: python bin/pillar_attribution_by_tier.py MYR
"""
import sys, json
from pathlib import Path
from datetime import date, timedelta

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csir_config import get_client

CUR = sys.argv[1] if len(sys.argv) > 1 else "MYR"
LOGSITE = "WS1_MYS_MYR" if CUR == "MYR" else "WS1_SGP_SGD"
START, END = "2026-01-01", "2026-08-09"
d0, d1 = date.fromisoformat(START), date.fromisoformat(END)
P = {"start": START, "end": END, "end1": (d1+timedelta(days=1)).isoformat(),
     "end6": (d1+timedelta(days=6)).isoformat(), "end7": (d1+timedelta(days=7)).isoformat(),
     "start7": (d0-timedelta(days=7)).isoformat(), "start21": (d0-timedelta(days=21)).isoformat(),
     "cur": CUR, "logsite": LOGSITE}
SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")


client = get_client(send_receive_timeout=600)

SQL = """
WITH
all_bonuses_raw AS (
    SELECT SITE, SITE_edit, MEMBER_ID, BonusTime_gmt8, toDate(BonusTime_gmt8) AS bonus_date,
           if(BonusCode='','Undefined',BonusCode) AS BonusCode, BonusAmount
    FROM WORKSPACE.GetBonus_ABC
    WHERE BonusTime_gmt8 >= '{start7} 00:00:00' AND BonusTime_gmt8 < '{end7} 00:00:00'
      AND SITE_edit='WS1' AND Currency='{cur}'
      AND BonusStatus IN ('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')
      AND BonusAmount > 0
),
claim_dates AS (SELECT MEMBER_ID, bonus_date, min(BonusTime_gmt8) AS claim_dt FROM all_bonuses_raw GROUP BY MEMBER_ID, bonus_date),
tier_map AS (
    SELECT cd.MEMBER_ID AS MEMBER_ID, cd.bonus_date AS bonus_date, ifNull(t.tier,'Unknown') AS tier
    FROM claim_dates cd
    ASOF LEFT JOIN (
        SELECT MEMBER_ID, (TIME + INTERVAL 8 HOUR) AS tdt, NewMembershipName AS tier
        FROM WORKSPACE.dedup_PlayerMembershipLog_A WHERE SITE='{logsite}' AND NewMembershipName != ''
    ) t ON cd.MEMBER_ID = t.MEMBER_ID AND cd.claim_dt >= t.tdt
),
bonuses AS (
    SELECT r.SITE, r.SITE_edit, r.MEMBER_ID, r.bonus_date, tm.tier AS tier, r.BonusCode, SUM(r.BonusAmount) AS BonusAmount
    FROM all_bonuses_raw r
    LEFT JOIN tier_map tm ON r.MEMBER_ID=tm.MEMBER_ID AND r.bonus_date=tm.bonus_date
    GROUP BY r.SITE, r.SITE_edit, r.MEMBER_ID, r.bonus_date, tm.tier, r.BonusCode
),
member_baseline AS (
    SELECT b.SITE, b.MEMBER_ID, b.bonus_date, SUM(act.DepositAmount)/14.0 AS avg_dep, SUM(act.GGR)/14.0 AS avg_ggr, SUM(act.NGR)/14.0 AS avg_ngr
    FROM (SELECT src.SITE, src.MEMBER_ID, src.bonus_date, subtractDays(src.bonus_date, toUInt32(n.number)+1) AS bd
          FROM (SELECT DISTINCT SITE, MEMBER_ID, bonus_date FROM bonuses) src CROSS JOIN (SELECT number FROM numbers(14)) n) b
    LEFT JOIN (SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, GGR, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A
               WHERE SnapshotDate >= '{start21}' AND SnapshotDate < '{end}' AND Currency='{cur}'
               UNION ALL SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, GGR, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC
               WHERE SnapshotDate >= '{start21}' AND SnapshotDate < '{end}' AND Currency='{cur}') act
      ON b.SITE=act.SITE AND b.MEMBER_ID=act.MEMBER_ID AND b.bd=act.SnapshotDate
    GROUP BY b.SITE, b.MEMBER_ID, b.bonus_date
),
activity AS (
    SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount AS raw_dep, GGR AS raw_ggr, NGR AS raw_ngr FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE SnapshotDate BETWEEN '{start}' AND '{end6}' AND Currency='{cur}' AND (DepositAmount>0 OR GGR!=0 OR NGR!=0)
    UNION ALL SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, GGR, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE SnapshotDate BETWEEN '{start}' AND '{end6}' AND Currency='{cur}' AND (DepositAmount>0 OR GGR!=0 OR NGR!=0)
),
member_day_totals AS (
    SELECT b.SITE_edit, b.MEMBER_ID, addDays(b.bonus_date, toInt32(n.number)) AS SnapshotDate, SUM(b.BonusAmount) AS tot
    FROM bonuses b CROSS JOIN (SELECT number FROM numbers(7)) n
    WHERE addDays(b.bonus_date, toInt32(n.number)) BETWEEN '{start}' AND '{end6}'
    GROUP BY b.SITE_edit, b.MEMBER_ID, addDays(b.bonus_date, toInt32(n.number))
),
joined AS (
    SELECT b.tier AS tier, b.MEMBER_ID,
        ifNull(a.a_dep,0)-ifNull(mb.avg_dep,0) AS incr_dep, ifNull(a.a_ggr,0)-ifNull(mb.avg_ggr,0) AS incr_ggr,
        ifNull(a.a_ngr,0)-ifNull(mb.avg_ngr,0) AS incr_ngr, ifNull(a.a_dep,0) AS raw_dep, ifNull(a.a_ggr,0) AS raw_ggr,
        ifNull(a.a_ngr,0) AS raw_ngr, b.BonusAmount*(7.0-toFloat64(days.number))/7.0 AS w, mdt.tot
    FROM bonuses b CROSS JOIN (SELECT number FROM numbers(7)) AS days
    LEFT JOIN (SELECT SITE AS s, MEMBER_ID AS m, SnapshotDate AS d, raw_dep AS a_dep, raw_ggr AS a_ggr, raw_ngr AS a_ngr FROM activity) a
        ON b.SITE=a.s AND b.MEMBER_ID=a.m AND addDays(b.bonus_date, toInt32(days.number))=a.d
    LEFT JOIN (SELECT SITE AS s, MEMBER_ID AS m, bonus_date AS d, avg_dep, avg_ggr, avg_ngr FROM member_baseline) mb
        ON b.SITE=mb.s AND b.MEMBER_ID=mb.m AND b.bonus_date=mb.d
    LEFT JOIN (SELECT SITE_edit AS s, MEMBER_ID AS m, SnapshotDate AS d, tot FROM member_day_totals) mdt
        ON b.SITE_edit=mdt.s AND b.MEMBER_ID=mdt.m AND addDays(b.bonus_date, toInt32(days.number))=mdt.d
    WHERE addDays(b.bonus_date, toInt32(days.number)) BETWEEN '{start}' AND '{end6}' AND b.bonus_date >= '{start}' AND b.bonus_date <= '{end}'
),
member_attrib AS (
    SELECT tier, MEMBER_ID, SUM(raw_dep*w/tot) AS t1_dep, SUM(raw_ggr*w/tot) AS t1_ggr, SUM(raw_ngr*w/tot) AS t1_ngr,
        SUM(incr_dep*w/tot) AS dep_lift, SUM(incr_ggr*w/tot) AS ggr_lift, SUM(incr_ngr*w/tot) AS ngr_lift
    FROM joined GROUP BY tier, MEMBER_ID
),
pml_base AS (
    SELECT tm.tier AS tier, r.MEMBER_ID AS MEMBER_ID, count() AS claims, sum(r.BonusAmount) AS bonus_cost
    FROM all_bonuses_raw r LEFT JOIN tier_map tm ON r.MEMBER_ID=tm.MEMBER_ID AND r.bonus_date=tm.bonus_date
    WHERE r.BonusTime_gmt8 >= '{start} 00:00:00' AND r.BonusTime_gmt8 < '{end1} 00:00:00'
    GROUP BY tm.tier, r.MEMBER_ID
)
SELECT multiIf(a.tier IN ('Agent Credit','Scammers'),'Other', a.tier IN ('','Unknown'),'Classic', replaceRegexpOne(a.tier,' \\(Trial\\)$','')) AS tier,
    count(DISTINCT a.MEMBER_ID) AS members, sum(ifNull(p.claims,0)) AS claims,
    sum(ifNull(p.bonus_cost,0)) AS bonus_cost, sum(a.t1_dep) AS t1_dep, sum(a.t1_ggr) AS t1_ggr, sum(a.t1_ngr) AS t1_ngr,
    sum(a.dep_lift) AS dep_lift, sum(a.ggr_lift) AS ggr_lift, sum(a.ngr_lift) AS ngr_lift
FROM member_attrib a INNER JOIN pml_base p ON a.tier=p.tier AND a.MEMBER_ID=p.MEMBER_ID
GROUP BY tier
""".format(**P)

print(f"Running BY-TIER attribution for {CUR} ...")
res = client.query(SQL, settings={"readonly": 1, "max_execution_time": 590, "max_memory_usage": 48000000000,
                                   "max_result_rows": 100000, "result_overflow_mode": "break"})
rows = [dict(zip(res.column_names, r)) for r in res.result_rows]
for r in rows:
    for k in r:
        if k != "tier":
            try: r[k] = float(r[k])
            except Exception: pass
(SCR/f"tier-attrib-{CUR}.json").write_text(json.dumps(rows, ensure_ascii=False, default=str), encoding="utf-8")
print(f"tiers: {[(r['tier'], int(r['claims'])) for r in sorted(rows, key=lambda x:-x['claims'])]}")
print(f"total claims: {sum(r['claims'] for r in rows):,.0f} | total spend: {sum(r['bonus_cost'] for r in rows):,.0f}")
