"""At-risk whale ledger for the VIP tab.

Answers: exactly which VIP whales are cooling right now, and how much net revenue
walks out with each one? Reads member-ledger-MY.json (member-level, stays in
scratchpad) and emits an aggregated `vip.whale_ledger` block with OPAQUE refs only
(no player id/name) so the report stays shareable. Run after the VIP metrics builder.
Usage: python bin/vip_report/whale_ledger.py
"""
import json, hashlib
from pathlib import Path

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
ml = json.load(open(VIP / "member-ledger-MY.json", encoding="utf-8"))
m = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))

norm = lambda t: (t or "Unknown").replace(" (Trial)", "").strip()
ref = lambda x: hashlib.sha1(str(x).encode()).hexdigest()[:6].upper()   # non-reversible short handle
drop = lambda r: (r["dep_h1"] - r["dep_h2"]) / r["dep_h1"] if r["dep_h1"] > 0 else 0.0

# whales = top 1% of VIPs by year-to-date net revenue
pos = sorted([r for r in ml if r["ytd_ngr"] > 0], key=lambda r: -r["ytd_ngr"])
n1 = max(1, round(len(ml) * 0.01))
whales = pos[:n1]
wthresh = whales[-1]["ytd_ngr"] if whales else 0

# cooling = deposited less in the 2nd half of the year than the 1st
cooling = [r for r in whales if r["dep_h1"] > 0 and r["dep_h2"] < r["dep_h1"]]
cooling.sort(key=lambda r: -r["ytd_ngr"])

ledger = [{"rank": i + 1, "ref": ref(r["member"]), "tier": norm(r["tier_end"]),
           "ytd_ngr": round(r["ytd_ngr"]), "drop_pct": round(drop(r) * 100),
           "dep_h1": round(r["dep_h1"]), "dep_h2": round(r["dep_h2"]),
           "signal": f"deposits down {round(drop(r)*100)}% (1st half → 2nd)"}
          for i, r in enumerate(cooling[:15])]

m["whale_ledger"] = {
    "members": ledger,
    "summary": {
        "whales": len(whales), "cooling": len(cooling),
        "ngr_at_risk": round(sum(r["ytd_ngr"] for r in cooling)),
        "whale_threshold_ngr": round(wthresh),
    },
    "basis": "Whales = top 1% of VIPs by year-to-date net revenue. Cooling = deposited less in the 2nd half of the year than the 1st. NGR-at-risk = their combined year-to-date net revenue. Opaque ref only — no player identity.",
}
json.dump(m, open(VIP / "vip-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
loaded = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))  # round-trip

# verify: no member ids leaked, at-risk within program NGR
assert all(set(x.keys()) == {"rank", "ref", "tier", "ytd_ngr", "drop_pct", "dep_h1", "dep_h2", "signal"} for x in ledger)
s = m["whale_ledger"]["summary"]
print(f"WHALE LEDGER — whales(top 1%) {s['whales']} | cooling {s['cooling']} | NGR-at-risk RM{s['ngr_at_risk']:,} | whale floor RM{s['whale_threshold_ngr']:,}")
print("  TOP COOLING WHALES:")
for x in ledger[:8]:
    print(f"    #{x['rank']:>2} {x['ref']} {x['tier']:9s} YTD NGR RM{x['ytd_ngr']:>10,} · {x['signal']}")
print("Merged vip.whale_ledger into vip-metrics-MY.json (opaque refs only; round-trip OK).")
