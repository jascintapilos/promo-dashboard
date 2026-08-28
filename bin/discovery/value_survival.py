"""Value survival — do retained / VIP players keep depositing to 60 / 90 days?

Reads ret + vip claim-rows (member-level, scratchpad), joins each to its mechanic
(from the pillar metrics), and measures the share of matured claims where the player
was still depositing by day 60 and day 90 — cut by mechanic. Emits a `survival` block
into each pillar's metrics. Aggregated only.
Usage: python bin/discovery/value_survival.py
"""
import json
from collections import defaultdict
from pathlib import Path

S = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")

def build(pillar):
    mp = json.load(open(S / f"{pillar}/{pillar}-metrics-MY.json", encoding="utf-8"))
    mech = {c["code"]: (c.get("mechanic") or "other") for c in mp["codes"]}
    LAB = {"reload": "Deposit bonus", "free-credit": "Free credit", "free-spins": "Free spins", "mini-game": "Mini-game"}
    lab = lambda mc: LAB.get(mc, mc)
    cr = json.load(open(S / f"{pillar}/claim-rows-MY.json", encoding="utf-8"))
    g = defaultdict(lambda: {"m60": 0, "s60": 0, "m90": 0, "s90": 0})
    tot = {"m60": 0, "s60": 0, "m90": 0, "s90": 0}
    for r in cr:
        mc = lab(mech.get(r["code"], "other"))
        for win, mf, df in [("60", "mature_60", "dep_days_60"), ("90", "mature_90", "dep_days_90")]:
            if r.get(mf):
                g[mc]["m" + win] += 1; tot["m" + win] += 1
                if r.get(df, 0) >= 1:
                    g[mc]["s" + win] += 1; tot["s" + win] += 1
    by_mech = []
    for mc, d in g.items():
        if d["m90"] < 100:
            continue
        by_mech.append({"mechanic": mc, "matured_90": d["m90"],
                        "still_60": round(d["s60"] / d["m60"] * 100) if d["m60"] else None,
                        "still_90": round(d["s90"] / d["m90"] * 100) if d["m90"] else None})
    by_mech.sort(key=lambda x: -x["matured_90"])
    block = {"by_mechanic": by_mech,
             "overall_60": round(tot["s60"] / tot["m60"] * 100) if tot["m60"] else None,
             "overall_90": round(tot["s90"] / tot["m90"] * 100) if tot["m90"] else None,
             "matured_90": tot["m90"],
             "basis": "Of claims with a matured window, the share where the player was still depositing by day 60 / 90. Directional read of durability; higher = the value lasts."}
    mp["survival"] = block
    json.dump(mp, open(S / f"{pillar}/{pillar}-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"{pillar.upper()} SURVIVAL — {tot['m90']:,} matured-90 claims | still depositing day60 {block['overall_60']}% · day90 {block['overall_90']}%")
    for b in by_mech:
        print(f"    {b['mechanic']:14s} n={b['matured_90']:>6,} · day60 {b['still_60']}% · day90 {b['still_90']}%")
    return block

for p in ("ret", "vip"):
    build(p)
print("Merged survival into ret + vip metrics.")
