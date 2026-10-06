# -*- coding: utf-8 -*-
"""Pre-agg Store B — member active-day (the segmentation / value-band base).

One row per (member, snapshot_date, currency) where DepositAmount>0 OR NGR!=0, from Daily_GMT8_Snapshot_A
AND _BC UNIONED (NOT grouped — the two are disjoint brand partitions; grouping per member happens at
read time so a member who spans brands bands on their COMBINED deposit). Covers the picker range (2026+),
markets MYR + SGD. Written as Parquet (DuckDB reads it natively) — the window recompute re-aggregates it
locally in ms instead of re-scanning the remote warehouse.

Serves: segment_map (value×state grid), trial_band (band×tier), segment_migration (two-anchor flow).
Out: <PROMO_PREAGG>/store_b.parquet
"""
import sys, os, json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
import csir_config

STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
FROM = os.environ.get("STORE_B_FROM", "2026-01-01")
os.makedirs(STORE, exist_ok=True)

c = csir_config.get_client(send_receive_timeout=1800)
mx = str(c.query("SELECT max(SnapshotDate) FROM WORKSPACE.Daily_GMT8_Snapshot_A").result_rows[0][0])[:10]

sql = f"""
SELECT MEMBER_ID AS member, toString(SnapshotDate) AS sd, Currency AS cur,
       DepositAmount AS dep, NGR AS ngr
FROM (
  SELECT MEMBER_ID, SnapshotDate, Currency, DepositAmount, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE SnapshotDate >= '{FROM}' AND Currency IN ('MYR','SGD') AND (DepositAmount>0 OR NGR!=0)
  UNION ALL
  SELECT MEMBER_ID, SnapshotDate, Currency, DepositAmount, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE SnapshotDate >= '{FROM}' AND Currency IN ('MYR','SGD') AND (DepositAmount>0 OR NGR!=0)
)
"""
pq = c.raw_query(sql, fmt="Parquet")   # columnar export — no python per-row handling
tmp = os.path.join(STORE, "store_b.parquet.tmp")
dst = os.path.join(STORE, "store_b.parquet")
with open(tmp, "wb") as f:
    f.write(pq)
os.replace(tmp, dst)

# a tiny sidecar manifest (built_at + coverage) for the recompute/freshness checks
import duckdb
n, dmin, dmax = duckdb.sql(f"SELECT count(*), min(sd), max(sd) FROM read_parquet('{dst.replace(chr(92),'/')}')").fetchone()
json.dump({"built_at": datetime.now(timezone.utc).isoformat(), "date_min": dmin, "date_max": dmax, "n_rows": n, "data_max": mx},
          open(os.path.join(STORE, "store_b.meta.json"), "w"))
print(f"Store B -> {dst}")
print(f"  {n:,} member-active-day rows, {dmin} .. {dmax}  ({os.path.getsize(dst)/1e6:.1f} MB)")
