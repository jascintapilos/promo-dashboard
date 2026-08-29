#!/usr/bin/env python3
"""Emit the `size_turnover` block into vip-metrics-MY.json.

The pooled size chart says "big bonuses lose", but that conflates size with the
deposit gate and turnover. This isolates them (Lane A, matured claims) so the
report can show that size ALONE is not the decider: a big bonus that is
deposit-required and carries real turnover (~5x) pays; a no-deposit / low-TO one
does not.

Run: python bin/vip_report/size_turnover.py
"""
import json, os

SCR = os.environ.get(
    "VIP_SCR",
    "C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/"
    "879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad",
)
VIPDIR = os.path.join(SCR, "vip")
PATH = os.path.join(VIPDIR, "vip-metrics-MY.json")

j = json.load(open(PATH, encoding="utf-8"))
codes = j.get("codes", []) or []
cmap = {c.get("code"): c for c in codes}
claims = json.load(open(os.path.join(VIPDIR, "claim-rows-MY.json"), encoding="utf-8"))


def acc():
    return {"spend": 0.0, "ngr": 0.0, "dep": 0.0, "n": 0}


def add(d, r):
    d["spend"] += r.get("bonus_cost") or 0
    d["ngr"] += r.get("ngr_lift") or 0
    d["dep"] += r.get("dep_lift") or 0
    d["n"] += 1


def rate(d):
    return {"net_per_rm": round(d["ngr"] / d["spend"], 2) if d["spend"] else None,
            "dep_per_rm": round(d["dep"] / d["spend"], 1) if d["spend"] else None,
            "spend": round(d["spend"]), "n": d["n"]}


big_dep, big_nodep = acc(), acc()          # RM400+ deposit-required vs no-deposit
by_to = {1: acc(), 2: acc(), 5: acc()}     # deposit-required, all sizes, by turnover
big_by_to = {1: acc(), 2: acc(), 5: acc()}  # RM400+ deposit-required, by turnover

for r in claims:
    c = cmap.get(r.get("code"))
    if not c or c.get("lane") != "A-performance" or not r.get("mature_7"):
        continue
    is_big = c.get("size_band") == "RM400+"
    depreq = bool(c.get("deposit_required"))
    to = c.get("wagering_x")
    if is_big:
        add(big_dep if depreq else big_nodep, r)
    if depreq and to in by_to:
        add(by_to[to], r)
        if is_big:
            add(big_by_to[to], r)

size_turnover = {
    "big_dep_vs_nodep": {"deposit_required": rate(big_dep), "no_deposit": rate(big_nodep)},
    "by_turnover": [{"to_x": t, **rate(by_to[t])} for t in (1, 2, 5)],
    "big_by_turnover": [{"to_x": t, **rate(big_by_to[t])} for t in (1, 2, 5)],
    "scope": "Lane A (Performance), matured-7 claims.",
    "note": ("Size alone is not the decider. The pooled size chart's 'big loses' is mostly the no-deposit "
             "giveaways: a big (RM400+) bonus goes from -1.04/RM with no deposit to about break-even when a "
             "deposit is required. The real swing lever is TURNOVER — deposit-required bonuses move from "
             "-0.89/RM at 1x to +0.42/RM at 5x (big ones: -0.90 -> +0.63). So a bigger bonus can pay IF it is "
             "deposit-gated and carries real turnover. Directional own-baseline; thinner cells (RM400+/5x ~174 "
             "claims) need the matched holdout to pin the exact size x turnover optimum."),
}

j["size_turnover"] = size_turnover
json.dump(j, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print(f"size_turnover written -> {PATH}")
st = size_turnover
print(f"  big RM400+: no-deposit {st['big_dep_vs_nodep']['no_deposit']['net_per_rm']}/RM  vs  deposit-required {st['big_dep_vs_nodep']['deposit_required']['net_per_rm']}/RM (dep {st['big_dep_vs_nodep']['deposit_required']['dep_per_rm']}x)")
print("  deposit-required by TO:", ", ".join(f"{x['to_x']}x:{x['net_per_rm']}" for x in st["by_turnover"]))
print("  big deposit-required by TO:", ", ".join(f"{x['to_x']}x:{x['net_per_rm']}(n{x['n']})" for x in st["big_by_turnover"]))
