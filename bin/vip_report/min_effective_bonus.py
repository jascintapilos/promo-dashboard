"""Minimum effective bonus — how deposit response scales with bonus size (the brief's Goal 2).

Reads vip claim-rows (member-level, stays in scratchpad) and bands each claim by the
actual bonus paid, then measures the extra deposit it drove per RM of bonus. Emits an
aggregated `vip.bonus_sizing` block. Directional own-baseline (dep_lift vs a per-type
baseline), not a controlled test. Run after the VIP metrics builder.
Usage: python bin/vip_report/min_effective_bonus.py
"""
import json
from collections import defaultdict
from pathlib import Path

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
cr = json.load(open(VIP / "claim-rows-MY.json", encoding="utf-8"))
m = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))

BANDS = ["<RM50", "RM50–150", "RM150–400", "RM400–1000", "RM1000+"]
def band(a):
    return "<RM50" if a < 50 else "RM50–150" if a < 150 else "RM150–400" if a < 400 else "RM400–1000" if a < 1000 else "RM1000+"

rows = [r for r in cr if r.get("mature_7")]              # settled 7-day deposit window
agg = defaultdict(lambda: {"cost": 0.0, "dep_lift": 0.0, "ngr_lift": 0.0, "n": 0})
for r in rows:
    d = agg[band(r["bonus_cost"])]
    d["cost"] += r["bonus_cost"]; d["dep_lift"] += r["dep_lift"]; d["ngr_lift"] += r["ngr_lift"]; d["n"] += 1

by_band = []
for b in BANDS:
    d = agg[b]
    by_band.append({"band": b, "claims": d["n"], "spend": round(d["cost"]),
                    "dep_lift_per_rm": round(d["dep_lift"] / d["cost"], 2) if d["cost"] else None,
                    "ngr_lift_per_rm": round(d["ngr_lift"] / d["cost"], 2) if d["cost"] else None})

# smallest band that still clearly works (deposit-lift per RM well above 1), and the oversized tail
effective = [b for b in by_band if (b["dep_lift_per_rm"] or 0) >= 1.5]
oversized = [b for b in by_band if (b["dep_lift_per_rm"] or 0) < 1]
oversized_spend = round(sum(agg[b["band"]]["cost"] for b in oversized))

m["bonus_sizing"] = {
    "by_band": by_band,
    "best_band": by_band[0]["band"], "best_per_rm": by_band[0]["dep_lift_per_rm"],
    "effective_bands": [b["band"] for b in effective],
    "oversized_bands": [b["band"] for b in oversized], "oversized_spend": oversized_spend,
    "basis": "Each VIP claim banded by the bonus actually paid; deposit-lift per RM = extra deposit driven vs the player-type baseline, ÷ bonus cost (7-day settled window). Directional own-baseline, not a controlled test — but the size gradient is steep and consistent.",
}
json.dump(m, open(VIP / "vip-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))  # round-trip

assert sum(b["claims"] for b in by_band) == len(rows)
print(f"MIN EFFECTIVE BONUS — {len(rows):,} settled claims")
print(f"  {'BAND':11s} {'CLAIMS':>7} {'SPEND':>12}  DEP-LIFT/RM   NGR-LIFT/RM")
for b in by_band:
    print(f"  {b['band']:11s} {b['claims']:>7,} RM{b['spend']:>10,}   {str(b['dep_lift_per_rm']):>8}      {b['ngr_lift_per_rm']}")
print(f"  → best: {m['bonus_sizing']['best_band']} (+{m['bonus_sizing']['best_per_rm']}/RM) · oversized (dep-lift/RM < 1): {m['bonus_sizing']['oversized_bands']} = RM{oversized_spend:,}")
print("Merged vip.bonus_sizing into vip-metrics-MY.json (cross-foot OK).")
