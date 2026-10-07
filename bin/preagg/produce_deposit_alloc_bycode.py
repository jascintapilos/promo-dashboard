#!/usr/bin/env python3
"""STORE-BACKED producer for Overlap-FREE per-code deposits (equal-split) — windows 7/30/90, both markets.

Byte-compatible port of bin/deposit_alloc_bycode_pull.py: the ONLY change is the data source. The
warehouse ClickHouse query is swapped for the VALIDATED DuckDB-over-stores equivalent (the store() SQL
from bin/preagg/reconcile_equal_split.py, which reconciled 0-diff to live). All post-processing and the
exact output JSON structure are identical to the original stage, so the parallel build engine reads the
same deposit-alloc-bycode-{MK}.json — just produced locally and fast.

Each distinct member-deposit-day within W days after a claim is split EQUALLY among ALL in-scope codes
the member claimed in that window, so no deposit is counted twice. Per-code shares sum EXACTLY to the
distinct total at every window. Per-group = sum of per-code within the group (done in assemble).

Out: scratchpad/deposit-alloc-bycode-{MK}.json = { sym, byWindow: {"7":{code:alloc}, "30":..., "90":...}, distinct:{"7":..} }
"""
import sys, os, json
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
from csir_config import START, END_EXCL  # SAME window seam as the original stage
import duckdb

SCR = Path(os.environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STORE = os.environ.get("PROMO_PREAGG", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
CLAIMS = os.path.join(STORE, "store_claims.parquet").replace("\\", "/")
STOREB = os.path.join(STORE, "store_b.parquet").replace("\\", "/")
MK_CFG = {"MY": ("MYR", "RM"), "SG": ("SGD", "S$")}
WINDOWS = (7, 30, 90)


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


for MK, (CUR, SYM) in MK_CFG.items():
    va = load(f"verify-action-{MK}.json")
    if va is None:
        print(f"[{MK}] skip — no verify-action-{MK}.json"); continue
    codes = sorted({co["code"].strip() for co in va["codes"]})
    if not codes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)"); continue  # empty IN (...) is an error
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)
    out = {"sym": SYM, "byWindow": {}, "distinct": {}}
    for W in WINDOWS:
        # Equal-split share, recomputed over store_claims (claims) + store_b (deposits) in DuckDB.
        # Verbatim store() CTE chain from reconcile_equal_split.py (sum+any_value "pre-summed" deps shape):
        #   deps pre-sums DepositAmount per member-day; distinct_deps takes any_value(dep) per member-day.
        rows = duckdb.sql(f"""
          WITH claims AS (
            SELECT code, member, CAST(cd AS DATE) cd FROM read_parquet('{CLAIMS}')
            WHERE cur='{CUR}' AND cd>='{START}' AND cd<'{END_EXCL}' AND code IN ({inlist})
          ),
          deps AS (
            SELECT member, CAST(sd AS DATE) sd, sum(dep) dep FROM read_parquet('{STOREB}')
            WHERE cur='{CUR}' AND dep>0 AND member IN (SELECT member FROM claims)
            GROUP BY member, sd
          ),
          distinct_deps AS (
            SELECT cl.member member, d.sd sd, any_value(d.dep) dep
            FROM claims cl JOIN deps d ON cl.member=d.member
            WHERE d.sd>cl.cd AND d.sd<=cl.cd+INTERVAL {W} DAY GROUP BY cl.member, d.sd
          ),
          pairs AS (   -- distinct (member, deposit-day, code): every code the member claimed within W before the deposit
            SELECT dd.member member, dd.sd sd, cl.code code
            FROM distinct_deps dd JOIN claims cl
              ON dd.member=cl.member AND dd.sd>cl.cd AND dd.sd<=cl.cd+INTERVAL {W} DAY
            GROUP BY dd.member, dd.sd, cl.code
          ),
          cnt AS (SELECT member, sd, count(*) n FROM pairs GROUP BY member, sd)
          SELECT p.code code, round(sum(dd.dep / c2.n)) alloc
          FROM pairs p
          JOIN distinct_deps dd ON p.member=dd.member AND p.sd=dd.sd
          JOIN cnt c2 ON p.member=c2.member AND p.sd=c2.sd
          GROUP BY p.code
        """).fetchall()
        byc = {code.strip(): float(a or 0) for code, a in rows}
        out["byWindow"][str(W)] = {k: round(v) for k, v in byc.items()}
        out["distinct"][str(W)] = round(sum(byc.values()))
        print(f"[{MK}] W={W:>2}d — {len(byc)} codes · per-code equal-split sum = {SYM}{sum(byc.values()):,.0f}")
    json.dump(out, open(SCR / f"deposit-alloc-bycode-{MK}.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"[{MK}] wrote deposit-alloc-bycode-{MK}.json")
print("DONE.")
