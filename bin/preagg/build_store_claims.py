# -*- coding: utf-8 -*-
"""Pre-agg Store C(claims) — one row per bonus claim (the base for the heavy claim×deposit analyses).

All WS1 bonus claims (member, code, claim_day, currency, bonus) 2026+, markets MYR+SGD, with the
standard active-status filter already applied. A per-window recompute filters this to the window's
date range + in-scope action codes and joins it with Store B (deposits) locally — the heavy
equal-split / deposit-timing / behaviour analyses that dominate the 3-min build.

Out: <PROMO_PREAGG>/store_claims.parquet
"""
import sys, os, json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
import csir_config

STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
FROM = os.environ.get("STORE_CLAIMS_FROM", "2026-01-01")
SITE = csir_config.SITE_EDIT
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
os.makedirs(STORE, exist_ok=True)

c = csir_config.get_client(send_receive_timeout=1800)
sql = f"""
SELECT MEMBER_ID AS member, trimBoth(BonusCode) AS code, toString(toDate(BonusTime_gmt8)) AS cd,
       Currency AS cur, BonusAmount AS bonus, BonusTime_gmt8 AS bt
FROM WORKSPACE.GetBonus_ABC
WHERE SITE_edit='{SITE}' AND Currency IN ('MYR','SGD') AND BonusAmount>0 AND BonusStatus IN {STATUSES}
  AND toDate(BonusTime_gmt8) >= '{FROM}'
"""
pq = c.raw_query(sql, fmt="Parquet")
tmp = os.path.join(STORE, "store_claims.parquet.tmp")
dst = os.path.join(STORE, "store_claims.parquet")
with open(tmp, "wb") as f:
    f.write(pq)
os.replace(tmp, dst)

import duckdb
n, cmin, cmax, ncodes = duckdb.sql(f"SELECT count(*), min(cd), max(cd), count(DISTINCT code) FROM read_parquet('{dst.replace(chr(92),'/')}')").fetchone()
json.dump({"built_at": datetime.now(timezone.utc).isoformat(), "date_min": cmin, "date_max": cmax, "n_rows": n, "n_codes": ncodes},
          open(os.path.join(STORE, "store_claims.meta.json"), "w"))
print(f"Store C(claims) -> {dst}")
print(f"  {n:,} claims, {ncodes} codes, {cmin} .. {cmax}  ({os.path.getsize(dst)/1e6:.1f} MB)")
