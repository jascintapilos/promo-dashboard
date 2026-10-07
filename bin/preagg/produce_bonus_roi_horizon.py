#!/usr/bin/env python3
"""Store-backed producer for bin/bonus_roi_horizon.py — Bonus ROI over time (7/14/21/28/30/60/90/lifetime).

BYTE-COMPATIBLE twin of bonus_roi_horizon.py: the ONLY change is the heavy warehouse query — the
ClickHouse CTE chain over WORKSPACE.GetBonus_ABC + Daily_GMT8_Snapshot_A/_BC is swapped for the SAME
chain run in DuckDB over the local Parquet stores (store_claims.parquet = claims, store_b.parquet =
member active-day deposits/NGR). All post-processing (maturation gate, ThreadPoolExecutor aggregation,
per-code 7/30/60/90/life ratios) and the output JSON structure are identical. Writes scratchpad/roi-horizon-{MK}.json.

PORT NOTES (CH -> DuckDB, store-backed):
  * SITE_edit is CONSTANT ('WS1') so its joins inline. SITE is NOT constant: the MYR/SGD snapshots carry
    MULTIPLE brands per currency (a member can have WS1_MYS_MYR rows in partition A AND e.g. QPRO10 rows in
    partition BC). The bonus's SITE is always the market LOGSITE (WS1_MYS_MYR / WS1_SGP_SGD), and the live
    query's member_baseline/activity joins include b.SITE=act.SITE — i.e. they restrict NGR to that one
    SITE, EXCLUDING cross-brand NGR. So store_b carries a `site` column and both NGR reads filter
    site=LOGSITE. (Deposit analyses deliberately drop SITE and sum cross-brand; NGR here does not.)
  * all_bonuses_raw -> store_claims (cur + status-already-baked + BonusAmount>0 baked; date via cd=toDate(bt)).
    store_claims.code is trimBoth(BonusCode); the live query trims only at output, so trimming is the sole
    structural divergence on the claim side — verified empirically to touch 0 target-code rows (costs tie exactly).
  * member_baseline / activity NGR -> store_b RAW UNION (NOT pre-grouped), filtered site=LOGSITE: a member-day
    present in both the A and BC partitions UNDER THE SAME SITE carries >1 row and the live raw-union join fans
    out across them (double-counts the baseline subtraction on those days) — keeping store_b raw reproduces that.
    store_b's (dep>0 OR ngr!=0) build filter drops only ngr=0 rows, which contribute 0 to every SUM(NGR).
    store_b starts 2025-11-01 so the 14-day baseline lookback to START-21 is covered.
  * member_day_totals (concurrency denominator) -> store_claims, expand each bonus over W forward days.
  * uniqExact->count(DISTINCT); any->n/a; multiIf->CASE; addDays(d,n)->d+n; subtractDays(d,n)->d-n;
    toDate->CAST AS DATE; ifNull->COALESCE; trimBoth->trim; numbers(W)->UNNEST(range(W)).

Run: PROMO_MARKET=MY python bin/preagg/produce_bonus_roi_horizon.py   (PROMO_MARKET=SG for SG)
"""
import sys, os, json
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import duckdb
from csir_config import CURRENCY, SITE_EDIT, LOGSITE, START, END_INCL, AS_OF_DATE, MARKET, SYMBOL

