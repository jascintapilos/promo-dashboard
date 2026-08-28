"""Bonus-farming watchlist for the VIP tab.

Answers: which promo codes and members show fingerprints of farming — one player
eating a code, or a member hitting code after code? Reads claim-rows-MY.json
(member-level, stays in scratchpad) + member tiers, emits an aggregated
`vip.farming` block with OPAQUE refs only. Run after the VIP metrics builder.
Usage: python bin/vip_report/farming_watchlist.py
"""
import json, hashlib
from collections import defaultdict
from pathlib import Path

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
cr = json.load(open(VIP / "claim-rows-MY.json", encoding="utf-8"))
m = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))
norm = lambda t: (t or "Unknown").replace(" (Trial)", "").strip()
ref = lambda x: hashlib.sha1(str(x).encode()).hexdigest()[:6].upper()

mem = defaultdict(lambda: {"codes": set(), "claims": 0.0, "bonus": 0.0, "tier": ""})
codes = defaultdict(lambda: {"members": defaultdict(float), "bonus": 0.0, "claims": 0.0})
for r in cr:
    d = mem[r["member"]]; d["codes"].add(r["code"]); d["claims"] += r["claims"]; d["bonus"] += r["bonus_cost"]; d["tier"] = r["tier"]
    c = codes[r["code"]]; c["members"][r["member"]] += r["bonus_cost"]; c["bonus"] += r["bonus_cost"]; c["claims"] += r["claims"]

# members hitting many distinct codes (cross-code farming)
mem_list = sorted(mem.items(), key=lambda kv: -len(kv[1]["codes"]))
by_member = [{"ref": ref(k), "tier": norm(v["tier"]), "distinct_codes": len(v["codes"]),
              "claims": round(v["claims"]), "bonus": round(v["bonus"])} for k, v in mem_list[:12]]

# codes where one member takes most of the spend (single-player concentration)
by_code = []
for code, c in codes.items():
    claimers = len(c["members"])
    if claimers < 3 or c["bonus"] < 500:          # skip legit 1-off VIP rewards + tiny codes
        continue
    topm = max(c["members"].items(), key=lambda kv: kv[1])
    share = topm[1] / c["bonus"] if c["bonus"] else 0
    if share >= 0.5:
        by_code.append({"code": code, "claimers": claimers, "bonus": round(c["bonus"]),
                        "top_share": round(share * 100), "top_ref": ref(topm[0])})
by_code.sort(key=lambda d: -d["bonus"])

import statistics as st
dc = [len(v["codes"]) for v in mem.values()]
summary = {"members": len(mem), "median_codes": round(st.median(dc)) if dc else 0,
           "max_codes": max(dc) if dc else 0, "heavy_members": sum(1 for x in dc if x >= 20),
           "concentrated_codes": len(by_code)}

m["farming"] = {"by_member": by_member, "by_code": by_code[:10], "summary": summary,
                "basis": "Cross-code farming = members claiming many distinct codes. Single-player concentration = codes (>=3 claimers, >=RM500) where one member takes >=50% of the spend. Opaque refs only; a watchlist to check, not proof of abuse."}
json.dump(m, open(VIP / "vip-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))  # round-trip

assert all("member" not in x and set(x.keys()) <= {"ref", "tier", "distinct_codes", "claims", "bonus"} for x in by_member)
print(f"FARMING — {summary['members']:,} members | median {summary['median_codes']} codes each, max {summary['max_codes']} | {summary['heavy_members']} hit >=20 codes | {summary['concentrated_codes']} one-player-concentrated codes")
print("  BREADTH (most distinct codes):")
for x in by_member[:6]:
    print(f"    {x['ref']} {x['tier']:9s} {x['distinct_codes']:>3} codes · {x['claims']:>5} claims · RM{x['bonus']:>8,}")
print("  CONCENTRATION (one player takes most of the code):")
for x in by_code[:6]:
    print(f"    {x['code'][:30]:30s} {x['claimers']:>3} claimers · RM{x['bonus']:>8,} · top player {x['top_share']}% ({x['top_ref']})")
print("Merged vip.farming into vip-metrics-MY.json (opaque refs only; round-trip OK).")
