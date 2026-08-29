#!/usr/bin/env python3
"""Emit the `whale_pillar` block into vip-metrics-MY.json.

Powers the Big-player detection tab (detect + decide). Reads ONLY existing
blocks in vip-metrics-MY.json — no pulls. The detailed cards (concentration,
at-risk ledger, cost-of-being-wrong, reinvest) are RELOCATED into the tab in the
template; this block supplies the detection layer + the whale decision stance.

Run: python bin/vip_report/whale_detection.py
"""
import json, os, hashlib

SCR = os.environ.get(
    "VIP_SCR",
    "C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/"
    "879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad",
)
PATH = os.path.join(SCR, "vip", "vip-metrics-MY.json")

j = json.load(open(PATH, encoding="utf-8"))
whale = (j.get("program", {}) or {}).get("whale", {}) or {}
wl = j.get("whale_ledger", {}) or {}
wsum = wl.get("summary", {}) or {}
tm = j.get("tier_migration", {}) or {}
be = (j.get("decision", {}) or {}).get("breakeven", []) or []
cprw = (j.get("reallocation", {}) or {}).get("cost_per_retained_whale", {}) or {}

# ---- DETECT ---------------------------------------------------------------
definition = {
    "rule": "A whale = a top-1% VIP by net revenue.",
    "threshold_ngr": wsum.get("whale_threshold_ngr"),
    "count": whale.get("top1pct_members"),
    "ngr_share": whale.get("top1pct_ngr_share"),
    "bonus_share": whale.get("top1pct_bonus_share"),
    "top10_ngr_share": whale.get("top10pct_ngr_share"),
}
cooling = {
    "cooling": wsum.get("cooling"), "of_top1pct": wsum.get("whales"),
    "at_risk_members": whale.get("value_at_risk_members"),
    "at_risk_ngr": whale.get("value_at_risk_ngr"),
    "watchlist": [{"ref": m.get("ref"), "tier": m.get("tier"), "ytd_ngr": m.get("ytd_ngr"),
                   "drop_pct": m.get("drop_pct"), "signal": m.get("signal")}
                  for m in (wl.get("members", []) or []) if (m.get("drop_pct") or 0) > 0],
    "rule": "Cooling = a top whale whose 2nd-half deposits dropped vs the 1st half.",
}
by_end = {e["tier"]: e for e in (tm.get("by_end_tier", []) or [])}
rising = {
    "into_platinum": (by_end.get("Platinum", {}) or {}).get("climbed_in"),
    "into_diamond": (by_end.get("Diamond", {}) or {}).get("climbed_in"),
    "climbers": tm.get("climbers", {}), "held_grp": tm.get("held_grp", {}),
    "rule": "Rising = members who climbed a tier this period (toward whale status).",
}

# ---- ECONOMICS (summary; full cards are relocated into the tab) -----------
downside = {"breakeven": [b for b in be if b.get("tier") in ("Diamond", "Platinum")]}
reinvest = {
    "delta": cprw.get("delta"), "treated_share_pct": cprw.get("treated_share_pct"),
    "n_treated": cprw.get("n_treated"), "n_untreated": cprw.get("n_untreated"),
    "control_confidence": cprw.get("control_confidence"),
    "signal": cprw.get("signal"),
    "gated_on": cprw.get("gated_on"),
}

# ---- DECIDE (the whale-specific marketing stance) -------------------------
decision = {
    "verdict": ("Whales are the top ~1% of VIPs and about {s}% of all VIP value — so their marketing is "
                "its own decision: protect the top, retain the cooling, grow the rising, and test before "
                "scaling.").format(s=whale.get("top10pct_ngr_share")),
    "moves": [
        {"move": "Protect the top — don't cut", "why": "the top handful hold years of value; one lost to a wrong cut is unrecoverable", "type": "floor"},
        {"move": "Retain the cooling", "why": "{n} whales slipping, {r} of net revenue at stake".format(n=whale.get("value_at_risk_members"), r="RM{:,}".format(whale.get("value_at_risk_ngr") or 0)), "type": "floor"},
        {"move": "Grow the rising pipeline", "why": "climbers get more bonus AND return more — funding growth pays", "type": "band"},
        {"move": "Test before scaling the reinvestment", "why": "keep-them is unproven observationally; the holdout decides it", "type": "band"},
    ],
}

# ---- ROSTER: the full top-1% whale list (opaque refs, same hash as whale_ledger) ----
led = json.load(open(os.path.join(SCR, "vip", "member-ledger-MY.json"), encoding="utf-8"))
ref = lambda x: hashlib.sha1(str(x).encode()).hexdigest()[:6].upper()   # matches whale_ledger.py
norm_tier = lambda t: (t or "").replace(" (Trial)", "").strip()
n_whale = definition.get("count") or 74
whales = sorted([m for m in led if (m.get("ytd_ngr", 0) or 0) > 0], key=lambda m: -m["ytd_ngr"])[:n_whale]
roster = []
for i, m in enumerate(whales):
    h1, h2 = (m.get("dep_h1", 0) or 0), (m.get("dep_h2", 0) or 0)
    cooling_m = h1 > 0 and h2 < h1
    roster.append({"rank": i + 1, "ref": ref(m["member"]), "tier": norm_tier(m.get("tier_end")),
                   "ytd_ngr": round(m["ytd_ngr"]), "cooling": cooling_m,
                   "drop_pct": round((1 - h2 / h1) * 100) if cooling_m else None})
assert all("member" not in r for r in roster), "roster must not carry raw member ids"
ngrs = sorted(r["ytd_ngr"] for r in roster)
roster_stats = {
    "count": len(roster),
    "total_ngr": sum(ngrs),
    "median_ngr": ngrs[len(ngrs) // 2] if ngrs else 0,
    "min_ngr": min(ngrs) if ngrs else 0,
    "max_ngr": max(ngrs) if ngrs else 0,
    "cooling": sum(1 for r in roster if r["cooling"]),
    "program_total_ngr": round((prog := j.get("program", {})).get("total_ytd_ngr", 0)),
}

j["whale_pillar"] = {
    "definition": definition, "roster": roster, "roster_stats": roster_stats,
    "cooling": cooling, "rising": rising,
    "downside": downside, "reinvest": reinvest, "decision": decision,
    "basis": "Detection layer over existing VIP data; opaque refs only; reinvest is directional/holdout-gated.",
}
json.dump(j, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print(f"whale_pillar written -> {PATH}")
print(f"  DETECT: {definition['count']} whales (top-1%, >= RM{definition['threshold_ngr']:,}), {definition['ngr_share']}% of +NGR, top-10% = {definition['top10_ngr_share']}%")
print(f"  COOLING: {cooling['cooling']}/{cooling['of_top1pct']} top whales, {cooling['at_risk_members']} at risk / RM{cooling['at_risk_ngr']:,}, watchlist {len(cooling['watchlist'])} (opaque)")
print(f"  RISING: into Platinum {rising['into_platinum']} / Diamond {rising['into_diamond']}; climbers med bonus {rising['climbers'].get('med_bonus')} vs held {rising['held_grp'].get('med_bonus')}")
print(f"  ROSTER: {len(roster)} whales (opaque refs); cooling {sum(1 for r in roster if r['cooling'])}; top ref {roster[0]['ref']} RM{roster[0]['ytd_ngr']:,}")
print(f"  DECIDE: {len(decision['moves'])} moves")
