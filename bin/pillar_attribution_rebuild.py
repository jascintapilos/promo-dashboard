"""Reproduce the 'Bonus Performance by Campaign Pillar' T1/T2 windowed attribution
(deposit + GGR + NGR, 7-day time-decay window vs 14-day pre-baseline) PER CODE,
so it can be aggregated by the framework-corrected pillars.

Method = projects/.../bonus_performance_sql_reference.py, extended with GGR.
Runs one currency; writes per-code metrics to scratchpad/attrib-<cur>.json.

Usage: python bin/pillar_attribution_rebuild.py MYR
"""
import sys, json
from pathlib import Path

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csir_config import get_client

CUR = sys.argv[1] if len(sys.argv) > 1 else "MYR"
START, END = "2026-01-01", "2026-08-09"      # analysis window (end inclusive)
# derived date bounds
from datetime import date, timedelta
d0, d1 = date.fromisoformat(START), date.fromisoformat(END)
P = {
    "start": START, "end": END,
    "end1": (d1 + timedelta(days=1)).isoformat(),
    "end6": (d1 + timedelta(days=6)).isoformat(),
    "end7": (d1 + timedelta(days=7)).isoformat(),
    "start7": (d0 - timedelta(days=7)).isoformat(),
    "start21": (d0 - timedelta(days=21)).isoformat(),
    "cur": CUR,
}
SCRATCH = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")


client = get_client(send_receive_timeout=600)

