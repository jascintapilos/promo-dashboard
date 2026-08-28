"""Tier-migration engine — who climbs vs. slides, and whether spend tracks the climb.

Reads member-ledger (member-level, stays in scratchpad) tier_start -> tier_end and
emits an aggregated `vip.tier_migration` block. Correlation only — bigger players both
climb and receive more bonus; NOT proof the bonus caused the climb.
Usage: python bin/vip_report/tier_migration.py
"""
import json, statistics as st
from collections import defaultdict
from pathlib import Path

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
ml = json.load(open(VIP / "member-ledger-MY.json", encoding="utf-8"))
m = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))

ORD = {"Bronze": 0, "Silver": 1, "Gold": 2, "Platinum": 3, "Diamond": 4}
TIERS = ["Silver", "Gold", "Platinum", "Diamond"]
norm = lambda t: (t or "").replace(" (Trial)", "").strip()
med = lambda xs: round(st.median(xs)) if xs else 0

known = [r for r in ml if norm(r["tier_start"]) in ORD and norm(r["tier_end"]) in ORD]
climb = [r for r in known if ORD[norm(r["tier_end"])] > ORD[norm(r["tier_start"])]]
slid = [r for r in known if ORD[norm(r["tier_end"])] < ORD[norm(r["tier_start"])]]
held = [r for r in known if ORD[norm(r["tier_end"])] == ORD[norm(r["tier_start"])]]

# climbers grouped by the tier they reached
into = defaultdict(list)
for r in climb:
    into[norm(r["tier_end"])].append(r)
by_end = [{"tier": t, "climbed_in": len(into[t]),
           "med_bonus": med([r["vip_bonus"] for r in into[t]]),
           "med_ngr": med([r["ytd_ngr"] for r in into[t]])} for t in TIERS if into[t]]

m["tier_migration"] = {
    "climbed": len(climb), "held": len(held), "slid": len(slid), "known": len(known),
    "climbers": {"n": len(climb), "med_bonus": med([r["vip_bonus"] for r in climb]), "med_ngr": med([r["ytd_ngr"] for r in climb])},
    "held_grp": {"n": len(held), "med_bonus": med([r["vip_bonus"] for r in held]), "med_ngr": med([r["ytd_ngr"] for r in held])},
    "by_end_tier": by_end,
    "basis": "Tier at the start of the period vs the end, from the member ledger. Climbers get more bonus AND generate more net revenue — but bigger players both climb and receive more bonus, so this is an association, not proof the bonus drove the climb.",
}
json.dump(m, open(VIP / "vip-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))  # round-trip

assert len(climb) + len(held) + len(slid) == len(known)
tm = m["tier_migration"]
print(f"TIER MIGRATION — {tm['known']:,} VIPs with tier data | climbed {tm['climbed']} · held {tm['held']} · slid {tm['slid']}")
print(f"  climbers: median bonus RM{tm['climbers']['med_bonus']} · median YTD NGR RM{tm['climbers']['med_ngr']:,}")
print(f"  held:     median bonus RM{tm['held_grp']['med_bonus']} · median YTD NGR RM{tm['held_grp']['med_ngr']:,}")
print("  climbed INTO:")
for b in by_end:
    print(f"    {b['tier']:9s} {b['climbed_in']:>4} players · median bonus RM{b['med_bonus']:,}")
print("Merged vip.tier_migration into vip-metrics-MY.json (cross-foot OK).")
