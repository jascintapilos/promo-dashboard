"""Task 2 — per-(code, member) VIP attribution + behaviour + tier + recency + GGR-in-window (MY).

Mirrors bin/ret_report/01_pull.py (7d/14d attribution, dep-days 7/30/60/90, tier-at-claim ASOF,
recency 120d), scoped to the TL VIP codes, PLUS w7_ggr = raw house GGR in the 7-day window
(for GGR-coverage and free-credit dead-money quality checks). Member-level -> scratchpad only.

Out: scratchpad/vip/claim-rows-MY.json
Usage: python bin/vip_report/01_pull.py
"""
import sys, json
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
VIP = SCR / "vip"

START, END = "2026-01-01", "2026-08-25"
SNAP_END = "2026-08-27"
RECENCY_FLOOR = "2025-09-01"
LOGSITE = "WS1_MYS_MYR"
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

d_max = date.fromisoformat("2026-08-26")
MAT = {n: (d_max - timedelta(days=n - 1)).isoformat() for n in (7, 30, 60, 90)}

codes = [r["code"] for r in json.load(open(VIP / "vip-codes-MY.json", encoding="utf-8"))]
inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)

d0, d1 = date.fromisoformat(START), date.fromisoformat(END)
P = {
    "start": START, "end": END,
    "end1": (d1 + timedelta(days=1)).isoformat(),
    "end6": (d1 + timedelta(days=6)).isoformat(),
    "end7": (d1 + timedelta(days=7)).isoformat(),
    "start7": (d0 - timedelta(days=7)).isoformat(),
    "start21": (d0 - timedelta(days=21)).isoformat(),
    "cur": "MYR", "inlist": inlist, "statuses": STATUSES,
}

c = get_client(send_receive_timeout=600)
SET = {"readonly": 1, "max_execution_time": 590, "max_memory_usage": 60000000000,
       "max_result_rows": 3000000, "result_overflow_mode": "break", "join_algorithm": "auto"}

# ---------------------------------------------------------------- Q_ATTR
SQL_ATTR = """
WITH
all_bonuses_raw AS (
    SELECT SITE, SITE_edit, MEMBER_ID, BonusTime_gmt8,
           if(BonusCode='', 'Undefined', BonusCode) AS BonusCode, BonusAmount
    FROM WORKSPACE.GetBonus_ABC
    WHERE BonusTime_gmt8 >= '{start7} 00:00:00' AND BonusTime_gmt8 < '{end7} 00:00:00'
      AND SITE_edit='WS1' AND Currency='{cur}'
      AND BonusStatus IN {statuses} AND BonusAmount > 0
),
bonuses AS (
    SELECT SITE, SITE_edit, MEMBER_ID, toDate(BonusTime_gmt8) AS bonus_date, BonusCode, SUM(BonusAmount) AS BonusAmount
    FROM all_bonuses_raw GROUP BY SITE, SITE_edit, MEMBER_ID, toDate(BonusTime_gmt8), BonusCode
),
vip_bonuses AS (SELECT * FROM bonuses WHERE BonusCode IN ({inlist})),
member_baseline AS (
    SELECT b.SITE, b.MEMBER_ID, b.bonus_date,
           SUM(act.DepositAmount)/14.0 AS avg_dep, SUM(act.GGR)/14.0 AS avg_ggr, SUM(act.NGR)/14.0 AS avg_ngr
    FROM (
        SELECT src.SITE, src.MEMBER_ID, src.bonus_date,
               subtractDays(src.bonus_date, toUInt32(n.number)+1) AS baseline_date
        FROM (SELECT DISTINCT SITE, MEMBER_ID, bonus_date FROM vip_bonuses) src
        CROSS JOIN (SELECT number FROM numbers(14)) n
    ) b
    LEFT JOIN (
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, GGR, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A
        WHERE SnapshotDate >= '{start21}' AND SnapshotDate < '{end}' AND Currency='{cur}'
        UNION ALL
        SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, GGR, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC
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
    SELECT b.SITE_edit, b.MEMBER_ID, addDays(b.bonus_date, toInt32(n.number)) AS SnapshotDate, SUM(b.BonusAmount) AS total_active_amount
    FROM bonuses b CROSS JOIN (SELECT number FROM numbers(7)) n
    WHERE addDays(b.bonus_date, toInt32(n.number)) BETWEEN '{start}' AND '{end6}'
    GROUP BY b.SITE_edit, b.MEMBER_ID, addDays(b.bonus_date, toInt32(n.number))
),
joined AS (
    SELECT b.BonusCode, b.MEMBER_ID,
        ifNull(a.a_dep,0) AS raw_dep, ifNull(a.a_ngr,0) AS raw_ngr,
        ifNull(a.a_dep,0)-ifNull(mb.avg_dep,0) AS incr_dep,
        ifNull(a.a_ggr,0)-ifNull(mb.avg_ggr,0) AS incr_ggr,
        ifNull(a.a_ngr,0)-ifNull(mb.avg_ngr,0) AS incr_ngr,
        b.BonusAmount*(7.0-toFloat64(days.number))/7.0 AS w, mdt.total_active_amount
    FROM vip_bonuses b
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
      AND BonusCode IN ({inlist})
    GROUP BY BonusCode, MEMBER_ID
)
SELECT a.BonusCode AS BonusCode, a.MEMBER_ID AS MEMBER_ID,
    p.claims AS claims, p.bonus_cost AS bonus_cost,
    a.t1_dep AS t1_dep, a.t1_ngr AS t1_ngr,
    a.dep_lift AS dep_lift, a.ggr_lift AS ggr_lift, a.ngr_lift AS ngr_lift
FROM member_attrib a
INNER JOIN pml_base p ON a.BonusCode=p.BonusCode AND a.MEMBER_ID=p.MEMBER_ID
""".format(**P)

