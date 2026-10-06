#!/usr/bin/env python3
"""Bonus ROI over time — the report's OWN attribution method, run at 7 / 30 / 60 / 90 days + lifetime.

The 7-day headline (reproduce_attribution) = 7-day decayed forward window vs a 14-day daily baseline,
credit-split across all concurrent bonuses. That method is stable (14-day baseline) and tamed
(concurrency split) — the matched-short-window alternative sign-flips and explodes on small codes.
So we run the SAME method with a wider window W:
    lift_W(code,member) = SUM over forward days 0..W-1 of  incr_ngr(day) * w / total_active_amount(day)
      incr_ngr = daily NGR - member's 14-day pre-claim daily average
      w        = BonusAmount * (W-day)/W   (decayed, as the report does; flat for lifetime)
    Bonus ROI_W = SUM(lift_W over W-day-matured claimers) / SUM(bonus spend)
7-day reproduces the report headline exactly; longer windows extend it consistently. Lifetime is
flat (no decay) to data_max and flagged rough. Writes scratchpad/roi-horizon-{MK}.json.
Run: python bin/bonus_roi_horizon.py   (PROMO_MARKET=SG for SG)
"""
import sys, json
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SITE_EDIT, START, END_INCL, AS_OF_DATE, MARKET, SYMBOL

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
WINS = [7, 30, 60, 90]


def build_sql(inlist, W, flat=False):
    d0, d1 = date.fromisoformat(START), date.fromisoformat(END_INCL)
    endW = (d1 + timedelta(days=W - 1)).isoformat()
    start7 = (d0 - timedelta(days=7)).isoformat()
    start21 = (d0 - timedelta(days=21)).isoformat()
    endW1 = (d1 + timedelta(days=W)).isoformat()
    weight = "b.BonusAmount" if flat else f"b.BonusAmount*({W}.0-toFloat64(days.number))/{W}.0"
    return f"""
    WITH
    all_bonuses_raw AS (
        SELECT SITE, SITE_edit, MEMBER_ID, BonusTime_gmt8, if(BonusCode='','Undefined',BonusCode) AS BonusCode, BonusAmount
        FROM WORKSPACE.GetBonus_ABC
        WHERE BonusTime_gmt8 >= '{start7} 00:00:00' AND BonusTime_gmt8 < '{endW1} 00:00:00'
          AND SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusStatus IN {STATUSES} AND BonusAmount>0
    ),
    bonuses AS (SELECT SITE,SITE_edit,MEMBER_ID,toDate(BonusTime_gmt8) bonus_date,BonusCode,SUM(BonusAmount) BonusAmount
                FROM all_bonuses_raw GROUP BY SITE,SITE_edit,MEMBER_ID,toDate(BonusTime_gmt8),BonusCode),
    ret_bonuses AS (SELECT * FROM bonuses WHERE BonusCode IN ({inlist})),
    member_baseline AS (
        SELECT b.SITE,b.MEMBER_ID,b.bonus_date, SUM(act.NGR)/14.0 AS avg_ngr
        FROM (SELECT src.SITE,src.MEMBER_ID,src.bonus_date, subtractDays(src.bonus_date,toUInt32(n.number)+1) AS baseline_date
              FROM (SELECT DISTINCT SITE,MEMBER_ID,bonus_date FROM ret_bonuses) src CROSS JOIN (SELECT number FROM numbers(14)) n) b
        LEFT JOIN (
            SELECT SITE,MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE SnapshotDate>='{start21}' AND SnapshotDate<='{END_INCL}' AND Currency='{CURRENCY}'
            UNION ALL SELECT SITE,MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE SnapshotDate>='{start21}' AND SnapshotDate<='{END_INCL}' AND Currency='{CURRENCY}'
        ) act ON b.SITE=act.SITE AND b.MEMBER_ID=act.MEMBER_ID AND b.baseline_date=act.SnapshotDate
        GROUP BY b.SITE,b.MEMBER_ID,b.bonus_date),
    activity AS (
        SELECT SITE,MEMBER_ID,SnapshotDate,NGR AS raw_ngr FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE SnapshotDate BETWEEN '{START}' AND '{endW}' AND Currency='{CURRENCY}' AND NGR!=0
        UNION ALL SELECT SITE,MEMBER_ID,SnapshotDate,NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE SnapshotDate BETWEEN '{START}' AND '{endW}' AND Currency='{CURRENCY}' AND NGR!=0),
    member_day_totals AS (
        SELECT b.SITE_edit,b.MEMBER_ID, addDays(b.bonus_date,toInt32(n.number)) AS SnapshotDate, SUM(b.BonusAmount) AS total_active_amount
        FROM bonuses b CROSS JOIN (SELECT number FROM numbers({W})) n
        WHERE addDays(b.bonus_date,toInt32(n.number)) BETWEEN '{START}' AND '{endW}'
        GROUP BY b.SITE_edit,b.MEMBER_ID, addDays(b.bonus_date,toInt32(n.number))),
    joined AS (
        SELECT b.BonusCode,b.MEMBER_ID,
            ifNull(a.a_ngr,0)-ifNull(mb.avg_ngr,0) AS incr_ngr, {weight} AS w, mdt.total_active_amount
        FROM ret_bonuses b CROSS JOIN (SELECT number FROM numbers({W})) AS days
        LEFT JOIN (SELECT SITE s,MEMBER_ID m,SnapshotDate d,raw_ngr a_ngr FROM activity) a ON b.SITE=a.s AND b.MEMBER_ID=a.m AND addDays(b.bonus_date,toInt32(days.number))=a.d
        LEFT JOIN (SELECT SITE s,MEMBER_ID m,bonus_date d,avg_ngr FROM member_baseline) mb ON b.SITE=mb.s AND b.MEMBER_ID=mb.m AND b.bonus_date=mb.d
        LEFT JOIN (SELECT SITE_edit s,MEMBER_ID m,SnapshotDate d,total_active_amount FROM member_day_totals) mdt ON b.SITE_edit=mdt.s AND b.MEMBER_ID=mdt.m AND addDays(b.bonus_date,toInt32(days.number))=mdt.d
        WHERE addDays(b.bonus_date,toInt32(days.number)) BETWEEN '{START}' AND '{endW}' AND b.bonus_date>='{START}' AND b.bonus_date<='{END_INCL}'),
    member_attrib AS (SELECT BonusCode,MEMBER_ID, SUM(incr_ngr*w/total_active_amount) AS lift FROM joined GROUP BY BonusCode,MEMBER_ID),
    pml AS (SELECT BonusCode,MEMBER_ID, sum(BonusAmount) bonus_cost, min(toDate(BonusTime_gmt8)) claim_date
            FROM all_bonuses_raw WHERE BonusTime_gmt8>='{START} 00:00:00' AND BonusTime_gmt8<'{(d1+timedelta(days=1)).isoformat()} 00:00:00' AND BonusCode IN ({inlist})
            GROUP BY BonusCode,MEMBER_ID)
    SELECT trimBoth(a.BonusCode) code, p.bonus_cost bonus_cost, a.lift lift, p.claim_date claim_date
    FROM member_attrib a INNER JOIN pml p ON a.BonusCode=p.BonusCode AND a.MEMBER_ID=p.MEMBER_ID
    """


