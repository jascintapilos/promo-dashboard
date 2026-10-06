# -*- coding: utf-8 -*-
"""Pre-agg Store A — nightly daily money rollup (SnapshotDate x SITE_edit x Currency).

The Brands-overview tab (bin/macro_pull.py) is 100% additive: every number is a plain SUM of
member-day money columns, collapsed to brand x currency. This store pre-sums those columns to a
compact (date, brand, currency) grain ONCE, so any window re-sums it locally in milliseconds.

CORRECTNESS: carry RAW (unrounded) daily sums of the 7 currency-local columns AND the 4 USD columns,
UNFILTERED (no HAVING, no window). macro_pull rounds the 7 locals and applies HAVING d>100000 only
AFTER summing the whole window, and sums the USD columns raw over the HAVING survivors — so the
window-summer (macro_from_store_a.py) must defer rounding + HAVING to read-time. Storing rounded or
HAVING-filtered daily cells would drift.

Out: <PROMO_PREAGG>/store_a.json
     { built_at, date_min, date_max, n_rows, cols:[...], rows:[[date,b,c, d,db,fc,fs,bo,rb,ngr, du,bou,rbu,ngru], ...] }
"""
import sys, os, json
from datetime import datetime, timezone

ROOT = r"C:/Users/vdiuser/Downloads/promo-automation"
sys.path.insert(0, ROOT)
import csir_config

STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
FROM = os.environ.get("STORE_A_FROM", "2026-01-01")   # the refresh picker's floor; nightly covers FROM..max(data)

c = csir_config.get_client(send_receive_timeout=900)
mx = c.query("SELECT max(SnapshotDate) FROM WORKSPACE.Daily_GMT8_Snapshot_A").result_rows[0][0]
mx = str(mx)[:10]

sql = f"""
WITH u AS (
  SELECT SnapshotDate sd, SITE_edit b, Currency cu,
         DepositAmount d, DepositBonusAmount db, FreeCreditAmount fc, FreeSpinAmount fs,
         BonusAmount bo, Rebates rb, NGR ngr,
         DepositAmount_usd du, BonusAmount_usd bou, Rebates_usd rbu, NGR_usd ngru
  FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE SnapshotDate >= '{FROM}'
  UNION ALL
  SELECT SnapshotDate, SITE_edit, Currency,
         DepositAmount, DepositBonusAmount, FreeCreditAmount, FreeSpinAmount,
         BonusAmount, Rebates, NGR, DepositAmount_usd, BonusAmount_usd, Rebates_usd, NGR_usd
  FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE SnapshotDate >= '{FROM}'
)
SELECT toString(sd), b, cu,
       sum(d), sum(db), sum(fc), sum(fs), sum(bo), sum(rb), sum(ngr),
       sum(du), sum(bou), sum(rbu), sum(ngru)
FROM u GROUP BY sd, b, cu
"""
rows = c.query(sql).result_rows

data = {
    "built_at": datetime.now(timezone.utc).isoformat(),
    "date_min": FROM, "date_max": mx, "n_rows": len(rows),
    "cols": ["date", "b", "c", "d", "db", "fc", "fs", "bo", "rb", "ngr", "du", "bou", "rbu", "ngru"],
    # raw (unrounded) daily sums; keep floats
    "rows": [[r[0][:10], r[1], r[2]] + [float(x or 0) for x in r[3:]] for r in rows],
}
os.makedirs(STORE, exist_ok=True)
tmp = os.path.join(STORE, "store_a.json.tmp")
dst = os.path.join(STORE, "store_a.json")
json.dump(data, open(tmp, "w"), separators=(",", ":"))
os.replace(tmp, dst)   # atomic
print(f"Store A -> {dst}")
print(f"  {len(rows)} (date,brand,currency) rows, {FROM} .. {mx}")