print("Q_ATTR: 7d/14d windowed attribution (VIP scope)...")
r1 = c.query(SQL_ATTR, settings=SET)
attr = {}
for row in r1.result_rows:
    d = dict(zip(r1.column_names, row))
    key = (d["BonusCode"].strip(), str(d["MEMBER_ID"]))
    attr[key] = {k: (float(d[k]) if k not in ("BonusCode", "MEMBER_ID") else d[k]) for k in d}
print(f"  attrib rows: {len(attr):,}")

# ---------------------------------------------------------------- Q_BEHAV (+ tier + w7_ggr)
SQL_BEHAV = """
WITH vip_claims AS (
    SELECT SITE, MEMBER_ID, BonusCode, BonusTime_gmt8, toDate(BonusTime_gmt8) AS bonus_date, BonusAmount
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='WS1' AND Currency='{cur}' AND BonusAmount>0 AND BonusStatus IN {statuses}
      AND BonusTime_gmt8 >= '{start} 00:00:00' AND BonusTime_gmt8 < '{end1} 00:00:00'
      AND BonusCode IN ({inlist})
),
per_cm AS (
    SELECT SITE, MEMBER_ID, BonusCode, min(bonus_date) AS claim_date, min(BonusTime_gmt8) AS claim_dt,
           count() AS claims, sum(BonusAmount) AS bonus_cost
    FROM vip_claims GROUP BY SITE, MEMBER_ID, BonusCode
),
tier_map AS (
    SELECT p.MEMBER_ID AS MEMBER_ID, p.BonusCode AS BonusCode, ifNull(t.tier,'Unknown') AS tier
    FROM per_cm p
    ASOF LEFT JOIN (SELECT MEMBER_ID, (TIME + INTERVAL 8 HOUR) AS tdt, NewMembershipName AS tier
                    FROM WORKSPACE.dedup_PlayerMembershipLog_A WHERE SITE='{logsite}' AND NewMembershipName!='') t
      ON p.MEMBER_ID=t.MEMBER_ID AND p.claim_dt >= t.tdt
),
snap AS (
    SELECT SITE AS ss, MEMBER_ID AS sm, SnapshotDate AS sd, DepositAmount AS dep, GGR AS ggr
    FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='{cur}' AND (DepositAmount>0 OR GGR!=0) AND SnapshotDate >= '{start}' AND SnapshotDate < '{snapend}'
    UNION ALL
    SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, GGR
    FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='{cur}' AND (DepositAmount>0 OR GGR!=0) AND SnapshotDate >= '{start}' AND SnapshotDate < '{snapend}'
)
SELECT p.MEMBER_ID AS MEMBER_ID, p.BonusCode AS BonusCode, p.claim_date AS claim_date,
    p.claims AS claims, p.bonus_cost AS bonus_cost, tm.tier AS tier,
    sumIf(ifNull(s.dep,0), n.number<7) AS w7_dep,
    sumIf(ifNull(s.ggr,0), n.number<7) AS w7_ggr,
    sum(if(ifNull(s.dep,0)>0 AND n.number<7,  1,0)) AS dep_days_7,
    sum(if(ifNull(s.dep,0)>0 AND n.number>=1 AND n.number<30,1,0)) AS redep_days_30,
    sum(if(ifNull(s.dep,0)>0 AND n.number<30, 1,0)) AS dep_days_30,
    sum(if(ifNull(s.dep,0)>0 AND n.number<60, 1,0)) AS dep_days_60,
    sum(if(ifNull(s.dep,0)>0 AND n.number<90, 1,0)) AS dep_days_90,
    sum(if(ifNull(s.dep,0)>0 AND n.number>=8 AND n.number<30,1,0)) AS dep_days_8_29
FROM per_cm p
CROSS JOIN (SELECT number FROM numbers(90)) n
LEFT JOIN snap s ON p.SITE=s.ss AND p.MEMBER_ID=s.sm AND addDays(p.claim_date, toInt32(n.number))=s.sd
LEFT JOIN tier_map tm ON p.MEMBER_ID=tm.MEMBER_ID AND p.BonusCode=tm.BonusCode
GROUP BY p.MEMBER_ID, p.BonusCode, p.claim_date, p.claims, p.bonus_cost, tm.tier
""".format(logsite=LOGSITE, snapend=SNAP_END, **P)

