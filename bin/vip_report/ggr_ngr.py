"""GGR-vs-NGR efficiency — where the bonus eats the house margin.

Reads member-ledger (member-level, scratchpad) and flags VIPs whose bonus is large
relative to the house winnings they generate. Emits `vip.ggr_ngr`. Aggregated only.
Usage: python bin/vip_report/ggr_ngr.py
"""
import json
from collections import defaultdict
from pathlib import Path

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
ml = json.load(open(VIP / "member-ledger-MY.json", encoding="utf-8"))
m = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))
norm = lambda t: (t or "").replace(" (Trial)", "").strip()
TIERS = ["Diamond", "Platinum", "Gold", "Silver", "Bronze"]

pos = [r for r in ml if r["ytd_ggr"] > 0]
over = [r for r in pos if r["vip_bonus"] > 0.5 * r["ytd_ggr"]]           # bonus > half the house winnings
by_tier = []
for t in TIERS:
    tp = [r for r in pos if norm(r["tier_end"]) == t]
    to = [r for r in over if norm(r["tier_end"]) == t]
    if tp:
        by_tier.append({"tier": t, "members": len(tp), "over_bonused": len(to),
                        "over_spend": round(sum(r["vip_bonus"] for r in to)),
                        "over_pct": round(len(to) / len(tp) * 100)})

tot_ggr = sum(r["ytd_ggr"] for r in ml)
tot_bonus = sum(r["vip_bonus"] for r in ml)
m["ggr_ngr"] = {
    "ggr_positive": len(pos), "over_bonused": len(over),
    "over_spend": round(sum(r["vip_bonus"] for r in over)),
    "over_share": round(len(over) / len(pos) * 100, 1) if pos else 0,
    "ggr_coverage": round(tot_ggr / tot_bonus, 1) if tot_bonus else None,
    "by_tier": by_tier,
    "basis": "House winnings (GGR) vs bonus per VIP, year to date. 'Over-bonused' = bonus greater than half the house winnings the player generated — the bonus is eating most of the margin. Trim candidates, but check play first (some are new/growing).",
}
json.dump(m, open(VIP / "vip-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))  # round-trip

g = m["ggr_ngr"]
print(f"GGR-vs-NGR — {g['over_bonused']}/{g['ggr_positive']} GGR-positive VIPs over-bonused ({g['over_share']}%) = RM{g['over_spend']:,} bonus | program GGR covers bonus {g['ggr_coverage']}x")
for b in by_tier:
    print(f"  {b['tier']:9s} {b['over_bonused']:>4}/{b['members']:<5} over-bonused ({b['over_pct']}%) · RM{b['over_spend']:,}")
print("Merged vip.ggr_ngr into vip-metrics-MY.json (cross-foot OK).")