SCR = Path(os.environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
CLAIMS = os.path.join(STORE, "store_claims.parquet").replace("\\", "/")
STOREB = os.path.join(STORE, "store_b.parquet").replace("\\", "/")
WINS = [7, 30, 60, 90]


def build_sql(inlist, W, flat=False):
    d0, d1 = date.fromisoformat(START), date.fromisoformat(END_INCL)
    endW = (d1 + timedelta(days=W - 1)).isoformat()
    start7 = (d0 - timedelta(days=7)).isoformat()
    start21 = (d0 - timedelta(days=21)).isoformat()
    # endW1 (= d1 + W) is the live all_bonuses_raw upper bound on BonusTime; as a DATE bound on cd it is
    # inclusive endW (= endW1 - 1 day), since the live timestamp bound is '{endW1} 00:00:00' (exclusive).
    weight = "b.BonusAmount" if flat else f"b.BonusAmount*({W}.0-CAST(days.daynum AS DOUBLE))/{W}.0"
    return f"""
    WITH
    all_bonuses_raw AS (
        SELECT member, CAST(cd AS DATE) AS bd, code AS BonusCode, bonus AS BonusAmount
        FROM read_parquet('{CLAIMS}')
        WHERE cur='{CURRENCY}' AND CAST(cd AS DATE) >= DATE '{start7}' AND CAST(cd AS DATE) <= DATE '{endW}'
    ),
    bonuses AS (SELECT member, bd AS bonus_date, BonusCode, SUM(BonusAmount) AS BonusAmount
                FROM all_bonuses_raw GROUP BY member, bd, BonusCode),
    ret_bonuses AS (SELECT * FROM bonuses WHERE BonusCode IN ({inlist})),
    member_baseline AS (
        SELECT b.member, b.bonus_date, SUM(act.ngr)/14.0 AS avg_ngr
        FROM (SELECT src.member, src.bonus_date, (src.bonus_date - (n.n+1)) AS baseline_date
              FROM (SELECT DISTINCT member, bonus_date FROM ret_bonuses) src
              CROSS JOIN (SELECT CAST(UNNEST(range(14)) AS INTEGER) AS n) n) b
        LEFT JOIN (
            SELECT member, CAST(sd AS DATE) AS SnapshotDate, ngr FROM read_parquet('{STOREB}')
            WHERE cur='{CURRENCY}' AND site='{LOGSITE}' AND CAST(sd AS DATE) >= DATE '{start21}' AND CAST(sd AS DATE) <= DATE '{END_INCL}'
        ) act ON b.member=act.member AND b.baseline_date=act.SnapshotDate
        GROUP BY b.member, b.bonus_date),
    activity AS (
        SELECT member, CAST(sd AS DATE) AS SnapshotDate, ngr AS raw_ngr FROM read_parquet('{STOREB}')
        WHERE cur='{CURRENCY}' AND site='{LOGSITE}' AND CAST(sd AS DATE) >= DATE '{START}' AND CAST(sd AS DATE) <= DATE '{endW}' AND ngr != 0),
    member_day_totals AS (
        SELECT b.member, (b.bonus_date + n.n) AS SnapshotDate, SUM(b.BonusAmount) AS total_active_amount
        FROM bonuses b CROSS JOIN (SELECT CAST(UNNEST(range({W})) AS INTEGER) AS n) n
        WHERE (b.bonus_date + n.n) >= DATE '{START}' AND (b.bonus_date + n.n) <= DATE '{endW}'
        GROUP BY b.member, (b.bonus_date + n.n)),
    joined AS (
        SELECT b.BonusCode, b.member,
            COALESCE(a.raw_ngr,0)-COALESCE(mb.avg_ngr,0) AS incr_ngr, {weight} AS w, mdt.total_active_amount
        FROM ret_bonuses b CROSS JOIN (SELECT CAST(UNNEST(range({W})) AS INTEGER) AS daynum) AS days
        LEFT JOIN activity a ON b.member=a.member AND (b.bonus_date + days.daynum)=a.SnapshotDate
        LEFT JOIN member_baseline mb ON b.member=mb.member AND b.bonus_date=mb.bonus_date
        LEFT JOIN member_day_totals mdt ON b.member=mdt.member AND (b.bonus_date + days.daynum)=mdt.SnapshotDate
        WHERE (b.bonus_date + days.daynum) >= DATE '{START}' AND (b.bonus_date + days.daynum) <= DATE '{endW}'
          AND b.bonus_date >= DATE '{START}' AND b.bonus_date <= DATE '{END_INCL}'),
    member_attrib AS (SELECT BonusCode, member, SUM(incr_ngr*w/total_active_amount) AS lift FROM joined GROUP BY BonusCode, member),
    pml AS (SELECT BonusCode, member, sum(BonusAmount) bonus_cost, min(bd) claim_date
            FROM all_bonuses_raw WHERE bd>=DATE '{START}' AND bd<=DATE '{END_INCL}' AND BonusCode IN ({inlist})
            GROUP BY BonusCode, member)
    SELECT trim(a.BonusCode) code, p.bonus_cost bonus_cost, a.lift lift, p.claim_date claim_date
    FROM member_attrib a INNER JOIN pml p ON a.BonusCode=p.BonusCode AND a.member=p.member
    """


def main(mk):
    va = json.load(open(SCR / f"verify-action-{mk}.json", encoding="utf-8"))
    codes = sorted({o["code"] for o in va["codes"] if o["pillar"] in ("Retention", "VIP")})
    if not codes:
        print(f"[{mk}] none"); return {}
    inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)
    from collections import defaultdict
    from concurrent.futures import ThreadPoolExecutor
    out = defaultdict(dict)
    life_W = (AS_OF_DATE - date.fromisoformat(START)).days + 1
    windows = [(7, False, "7"), (14, False, "14"), (21, False, "21"), (28, False, "28"),
               (30, False, "30"), (60, False, "60"), (90, False, "90"), (life_W, True, "life")]

    def run_window(args):
        W, flat, key = args
        con = duckdb.connect()                      # own connection per task — DuckDB conns aren't shared across threads
        rows = con.execute(build_sql(inlist, W, flat)).fetchall()
        con.close()
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
    # Bounded (ROI_CONCURRENCY, default 3) to keep concurrent DuckDB memory pressure modest.
    with ThreadPoolExecutor(max_workers=int(os.environ.get("ROI_CONCURRENCY", "3"))) as ex:
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