print("Q_BEHAV: dep-days 7/30/60/90 + tier + w7_ggr...")
r2 = c.query(SQL_BEHAV, settings=SET)
behav = {}
for row in r2.result_rows:
    d = dict(zip(r2.column_names, row))
    behav[(d["BonusCode"].strip(), str(d["MEMBER_ID"]))] = d
print(f"  behaviour rows: {len(behav):,}")

# ---------------------------------------------------------------- Q_RECENCY
SQL_REC = """
WITH per_cm AS (
    SELECT SITE, MEMBER_ID, BonusCode, min(toDate(BonusTime_gmt8)) AS claim_date
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='WS1' AND Currency='{cur}' AND BonusAmount>0 AND BonusStatus IN {statuses}
      AND BonusTime_gmt8 >= '{start} 00:00:00' AND BonusTime_gmt8 < '{end1} 00:00:00'
      AND BonusCode IN ({inlist})
    GROUP BY SITE, MEMBER_ID, BonusCode
),
snap AS (
    SELECT MEMBER_ID AS sm, SnapshotDate AS sd FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='{cur}' AND DepositAmount>0 AND SnapshotDate >= '{recfloor}' AND SnapshotDate < '{end1}'
    UNION ALL
    SELECT MEMBER_ID, SnapshotDate FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='{cur}' AND DepositAmount>0 AND SnapshotDate >= '{recfloor}' AND SnapshotDate < '{end1}'
)
SELECT p.MEMBER_ID AS MEMBER_ID, p.BonusCode AS BonusCode, max(s.sd) AS last_dep_before
FROM per_cm p
LEFT JOIN snap s ON p.MEMBER_ID=s.sm
WHERE s.sd < p.claim_date AND s.sd >= subtractDays(p.claim_date,120)
GROUP BY p.MEMBER_ID, p.BonusCode
""".format(recfloor=RECENCY_FLOOR, **P)

