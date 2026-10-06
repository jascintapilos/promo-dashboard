# -*- coding: utf-8 -*-
"""Reconciliation gate for Store B — prove the local DuckDB recompute reproduces the live warehouse
segment-map (value×state grid) for any window.

LIVE  = bin/segment_map_pull.py's exact ClickHouse query.
STORE = the same logic re-expressed in DuckDB over store_b.parquet.
members + ngr must match (ngr within ±1 rounding). med_dep is compared with tolerance: ClickHouse
median() is an approximate (reservoir) quantile for cells >8192 members, so an exact DuckDB median can
differ there — a few % is the warehouse's own imprecision, not a Store B error.
"""
import sys, os
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
import csir_config
import duckdb

STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
PARQUET = os.path.join(STORE, "store_b.parquet").replace("\\", "/")
START, END_EXCL, END_INCL = csir_config.START, csir_config.END_EXCL, csir_config.END_INCL
client = csir_config.get_client(send_receive_timeout=600)


def live(CUR):
    q = f"""
    WITH m AS (
      SELECT MEMBER_ID, sum(dep) AS ytd_dep, sum(ngr) AS ytd_ngr, max(if(dep>0, sd, toDate('2000-01-01'))) AS last_dep
      FROM (
        SELECT MEMBER_ID, SnapshotDate sd, DepositAmount dep, NGR ngr FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND SnapshotDate>='{START}' AND SnapshotDate<'{END_EXCL}'
        UNION ALL
        SELECT MEMBER_ID, SnapshotDate, DepositAmount, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND SnapshotDate>='{START}' AND SnapshotDate<'{END_EXCL}'
      ) GROUP BY MEMBER_ID HAVING ytd_dep > 0
    )
    SELECT multiIf(ytd_dep>=100000,'Whale', ytd_dep>=20000,'High', ytd_dep>=2000,'Mid','Low') AS vband,
      multiIf(dateDiff('day',last_dep,toDate('{END_INCL}'))<=30,'Active', dateDiff('day',last_dep,toDate('{END_INCL}'))<=60,'Cooling',
              dateDiff('day',last_dep,toDate('{END_INCL}'))<=90,'Lapsed','Dormant') AS state,
      count() AS members, round(sum(ytd_ngr)) AS ngr, round(median(ytd_dep)) AS med_dep
    FROM m GROUP BY vband, state
    """
    return {(vb, st): (int(mem), float(ngr or 0), float(md or 0)) for vb, st, mem, ngr, md in client.query(q).result_rows}


def store(CUR):
    q = f"""
    WITH m AS (
      SELECT member, sum(dep) AS ytd_dep, sum(ngr) AS ytd_ngr,
             max(CASE WHEN dep>0 THEN CAST(sd AS DATE) ELSE DATE '2000-01-01' END) AS last_dep
      FROM read_parquet('{PARQUET}')
      WHERE cur='{CUR}' AND sd>='{START}' AND sd<'{END_EXCL}'
      GROUP BY member HAVING sum(dep) > 0
    )
    SELECT CASE WHEN ytd_dep>=100000 THEN 'Whale' WHEN ytd_dep>=20000 THEN 'High' WHEN ytd_dep>=2000 THEN 'Mid' ELSE 'Low' END AS vband,
      CASE WHEN date_diff('day', last_dep, DATE '{END_INCL}')<=30 THEN 'Active'
           WHEN date_diff('day', last_dep, DATE '{END_INCL}')<=60 THEN 'Cooling'
           WHEN date_diff('day', last_dep, DATE '{END_INCL}')<=90 THEN 'Lapsed' ELSE 'Dormant' END AS state,
      count(*) AS members, round(sum(ytd_ngr)) AS ngr, round(median(ytd_dep)) AS med_dep
    FROM m GROUP BY vband, state
    """
    return {(r[0], r[1]): (int(r[2]), float(r[3] or 0), float(r[4] or 0)) for r in duckdb.sql(q).fetchall()}


print(f"window {START} .. {END_EXCL}  (recency anchor {END_INCL})")
allok = True
for MK, CUR in (("MY", "MYR"), ("SG", "SGD")):
    L, S = live(CUR), store(CUR)
    diffs = []
    for k in sorted(set(L) | set(S)):
        if k not in L or k not in S:
            diffs.append(f"{k} only in {'LIVE' if k in L else 'STORE'}"); continue
        (lm, ln, lmd), (sm, sn, smd) = L[k], S[k]
        if lm != sm: diffs.append(f"{k} members live={lm} store={sm}")
        if abs(ln - sn) > 1: diffs.append(f"{k} ngr live={ln:.0f} store={sn:.0f}")
        tol = max(50.0, 0.03 * max(abs(lmd), abs(smd)))   # CH approximate-median tolerance
        if abs(lmd - smd) > tol: diffs.append(f"{k} med_dep live={lmd:.0f} store={smd:.0f} (>{tol:.0f})")
    tm = sum(v[0] for v in L.values())
    print(f"[{'PASS' if not diffs else 'FAIL'}] {MK} — {len(L)} cells, {tm:,} members" + ("" if not diffs else f" ({len(diffs)} diffs)"))
    for d in diffs[:12]:
        print("        " + d)
    allok &= not diffs
print("\n" + ("Store B reconciles — value-bands reproduce the live warehouse." if allok else "RECONCILE FAILED."))
sys.exit(0 if allok else 1)