def main(mk):
    va = json.load(open(SCR / f"verify-action-{mk}.json", encoding="utf-8"))
    codes = sorted({o["code"] for o in va["codes"] if o["pillar"] in ("Retention", "VIP")})
    if not codes:
        print(f"[{mk}] none"); return {}
    inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)
    SET = {"readonly": 1, "max_execution_time": 590, "max_memory_usage": 90000000000,
           "max_result_rows": 8000000, "result_overflow_mode": "break", "join_algorithm": "auto"}
    from collections import defaultdict
    from concurrent.futures import ThreadPoolExecutor
    out = defaultdict(dict)
    life_W = (AS_OF_DATE - date.fromisoformat(START)).days + 1
    windows = [(7, False, "7"), (14, False, "14"), (21, False, "21"), (28, False, "28"),
               (30, False, "30"), (60, False, "60"), (90, False, "90"), (life_W, True, "life")]

    def run_window(args):
        W, flat, key = args
        c = get_client(send_receive_timeout=600)   # own client per task — clickhouse_connect isn't concurrency-safe on one client
        rows = c.query(build_sql(inlist, W, flat), settings=SET).result_rows
        agg = defaultdict(lambda: [0.0, 0.0])      # [lift, spend] over matured
        gate = min(W, 90)                          # lifetime gate = mature_90 (need forward observed)
        for code, cost, lift, cd in rows:
            cd = cd if isinstance(cd, date) else date.fromisoformat(str(cd))
            if cd <= AS_OF_DATE - timedelta(days=gate - 1):
                agg[code.strip()][0] += float(lift or 0); agg[code.strip()][1] += float(cost or 0)
        print(f"[{mk}] window {key} (W={W}, {'flat' if flat else 'decayed'}) — {len(rows):,} rows")
        return key, agg

    # The 8 window queries are independent (each its own query + aggregation), so running them
    # concurrently is OUTPUT-IDENTICAL to the old one-after-another loop — only wall-clock changes.
    # Bounded (ROI_CONCURRENCY, default 3) to keep concurrent load on the shared warehouse modest.
    with ThreadPoolExecutor(max_workers=int(__import__("os").environ.get("ROI_CONCURRENCY", "3"))) as ex:
        for key, agg in ex.map(run_window, windows):
            for code in codes:
                a = agg.get(code); out[code][key] = (round(a[0] / a[1], 2) if a and a[1] else None)
    res = {"market": mk, "sym": SYMBOL, "codes": dict(out)}
    json.dump(res, open(SCR / f"roi-horizon-{mk}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"  wrote roi-horizon-{mk}.json ({len(out)} codes)")
    rep = {o["code"]: o.get("r_per_rm") for o in va["codes"]}
    print(f"  {'code':30s} {'roi7':>7} {'rep7d':>7} {'roi30':>7} {'roi60':>7} {'roi90':>7} {'life':>7}")
    for c in codes[:10]:
        o = out.get(c, {})
        print(f"  {c[:30]:30s} {str(o.get('7')):>7} {str(rep.get(c)):>7} {str(o.get('30')):>7} {str(o.get('60')):>7} {str(o.get('90')):>7} {str(o.get('life')):>7}")
    return res


if __name__ == "__main__":
    main(MARKET)