print("Q_RECENCY: last deposit before claim (120d lookback)...")
r3 = c.query(SQL_REC, settings=SET)
rec = {}
for row in r3.result_rows:
    d = dict(zip(r3.column_names, row))
    ld = d["last_dep_before"]
    rec[(d["BonusCode"].strip(), str(d["MEMBER_ID"]))] = str(ld) if ld and str(ld) != "1970-01-01" else None
print(f"  recency rows: {len(rec):,}")

# ---------------------------------------------------------------- merge
def maturity(cd, n):
    return cd <= MAT[n]

out = []
keys = set(behav) | set(attr)
for key in keys:
    code, mid = key
    b = behav.get(key, {}); a = attr.get(key, {})
    cd = str(b.get("claim_date") or "")
    ld = rec.get(key)
    recency_days = (date.fromisoformat(cd) - date.fromisoformat(ld)).days if (cd and ld) else None
    out.append({
        "code": code, "member": mid, "claim_date": cd,
        "tier": (b.get("tier") or "Unknown"),
        "claims": int(b.get("claims") or a.get("claims") or 0),
        "bonus_cost": float(b.get("bonus_cost") if b.get("bonus_cost") is not None else a.get("bonus_cost") or 0.0),
        "t1_dep": float(a.get("t1_dep") or 0.0), "t1_ngr": float(a.get("t1_ngr") or 0.0),
        "dep_lift": float(a.get("dep_lift") or 0.0), "ggr_lift": float(a.get("ggr_lift") or 0.0),
        "ngr_lift": float(a.get("ngr_lift") or 0.0),
        "w7_dep": float(b.get("w7_dep") or 0.0), "w7_ggr": float(b.get("w7_ggr") or 0.0),
        "dep_days_7": int(b.get("dep_days_7") or 0),
        "redep_days_30": int(b.get("redep_days_30") or 0),
        "dep_days_30": int(b.get("dep_days_30") or 0),
        "dep_days_60": int(b.get("dep_days_60") or 0),
        "dep_days_90": int(b.get("dep_days_90") or 0),
        "dep_days_8_29": int(b.get("dep_days_8_29") or 0),
        "last_dep_before": ld, "recency_days": recency_days,
        "mature_7": maturity(cd, 7) if cd else False,
        "mature_30": maturity(cd, 30) if cd else False,
        "mature_60": maturity(cd, 60) if cd else False,
        "mature_90": maturity(cd, 90) if cd else False,
    })

json.dump(out, open(VIP / "claim-rows-MY.json", "w", encoding="utf-8"), default=str)

# ---------------------------------------------------------------- verify
n = len(out)
members = len({r["member"] for r in out})
cost = sum(r["bonus_cost"] for r in out)
ngr_lift = sum(r["ngr_lift"] for r in out)
ggr_win = sum(r["w7_ggr"] for r in out)
no_attr = sum(1 for r in out if (r["code"], r["member"]) not in attr)
print(f"\nper-(code,member) rows: {n:,} | distinct members: {members:,}")
print(f"  redeemed/active bonus_cost total: RM{cost:,.0f}")
print(f"  Sum NGR Lift: RM{ngr_lift:,.0f}  |  Sum 7d-window GGR (house win): RM{ggr_win:,.0f}")
print(f"  GGR-coverage (Sigma w7_ggr / Sigma bonus_cost): {ggr_win/cost:.2f}x")
print(f"  behaviour rows lacking an attribution match: {no_attr:,}")
tiers = {}
for r in out: tiers[r["tier"]] = tiers.get(r["tier"], 0) + 1
print("  tier-at-claim spread: " + " | ".join(f"{t}:{c}" for t, c in sorted(tiers.items(), key=lambda x: -x[1])[:10]))
print("Saved scratchpad/vip/claim-rows-MY.json")
