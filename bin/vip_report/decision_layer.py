#!/usr/bin/env python3
"""Emit the `decision` block into vip-metrics-MY.json (VIP decision layer, P1).

Reads ONLY the existing scratchpad metrics — no ClickHouse pulls. Surfaces the
frequency-cap savings (previously hardcoded narrative literals) as *sourced*
fields so the break-even divides by a real number, and computes the per-tier
whale break-even (how many defections erase each saving).

Run: python bin/vip_report/decision_layer.py
"""
import json, os

# --- Frequency-cap savings (sourced, not invented here) ---------------------
# From the member-level assignment-log analysis: big-player free-credit is
# 81% VM-assigned / 0% self-claimed. A 1-per-quarter cap frees ~RM228k for
# certain, up to ~RM375k if capped big players don't pull back. These were
# previously hardcoded in the Lane A narrative; surfaced here as fields.
# See bin/vip_report/frequency-cap-holdout-spec.md.
CAP_CERTAIN = 228000
CAP_BEST    = 375000

SCR = os.environ.get(
    "VIP_SCR",
    "C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/"
    "879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad",
)
PATH = os.path.join(SCR, "vip", "vip-metrics-MY.json")

j = json.load(open(PATH, encoding="utf-8"))
prog = j["program"]
mtm = j.get("money_to_move", {})
by_tier = {t["tier"]: t for t in prog["by_tier"]}

band_rm = mtm.get("laneA_stop_reduce", 3293448)

# Bronze trim = the excess above a balanced funding_index of 1.0
bronze = by_tier.get("Bronze", {})
bronze_trim = None
if bronze.get("funding_index"):
    bronze_trim = round(bronze["bonus"] - bronze["bonus"] / bronze["funding_index"])

TIERS = ["Diamond", "Platinum", "Gold", "Silver", "Bronze"]
breakeven = []
for t in TIERS:
    r = by_tier.get(t)
    if not r or not r.get("members"):
        continue
    npm = round(r["ytd_ngr"] / r["members"])
    breakeven.append({
        "tier": t,
        "ngr_per_member": npm,
        "defections_to_wipe_floor": round(CAP_CERTAIN / npm, 1) if npm > 0 else None,
        "defections_to_wipe_band":  round(band_rm     / npm, 1) if npm > 0 else None,
    })

decision = {
    "hero_subsidy_rm": prog["subsidy_rm"],
    "hero_subsidy_share_pct": prog["net_negative_share_pct"],
    "hero_subsidy_members": prog["net_negative_members"],
    "hero_subsidy_why": (
        "This is the bonus we spent on the ~{pct}% of VIP members ({n:,}) we're currently "
        "underwater on — where the bonus we gave was bigger than what the house made from "
        "their play (realized, already net of bonus). It is NOT the whole VIP program losing "
        "money: overall VIP roughly pays for itself and the top players are highly profitable. "
        "And it is NOT a measure of wasted lift — some of this spend did drive deposits, and "
        "some of these members are simply winners who had a good period. So treat it as an "
        "upper bound on problem spend, not a pot of reclaimable waste: the reclaimable, "
        "structural part is the concentrated giveaway in the floor below."
    ).format(pct=int(prog["net_negative_share_pct"] + 0.5), n=prog["net_negative_members"]),
    "floor": [
        {"key": "defund_flagship",
         "label": "Stop the 2 flagship RM400+ no-deposit codes",
         "rm_certain": CAP_CERTAIN, "rm_best": CAP_BEST, "reversible": True,
         "source": "frequency-cap analysis (member-level assignment log; 81% VM-assigned, "
                   "0% self-claimed) — see bin/vip_report/frequency-cap-holdout-spec.md"},
        {"key": "trim_bronze",
         "label": "Trim the over-funded tier (Bronze, funding index 2.16) toward balanced",
         "rm": bronze_trim, "reversible": True,
         "source": "by_tier funding_index — excess above a proportional 1.0"},
        {"key": "rescue_hygiene",
         "label": "Weekly Rescue eligibility clean-up",
         "rm": None, "reversible": True, "note": "perk — hygiene, not an ROI cut"},
    ],
    "band": {
        "key": "laneA_full", "label": "Full Lane A stop/reduce", "rm": band_rm,
        "gated_on": "Lane A matched holdout",
        "spec": "bin/vip_report/frequency-cap-holdout-spec.md",
    },
    "breakeven": breakeven,
    "basis": (
        "Per-member figure = YTD realized NGR / members (net of bonus) as a proxy for "
        "value-at-risk; forward LTV is a later refinement. FLOOR = reversible, "
        "census-arithmetic levers you can approve now (no test). BAND = magnitude pending "
        "the matched holdout. Break-even = saving / per-member NGR = how many defections in "
        "that tier erase the saving."
    ),
}

j["decision"] = decision
json.dump(j, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print(f"decision block written -> {PATH}")
print(f"  hero_subsidy_rm={decision['hero_subsidy_rm']:,} "
      f"({decision['hero_subsidy_share_pct']}%, {decision['hero_subsidy_members']:,} members)")
print(f"  band.rm={band_rm:,} | bronze_trim={bronze_trim}")
for b in breakeven:
    print(f"  {b['tier']:9s} NGR/member RM{b['ngr_per_member']:,} "
          f"-> wipe floor {b['defections_to_wipe_floor']} / wipe band {b['defections_to_wipe_band']}")
