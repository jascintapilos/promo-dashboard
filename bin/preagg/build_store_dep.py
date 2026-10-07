# -*- coding: utf-8 -*-
"""Pre-agg Store Dep(exact) — exact-timestamp deposits (for the deposit-TIMING analyses).

deposit_classify / deposit_behaviour Section A order deposits vs the claim at exact timestamps
(dedup_Deposit_A.TIME), not daily SnapshotDate — so they need this store, not Store B. One row per
deposit event: (member, time, amount, site). WS1 sites, 2026+, success-ish transaction status.

Out: <PROMO_PREAGG>/store_dep.parquet
"""
import sys, os, json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
import csir_config

STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
FROM = os.environ.get("STORE_DEP_FROM", "2026-01-01")
os.makedirs(STORE, exist_ok=True)

c = csir_config.get_client(send_receive_timeout=1800)
sql = f"""
SELECT MEMBER_ID AS member, TIME AS t, PostProcessAmount AS amt, SITE AS site
FROM WORKSPACE.dedup_Deposit_A
WHERE SITE IN ('WS1_MYS_MYR','WS1_SGP_SGD')
  AND (TransactionStatus IN ('Success','Approved','Completed') OR TransactionStatus='')
  AND TIME >= '{FROM} 00:00:00'
"""
pq = c.raw_query(sql, fmt="Parquet")
tmp = os.path.join(STORE, "store_dep.parquet.tmp")
dst = os.path.join(STORE, "store_dep.parquet")
with open(tmp, "wb") as f:
    f.write(pq)
os.replace(tmp, dst)

import duckdb
n, tmin, tmax = duckdb.sql(f"SELECT count(*), min(CAST(t AS VARCHAR)), max(CAST(t AS VARCHAR)) FROM read_parquet('{dst.replace(chr(92),'/')}')").fetchone()
json.dump({"built_at": datetime.now(timezone.utc).isoformat(), "time_min": str(tmin), "time_max": str(tmax), "n_rows": n},
          open(os.path.join(STORE, "store_dep.meta.json"), "w"))
print(f"Store Dep(exact) -> {dst}")
print(f"  {n:,} deposit events, {tmin} .. {tmax}  ({os.path.getsize(dst)/1e6:.1f} MB)")
