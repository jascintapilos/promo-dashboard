#!/usr/bin/env python3
"""Compute VIP + whale lifecycle-stage breakdown (spend share + 7-day return per RM
by recency-of-last-deposit), mirroring the Retention `by_recency` card.

Reads the already-pulled VIP claim-rows + member-ledger + metrics from the scratchpad
(no DB needed) and writes scratchpad/vip/lifecycle-<MK>.json = {market, sym, vip:[], whale:[]}.
Whales = members whose YTD NGR >= the whale threshold in vip-metrics (top 1%).

Usage: SCRATCH=<scratchpad dir> python bin/vip_report/build_lifecycle.py
"""
import json, os, sys

SCRATCH = os.environ.get("SCRATCH") or (sys.argv[1] if len(sys.argv) > 1 else None)
if not SCRATCH:
    sys.exit("set SCRATCH env or pass the scratchpad dir as argv[1]")

BUCKETS = [
    ("active 0-14d",      lambda d: d is not None and d <= 14),
    ("cooling 15-30d",    lambda d: d is not None and 14 < d <= 30),
    ("dormant 31-60d",    lambda d: d is not None and 30 < d <= 60),
    ("lapsed 60-120d",    lambda d: d is not None and 60 < d <= 120),
    ("no recent deposit (120d+)", lambda d: d is None or d > 120),  # incl. no prior deposit
]

def bucket_of(d):
    for name, test in BUCKETS:
        if test(d):
            return name
    return "no recent deposit (120d+)"

def aggregate(rows):
    """rows -> ordered list of {bucket,n,spend,ngr_lift,ngr_lift_per_rm,redeposit_rate}."""
    acc = {name: {"members": set(), "spend": 0.0, "ngr": 0.0, "m30": 0, "redep": 0} for name, _ in BUCKETS}
    for r in rows:
        if not r.get("mature_7"):
            continue  # per-RM basis = matured 7-day windows, matching the VIP lane read
        b = acc[bucket_of(r.get("recency_days"))]
        b["members"].add(r.get("member"))
        b["spend"] += r.get("bonus_cost") or 0
        b["ngr"] += r.get("ngr_lift") or 0
        if r.get("mature_30"):
            b["m30"] += 1
            if (r.get("dep_days_30") or 0) > 0:
                b["redep"] += 1
    out = []
    for name, _ in BUCKETS:
        b = acc[name]
        if b["spend"] <= 0 and not b["members"]:
            continue
        out.append({
            "bucket": name,
            "n": len(b["members"]),
            "spend": round(b["spend"]),
            "ngr_lift": round(b["ngr"]),
            "ngr_lift_per_rm": round(b["ngr"] / b["spend"], 2) if b["spend"] else None,
            "redeposit_rate": round(100 * b["redep"] / b["m30"], 1) if b["m30"] else None,
        })
    return out

for MK, SYM in (("MY", "RM"), ("SG", "S$")):
    base = os.path.join(SCRATCH, "vip")
    try:
        claims = json.load(open(os.path.join(base, f"claim-rows-{MK}.json"), encoding="utf-8"))
        ledger = json.load(open(os.path.join(base, f"member-ledger-{MK}.json"), encoding="utf-8"))
        metrics = json.load(open(os.path.join(base, f"vip-metrics-{MK}.json"), encoding="utf-8"))
    except FileNotFoundError as e:
        print(f"[{MK}] skip — {e}")
        continue
    thr = (metrics.get("whale_pillar") or {}).get("definition", {}).get("threshold_ngr")
    whales = set()
    if thr:
        whales = {str(m.get("member")) for m in ledger if (m.get("ytd_ngr") or 0) >= thr}
    vip_life = aggregate(claims)
    whale_life = aggregate([r for r in claims if str(r.get("member")) in whales]) if whales else []
    out = {"market": MK, "currency": metrics.get("currency"), "sym": SYM,
           "whale_count": len(whales), "vip": vip_life, "whale": whale_life,
           "basis": "Every VIP bonus bucketed by how recently the player last deposited (recency_days at claim). "
                    "Spend + NGR lift over matured 7-day windows; per-RM is the 7-day read (VIP is judged on the 90-day for performance)."}
    path = os.path.join(base, f"lifecycle-{MK}.json")
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[{MK}] wrote {path} — vip {len(vip_life)} stages, whale {len(whale_life)} stages ({len(whales)} whales)")
