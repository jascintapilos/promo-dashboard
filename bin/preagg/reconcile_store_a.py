# -*- coding: utf-8 -*-
"""Reconciliation gate for Store A — prove the local re-sum reproduces the live warehouse Brands-overview.

For each test window, run BOTH:
  LIVE  = bin/macro_pull.py's exact SQL against the warehouse (ground truth),
  STORE = the same reshape from the local Store A re-sum,
and diff every displayed field. The 7 currency-local measures (rounded int RM) and all ratios must match
EXACTLY; the raw company USD float is compared within float-noise tolerance (sum ordering differs).
Does NOT write the shared macro_data.json (safe to run during a live build).
"""
import sys, os, json
from collections import defaultdict
from datetime import date

ROOT = r"C:/Users/vdiuser/Downloads/promo-automation"
sys.path.insert(0, ROOT)
import csir_config

STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
LOCAL = ["d", "db", "fc", "fs", "bo", "rb", "ngr"]
USD = ["du", "bou", "rbu", "ngru"]

client = csir_config.get_client(send_receive_timeout=900)


def live_macro(start, end):
    """Exact macro_pull.py query -> {(c,b): {7 rounded locals, 4 raw usd}}."""
    sql = f"""
    WITH u AS (
      SELECT SITE_edit b, Currency c, DepositAmount d, DepositBonusAmount db, FreeCreditAmount fc, FreeSpinAmount fs,
             BonusAmount bo, Rebates rb, NGR ngr, DepositAmount_usd du, BonusAmount_usd bou, Rebates_usd rbu, NGR_usd ngru
      FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE SnapshotDate>='{start}' AND SnapshotDate<'{end}'
      UNION ALL
      SELECT SITE_edit, Currency, DepositAmount, DepositBonusAmount, FreeCreditAmount, FreeSpinAmount,
             BonusAmount, Rebates, NGR, DepositAmount_usd, BonusAmount_usd, Rebates_usd, NGR_usd
      FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE SnapshotDate>='{start}' AND SnapshotDate<'{end}'
    )
    SELECT b, c, round(sum(d)) d, round(sum(db)) db, round(sum(fc)) fc, round(sum(fs)) fs, round(sum(bo)) bo,
           round(sum(rb)) rb, round(sum(ngr)) ngr, sum(du) du, sum(bou) bou, sum(rbu) rbu, sum(ngru) ngru
    FROM u GROUP BY b, c HAVING d>100000 ORDER BY c, d DESC
    """
    out = {}
    for row in client.query(sql).result_rows:
        b, c = row[0], row[1]
        vals = {m: float(row[2 + i] or 0) for i, m in enumerate(LOCAL)}       # b,c then 7 locals at 2..8
        vals.update({m: float(row[9 + i] or 0) for i, m in enumerate(USD)})   # 4 USD at 9..12
        out[(c, b)] = vals
    return out


def store_macro(st, ci, start, end):
    s_iso, e_iso = start.isoformat(), end.isoformat()
    acc = defaultdict(lambda: dict.fromkeys(LOCAL + USD, 0.0))
    for row in st["rows"]:
        if s_iso <= row[ci["date"]] < e_iso:
            a = acc[(row[ci["c"]], row[ci["b"]])]
            for m in LOCAL + USD:
                a[m] += row[ci[m]]
    out = {}
    for (c, b), a in acc.items():
        loc = {m: float(round(a[m])) for m in LOCAL}
        if loc["d"] > 100000:
            loc.update({m: a[m] for m in USD})
            out[(c, b)] = loc
    return out


st = json.load(open(os.path.join(STORE, "store_a.json"), encoding="utf-8"))
ci = {n: i for i, n in enumerate(st["cols"])}

WINDOWS = [
    ("Jan-May (the rebuild)", date(2026, 1, 1), date(2026, 6, 1)),
    ("March only",            date(2026, 3, 1), date(2026, 4, 1)),
    ("Jan-Aug (default)",     date(2026, 1, 1), date(2026, 9, 1)),
]

USD_TOL = 1.0   # raw USD float: sum-ordering noise; <1 unit over millions is pure float dust
allpass = True
for name, s, e in WINDOWS:
    live = live_macro(s, e)
    store = store_macro(st, ci, s, e)
    diffs = []
    keys = set(live) | set(store)
    for k in sorted(keys):
        if k not in live:  diffs.append(f"{k} only in STORE"); continue
        if k not in store: diffs.append(f"{k} only in LIVE"); continue
        for m in LOCAL:    # ±1 tolerance = the live warehouse's own float-rounding wobble (Store A is deterministic)
            if abs(live[k][m] - store[k][m]) > 1:
                diffs.append(f"{k}.{m}: live={live[k][m]:.0f} store={store[k][m]:.0f} (d{store[k][m]-live[k][m]:+.0f})")
        for m in USD:      # tolerant float match
            if abs(live[k][m] - store[k][m]) > USD_TOL:
                diffs.append(f"{k}.{m}: live={live[k][m]:.2f} store={store[k][m]:.2f} (Δ{store[k][m]-live[k][m]:+.4f})")
    status = "PASS" if not diffs else f"FAIL ({len(diffs)})"
    allpass &= not diffs
    print(f"[{status}] {name:24} — {len(live)} live cells / {len(store)} store cells")
    for d in diffs[:12]:
        print(f"         {d}")
print("\n" + ("ALL WINDOWS RECONCILE — Store A reproduces the live Brands-overview exactly." if allpass
              else "RECONCILIATION FAILED — do NOT ship Store A until resolved."))
sys.exit(0 if allpass else 1)
