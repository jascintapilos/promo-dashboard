"""Spend-vs-FTD Pareto + leave-one-out headline test for the Acquisition tab.

Answers: where does acquisition money actually go, and is the blended "RM X per new
depositor" a real portfolio number or carried by one or two big codes?
Reads scratchpad/acq/acq-metrics-MY.json (codes[] + kpis) and merges an `acq.pareto`
block. No member-level rows needed. Aggregated only. Run after 02_compute_metrics.py.
Usage: python bin/acq_report/pareto_loo.py
"""
import json
from pathlib import Path

ACQ = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/acq")
m = json.load(open(ACQ / "acq-metrics-MY.json", encoding="utf-8"))
is_ref = lambda c: "REFER" in (c or "").upper()

# match the headline exactly: graded = non-referral; cost/FTD is new-player-attributed spend
graded = [c for c in m["codes"] if not is_ref(c["code"])]
tot_sn = sum(c["spend_new"] for c in graded)
tot_ftd = sum(c["ftd"] for c in graded)
headline = m["kpis"]["cost_per_ftd"]
assert tot_ftd and round(tot_sn / tot_ftd) == headline, "headline mismatch — check graded set"

rows = sorted(graded, key=lambda c: -c["spend_new"])
pcodes = [{"code": c["code"],
           "spend_share": round(c["spend_new"] / tot_sn * 100, 1),
           "ftd_share": round(c["ftd"] / tot_ftd * 100, 1),
           "cost_per_ftd": c["cost_per_ftd"]} for c in rows]

# Lorenz curve, codes sorted by spend desc: cumulative (spend-share, FTD-share).
# A code that spends a lot but wins few FTDs bows the curve down (inefficient).
curve = [{"x": 0.0, "y": 0.0}]
cs = cf = 0.0
for c in rows:
    cs += c["spend_new"] / tot_sn
    cf += c["ftd"] / tot_ftd
    curve.append({"x": round(cs, 4), "y": round(cf, 4)})

# Gini of spend concentration across codes (0 = even, 1 = all in one code)
sn = sorted(c["spend_new"] for c in graded)
n, S = len(sn), sum(sn)
gini = round((2 * sum((i + 1) * x for i, x in enumerate(sn)) / (n * S)) - (n + 1) / n, 3) if S and n else 0.0

# leave-one-out: re-blend cost/FTD dropping each of the top-5 spenders
loo = []
for c in rows[:5]:
    wsn, wf = tot_sn - c["spend_new"], tot_ftd - c["ftd"]
    wc = round(wsn / wf) if wf else None
    delta = (wc - headline) if wc is not None else None
    loo.append({"code": c["code"], "spend_new": c["spend_new"], "ftd": c["ftd"],
                "without_cost_per_ftd": wc, "delta": delta,
                "pct": round(delta / headline * 100, 1) if (delta is not None and headline) else None,
                "material": bool(delta is not None and abs(delta) >= 0.10 * headline)})

m["pareto"] = {
    "headline_cost_per_ftd": headline,
    "gini_spend": gini,
    "top1_spend_share": pcodes[0]["spend_share"] if pcodes else 0.0,
    "top3_spend_share": round(sum(x["spend_share"] for x in pcodes[:3]), 1),
    "top1_ftd_share": pcodes[0]["ftd_share"] if pcodes else 0.0,
    "top3_ftd_share": round(sum(x["ftd_share"] for x in pcodes[:3]), 1),
    "n_codes": len(graded),
    "curve": curve, "codes": pcodes, "loo": loo,
    "basis": "Graded (non-referral) acquisition codes. Cost/FTD is new-player-attributed spend ÷ new depositors. LOO re-blends the headline dropping one code.",
}
json.dump(m, open(ACQ / "acq-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(ACQ / "acq-metrics-MY.json", encoding="utf-8"))  # round-trip

print(f"PARETO — {len(graded)} graded codes | headline RM{headline}/FTD | Gini(spend) {gini}")
print(f"  top code = {pcodes[0]['spend_share']}% of spend / {pcodes[0]['ftd_share']}% of FTDs | top-3 = {m['pareto']['top3_spend_share']}% spend / {m['pareto']['top3_ftd_share']}% FTDs")
print("  LEAVE-ONE-OUT (drop the code, re-blend the RM/FTD headline):")
for x in loo:
    d = f"{x['delta']:+d}" if x["delta"] is not None else "n/a"
    print(f"    drop {x['code'][:34]:34s} spend RM{x['spend_new']:>9,} → RM{x['without_cost_per_ftd']}/FTD ({d}, {x['pct']:+}% ){' *MATERIAL' if x['material'] else ''}")
print("Merged acq.pareto into acq-metrics-MY.json (round-trip OK).")
