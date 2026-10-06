# -*- coding: utf-8 -*-
"""Window-summer for the Brands-overview tab — reproduces bin/macro_pull.py from the local Store A.

Given a window (csir_config START/END_EXCL when WINDOW_EXPLICIT, else auto-YTD through the last complete
month, exactly like macro_pull), re-sum Store A's raw daily cells over the date range and emit the SAME
macro_data.json structure. Milliseconds, no warehouse.

Faithful to macro_pull's four gotchas:
  (1) 7 currency-local measures are round(sum) of the RAW window sum; the 4 USD measures are raw sum.
  (2) HAVING d>100000 is applied to the ROUNDED whole-window deposit, AFTER the re-sum (never per day).
  (3) company USD sums the USD columns ONLY over brand/currency groups that survive the local HAVING.
  (4) bon_pct/br_pct/mg are recomputed from the rounded numerator/denominator, never averaged.

Out: <PROMO_PREAGG>/macro_data_storeA.json   (same shape as scratchpad/macro_data.json)
"""
import sys, os, json
from collections import defaultdict
from datetime import date

ROOT = r"C:/Users/vdiuser/Downloads/promo-automation"
sys.path.insert(0, ROOT)
import csir_config

STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
CURMAP = {"MYR": "Malaysia", "SGD": "Singapore", "THB": "Thailand", "IDR": "Indonesia",
          "BDT": "Bangladesh", "VND": "Vietnam", "USD": "Cambodia"}
SYM = {"MYR": "RM", "SGD": "S$", "THB": "\u0e3f", "IDR": "Rp", "BDT": "\u09f3", "VND": "\u20ab", "USD": "US$"}

st = json.load(open(os.path.join(STORE, "store_a.json"), encoding="utf-8"))
ci = {name: i for i, name in enumerate(st["cols"])}

# ---- window (mirror macro_pull.py) ----
if getattr(csir_config, "WINDOW_EXPLICIT", False):
    start = date.fromisoformat(csir_config.START)
    end = date.fromisoformat(csir_config.END_EXCL)
else:
    mx = date.fromisoformat(st["date_max"])
    end = mx.replace(day=1); start = end.replace(month=1, day=1)   # auto-YTD, Jan 1 .. first of latest month
s_iso, e_iso = start.isoformat(), end.isoformat()

# ---- re-sum raw daily cells over [start, end) by (brand, currency) ----
MEAS = ["d", "db", "fc", "fs", "bo", "rb", "ngr", "du", "bou", "rbu", "ngru"]
acc = defaultdict(lambda: dict.fromkeys(MEAS, 0.0))
for row in st["rows"]:
    if s_iso <= row[ci["date"]] < e_iso:
        a = acc[(row[ci["b"]], row[ci["c"]])]
        for m in MEAS:
            a[m] += row[ci[m]]

# ---- round the 7 locals, keep USD raw, apply HAVING round(d)>100000 (gotchas 1 & 2) ----
LOCAL = ["d", "db", "fc", "fs", "bo", "rb", "ngr"]
survivors = []
for (b, c), a in acc.items():
    loc = {m: float(round(a[m])) for m in LOCAL}
    if loc["d"] > 100000:
        survivors.append((b, c, loc, {k: a[k] for k in ("du", "bou", "rbu", "ngru")}))
survivors.sort(key=lambda x: (x[1], -x[2]["d"]))   # ORDER BY c, d DESC

# ---- reshape identically to macro_pull (gotchas 3 & 4) ----
regs = {}; comp = {"d": 0.0, "bo": 0.0, "rb": 0.0, "ngr": 0.0}
for b, c, loc, usd in survivors:
    d, db, fc, fs, bo, rb, ngr = (loc[k] for k in LOCAL)
    r = regs.setdefault(c, {"region": CURMAP.get(c, c), "cur": c, "sym": SYM.get(c, c + " "),
                            "brands": [], "d": 0, "db": 0, "fc": 0, "fs": 0, "bo": 0, "rb": 0, "ngr": 0})
    r["brands"].append({"b": b, "d": d, "db": db, "fc": fc, "fs": fs, "bo": bo, "rb": rb, "ngr": ngr,
                        "bon_pct": round(bo / d * 100, 1) if d else 0,
                        "br_pct": round((bo + rb) / d * 100, 1) if d else 0,
                        "mg": round(ngr / d * 100, 1) if d else 0})
    for k, v in zip(("d", "db", "fc", "fs", "bo", "rb", "ngr"), (d, db, fc, fs, bo, rb, ngr)):
        r[k] += v
    comp["d"] += float(usd["du"]); comp["bo"] += float(usd["bou"]); comp["rb"] += float(usd["rbu"]); comp["ngr"] += float(usd["ngru"])
for r in regs.values():
    r["bon_pct"] = round(r["bo"] / r["d"] * 100, 1) if r["d"] else 0
    r["br_pct"] = round((r["bo"] + r["rb"]) / r["d"] * 100, 1) if r["d"] else 0
    r["mg"] = round(r["ngr"] / r["d"] * 100, 1) if r["d"] else 0
company = {"dep_usd": comp["d"], "bon_pct": round(comp["bo"] / comp["d"] * 100, 1) if comp["d"] else 0,
           "br_pct": round((comp["bo"] + comp["rb"]) / comp["d"] * 100, 1) if comp["d"] else 0,
           "mg": round(comp["ngr"] / comp["d"] * 100, 1) if comp["d"] else 0}
out = {"window_start": str(start), "window_end": str(end), "company": company,
       "regions": sorted(regs.values(), key=lambda r: -r["d"])}
json.dump(out, open(os.path.join(STORE, "macro_data_storeA.json"), "w"), indent=1)
print("window", start, "..", end, "| from Store A")
print(f"COMPANY-WIDE (USD): Bonus% {company['bon_pct']}  Bonus+Rebate% {company['br_pct']}  NGR margin {company['mg']}  (dep US${company['dep_usd']/1e6:.1f}m)")
for r in out["regions"]:
    print(f"  {r['region']:<11} {len(r['brands'])}br  Bonus% {r['bon_pct']:>4}  B+R% {r['br_pct']:>4}  NGRmg {r['mg']:>5}")