SQL = """
WITH
all_bonuses_raw AS (
    SELECT SITE, SITE_edit, MEMBER_ID, BonusTime_gmt8,
           if(BonusCode='', 'Undefined', BonusCode) AS BonusCode, BonusAmount
    FROM WORKSPACE.GetBonus_ABC
    WHERE BonusTime_gmt8 >= '{start7} 00:00:00' AND BonusTime_gmt8 < '{end7} 00:00:00'
      AND SITE_edit='WS1' AND Currency='{cur}'
      AND BonusStatus IN ('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')
      AND BonusAmount > 0
),
bonuses AS (
    SELECT SITE, SITE_edit, MEMBER_ID, toDate(BonusTime_gmt8) AS bonus_date,
           BonusCode, SUM(BonusAmount) AS BonusAmount
    FROM all_bonuses_raw
    GROUP BY SITE, SITE_edit, MEMBER_ID, toDate(BonusTime_gmt8), BonusCode
),
member_baseline AS (
    SELECT b.SITE, b.MEMBER_ID, b.bonus_date,
           SUM(act.DepositAmount)/14.0 AS avg_dep,
           SUM(act.GGR)/14.0 AS avg_ggr,
           SUM(act.NGR)/14.0 AS avg_ngr
    FROM (
        SELECT src.SITE, src.MEMBER_ID, src.bonus_date,
               subtractDays(src.bonus_date, toUInt32(n.number)+1) AS baseline_date
        FROM (SELECT DISTINCT SITE, MEMBER_ID, bonus_date FROM bonuses) src
        CROSS JOIN (SELECT number FROM numbers(14)) n
    ) b
    LEFT JOIN (
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, GGR, NGR
        FROM WORKSPACE.Daily_GMT8_Snapshot_A
        WHERE SnapshotDate >= '{start21}' AND SnapshotDate < '{end}' AND Currency='{cur}'
        UNION ALL
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, GGR, NGR
        FROM WORKSPACE.Daily_GMT8_Snapshot_BC
        WHERE SnapshotDate >= '{start21}' AND SnapshotDate < '{end}' AND Currency='{cur}'
    ) act ON b.SITE=act.SITE AND b.MEMBER_ID=act.MEMBER_ID AND b.baseline_date=act.SnapshotDate
    GROUP BY b.SITE, b.MEMBER_ID, b.bonus_date
),
activity AS (
    SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount AS raw_dep, GGR AS raw_ggr, NGR AS raw_ngr
    FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE SnapshotDate BETWEEN '{start}' AND '{end6}' AND Currency='{cur}' AND (DepositAmount>0 OR GGR!=0 OR NGR!=0)
    UNION ALL
    SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, GGR, NGR
    FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE SnapshotDate BETWEEN '{start}' AND '{end6}' AND Currency='{cur}' AND (DepositAmount>0 OR GGR!=0 OR NGR!=0)
),
member_day_totals AS (
    SELECT b.SITE_edit, b.MEMBER_ID, addDays(b.bonus_date, toInt32(n.number)) AS SnapshotDate,
           SUM(b.BonusAmount) AS total_active_amount
    FROM bonuses b CROSS JOIN (SELECT number FROM numbers(7)) n
    WHERE addDays(b.bonus_date, toInt32(n.number)) BETWEEN '{start}' AND '{end6}'
    GROUP BY b.SITE_edit, b.MEMBER_ID, addDays(b.bonus_date, toInt32(n.number))
),
joined AS (
    SELECT b.BonusCode, b.MEMBER_ID,
        ifNull(a.a_dep,0) AS raw_dep, ifNull(a.a_ggr,0) AS raw_ggr, ifNull(a.a_ngr,0) AS raw_ngr,
        ifNull(a.a_dep,0)-ifNull(mb.avg_dep,0) AS incr_dep,
        ifNull(a.a_ggr,0)-ifNull(mb.avg_ggr,0) AS incr_ggr,
        ifNull(a.a_ngr,0)-ifNull(mb.avg_ngr,0) AS incr_ngr,
        b.BonusAmount*(7.0-toFloat64(days.number))/7.0 AS w, mdt.total_active_amount
    FROM bonuses b
    CROSS JOIN (SELECT number FROM numbers(7)) AS days
    LEFT JOIN (SELECT SITE AS s, MEMBER_ID AS m, SnapshotDate AS d, raw_dep AS a_dep, raw_ggr AS a_ggr, raw_ngr AS a_ngr FROM activity) a
        ON b.SITE=a.s AND b.MEMBER_ID=a.m AND addDays(b.bonus_date, toInt32(days.number))=a.d
    LEFT JOIN (SELECT SITE AS s, MEMBER_ID AS m, bonus_date AS d, avg_dep, avg_ggr, avg_ngr FROM member_baseline) mb
        ON b.SITE=mb.s AND b.MEMBER_ID=mb.m AND b.bonus_date=mb.d
    LEFT JOIN (SELECT SITE_edit AS s, MEMBER_ID AS m, SnapshotDate AS d, total_active_amount FROM member_day_totals) mdt
        ON b.SITE_edit=mdt.s AND b.MEMBER_ID=mdt.m AND addDays(b.bonus_date, toInt32(days.number))=mdt.d
    WHERE addDays(b.bonus_date, toInt32(days.number)) BETWEEN '{start}' AND '{end6}'
      AND b.bonus_date >= '{start}' AND b.bonus_date <= '{end}'
),
member_attrib AS (
    SELECT BonusCode, MEMBER_ID,
        SUM(raw_dep*w/total_active_amount) AS t1_dep,
        SUM(raw_ggr*w/total_active_amount) AS t1_ggr,
        SUM(raw_ngr*w/total_active_amount) AS t1_ngr,
        SUM(incr_dep*w/total_active_amount) AS dep_lift,
        SUM(incr_ggr*w/total_active_amount) AS ggr_lift,
        SUM(incr_ngr*w/total_active_amount) AS ngr_lift
    FROM joined GROUP BY BonusCode, MEMBER_ID
),
pml_base AS (
    SELECT BonusCode, MEMBER_ID, count() AS claims, sum(BonusAmount) AS bonus_cost
    FROM all_bonuses_raw
    WHERE BonusTime_gmt8 >= '{start} 00:00:00' AND BonusTime_gmt8 < '{end1} 00:00:00'
    GROUP BY BonusCode, MEMBER_ID
)
SELECT a.BonusCode AS BonusCode,
    count(DISTINCT a.MEMBER_ID) AS members,
    sum(ifNull(p.claims,0)) AS claims,
    sum(ifNull(p.bonus_cost,0)) AS bonus_cost,
    sum(a.t1_dep) AS t1_dep, sum(a.t1_ggr) AS t1_ggr, sum(a.t1_ngr) AS t1_ngr,
    sum(a.dep_lift) AS dep_lift, sum(a.ggr_lift) AS ggr_lift, sum(a.ngr_lift) AS ngr_lift
FROM member_attrib a
INNER JOIN pml_base p ON a.BonusCode=p.BonusCode AND a.MEMBER_ID=p.MEMBER_ID
GROUP BY a.BonusCode
""".format(**P)

print(f"Running attribution for {CUR} ({START}..{END}) ...")
res = client.query(SQL, settings={"readonly": 1, "max_execution_time": 590,
                                   "max_memory_usage": 40000000000, "max_result_rows": 100000,
                                   "result_overflow_mode": "break", "join_algorithm": "auto"})
rows = [dict(zip(res.column_names, r)) for r in res.result_rows]
for r in rows:
    for k in r:
        if isinstance(r[k], (int,)) is False and k != "BonusCode":
            try: r[k] = float(r[k])
            except Exception: pass
(SCRATCH / f"attrib-{CUR}.json").write_text(json.dumps(rows, ensure_ascii=False, default=str), encoding="utf-8")
tc = sum(r["claims"] for r in rows); tcost = sum(r["bonus_cost"] for r in rows)
print(f"codes: {len(rows)} | total claims: {tc:,} | total cost: {tcost:,.0f}")
print(f"Saved scratchpad/attrib-{CUR}.json")
