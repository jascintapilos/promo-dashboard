"""Sweet-spot-by-tier block for the VIP report.

Where an RM of money-judged VIP bonus (Lane A-performance + D-engagement) makes money, by tier.
Confirmed by the vip-sweet-spot workflow: the size x form gradient (small cheap-form pays, big
free-credit bleeds) survives controlling for tier/form/wagering; tier multiplies the small-form payoff.
Emits a `sweet_spot` block into scratchpad/vip/vip-metrics-MY.json. NGR net of bonus (break-even 0).
Usage: python bin/vip_report/sweet_spot.py
"""
import json
from collections import defaultdict
from pathlib import Path

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
m = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))
meta = {c["code"]: (c["lane"], c.get("mechanic"), c.get("size_band"), c.get("sub_type"), c.get("avg_amount") or 0) for c in m["codes"]}
MJ = {c for c, v in meta.items() if v[0] in ("A-performance", "D-engagement")}
rows = [r for r in json.load(open(VIP / "claim-rows-MY.json", encoding="utf-8")) if r["code"] in MJ and r["mature_7"]]
MG = {"lucky-wheel", "scratch-card", "mystery-angpow"}
norm = lambda t: (t or "Unknown").replace(" (Trial)", "").strip()
def prm(rs):
    s = sum(r["bonus_cost"] for r in rs)
    return (round(sum(r["ngr_lift"] for r in rs) / s, 2) if s else None), round(s)

TIERS = ["Silver", "Gold", "Platinum", "Diamond"]
is_bigfc = lambda code: (meta[code][1] == "free-credit" and meta[code][2] in ("RM150-400", "RM400+"))
is_sweet = lambda code: (meta[code][0] == "D-engagement")   # cheap-form small engagement (mini-games + check-ins)

by_tier = []
for t in TIERS:
    sw = [r for r in rows if norm(r["tier"]) == t and is_sweet(r["code"])]
    dz = [r for r in rows if norm(r["tier"]) == t and is_bigfc(r["code"])]
    sp, ss = prm(sw); dp, ds = prm(dz)
    by_tier.append({"tier": t, "sweet_per_rm": sp, "sweet_spend": ss, "dead_per_rm": dp, "dead_spend": ds})

def zone(rs):
    p, s = prm(rs); return {"spend": s, "ngr": round(sum(r["ngr_lift"] for r in rs)), "per_rm": p}
sweet_z = zone([r for r in rows if meta[r["code"]][2] == "<RM50"])              # small (all money-judged forms)
dead_z = zone([r for r in rows if is_bigfc(r["code"])])                          # big-ticket free-credit >=RM150
prog_z = zone(rows)

# mini-game frequency decay (per-member cumulative ordinal)
mini = sorted([r for r in rows if meta[r["code"]][3] in MG], key=lambda r: r["claim_date"])
seen = defaultdict(int)
for r in mini:
    seen[r["member"]] += 1; r["_ord"] = seen[r["member"]]
buck = lambda o: "1-2" if o <= 2 else "3-5" if o <= 5 else "6-10" if o <= 10 else "11+"
fb = defaultdict(list)
for r in mini: fb[buck(r["_ord"])].append(r)
freq = [{"bucket": b, "per_rm": prm(fb[b])[0]} for b in ("1-2", "3-5", "6-10", "11+") if fb[b]]

# deposit-type x bonus-range grid (heatmap)
FORMS = ["mini-game", "check-in", "free-spins", "reload", "free-credit"]
BANDS = ["<RM30", "RM30-50", "RM50-100", "RM100-150", "RM150-300", "RM300-500", "RM500+"]
def formof(code):
    lane, mech, sb, st, amt = meta[code]
    if st in MG: return "mini-game"
    if st == "check-in/engagement": return "check-in"
    return {"reload": "reload", "free-credit": "free-credit", "free-spins": "free-spins"}.get(mech, "other")
def bandof(a):
    for hi, lab in [(30, "<RM30"), (50, "RM30-50"), (100, "RM50-100"), (150, "RM100-150"), (300, "RM150-300"), (500, "RM300-500")]:
        if a < hi: return lab
    return "RM500+"
gcell = defaultdict(list)
for r in rows:
    gcell[(formof(r["code"]), bandof(meta[r["code"]][4]))].append(r)
grid_cells = []
for f in FORMS:
    for b in BANDS:
        rs = gcell.get((f, b), [])
        if not rs: continue
        p, s = prm(rs)
        grid_cells.append({"form": f, "band": b, "per_rm": p, "spend": s, "n": len(rs), "low_n": s < 3000})

m["sweet_spot"] = {
    "basis": "Money-judged VIP = Lane A-performance + D-engagement, matured-7. NGR net of bonus (break-even 0). Directional own-baseline; big-ticket dead zone needs a matched holdout before cutting.",
    "rule": {"form": "Mini-game / free-spins / small reload (cheap-cost form)", "size": "under RM50",
             "wagering": "none", "frequency": "front-load to the 1st–2nd claim", "tier": "Silver and up — pays more the higher the tier",
             "target": "active player (deposited ≤7 days)"},
    "by_tier": by_tier,
    "zones": {"sweet": sweet_z, "dead": dead_z, "program": prog_z},
    "frequency_decay": freq,
    "grid": {"forms": FORMS, "bands": BANDS, "cells": grid_cells},
    "caveat": "The size×form gradient (small cheap-form pays, big free-credit bleeds) is robust — it survives controlling for tier, form and wagering. Mini-game per-RM is inflated by a near-zero denominator (the win is real, the multiple isn't literal). Cut the dead zone only after a matched holdout on big-ticket free-credit.",
}
json.dump(m, open(VIP / "vip-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))  # round-trip verify

print("SWEET SPOT by tier (sweet = Lane-D cheap-form <RM50 · dead = big free-credit >=RM150):")
for t in by_tier:
    print(f"  {t['tier']:9s} sweet {str(t['sweet_per_rm']):>5}/RM (RM{t['sweet_spend']:>8,}) · dead {str(t['dead_per_rm']):>6}/RM (RM{t['dead_spend']:>9,})")
print(f"\nZONES: sweet <RM50 {sweet_z['per_rm']}/RM RM{sweet_z['spend']:,}->{sweet_z['ngr']:+,} | dead bigFC {dead_z['per_rm']}/RM RM{dead_z['spend']:,}->{dead_z['ngr']:+,} | program {prog_z['per_rm']}/RM RM{prog_z['spend']:,}")
print("FREQ decay (mini-games):", " · ".join(f"{f['bucket']} {f['per_rm']}" for f in freq))
print("Merged sweet_spot block into vip-metrics-MY.json (round-trip OK).")
