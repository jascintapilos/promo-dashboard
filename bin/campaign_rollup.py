"""Roll spend (exact) + directional outcomes up by campaign, cross-pillar.

Reads scratchpad/campaign-map-MY.json + the three pillar metrics, and merges a
consolidated `campaign_rollup` block into acq-metrics-MY.json (which the Summary
tab reads). Spend is exact; outcomes are directional own-baseline (acquisition
campaigns show cost/new-depositor, money-judged campaigns show net-rev per RM1) and
must be labelled 'association, not causal'. Emits coverage + a gap register.
Usage: python bin/campaign_rollup.py  (after campaign_tag.py)
"""
import json
from collections import defaultdict
from pathlib import Path

S = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
cmap = json.load(open(S / "campaign-map-MY.json", encoding="utf-8"))

# per-code records with the fields each pillar needs
recs = []
for f, pil in [("acq/acq-metrics-MY.json", "acq"), ("ret/ret-metrics-MY.json", "ret"), ("vip/vip-metrics-MY.json", "vip")]:
    m = json.load(open(S / f, encoding="utf-8"))
    for c in m["codes"]:
        t = cmap.get(c["code"], {})
        recs.append({"code": c["code"], "pillar": pil, "spend": c.get("spend", 0),
                     "spend_new": c.get("spend_new", 0), "ftd": c.get("ftd", 0), "claimers": c.get("claimers", 0),
                     "ngr_lift": c.get("ngr_lift", 0),
                     "campaign": t.get("campaign", "Unattributed"), "owner": t.get("owner", "Unknown"),
                     "objective": t.get("objective", "?"), "confidence": t.get("confidence", "unattributed")})

tot_spend = sum(r["spend"] for r in recs)
by = defaultdict(list)
for r in recs:
    by[r["campaign"]].append(r)

def dominant(rs, key):
    d = defaultdict(float)
    for r in rs: d[r[key]] += r["spend"]
    return max(d.items(), key=lambda kv: kv[1])[0] if d else "?"

campaigns = []
for camp, rs in by.items():
    spend = sum(r["spend"] for r in rs)
    obj = dominant(rs, "objective")
    acq = [r for r in rs if r["pillar"] == "acq"]
    money = [r for r in rs if r["pillar"] in ("ret", "vip")]
    ftd = sum(r["ftd"] for r in acq); sn = sum(r["spend_new"] for r in acq); clm = sum(r["claimers"] for r in acq)
    msp = sum(r["spend"] for r in money); mng = sum(r["ngr_lift"] for r in money)
    campaigns.append({
        "campaign": camp, "owner": dominant(rs, "owner"), "objective": obj,
        "codes": len(rs), "spend": round(spend), "spend_share": round(spend / tot_spend * 100, 1),
        "cost_per_ftd": round(sn / ftd) if ftd else None,
        "conversion": round(ftd / clm * 100, 1) if clm else None,
        "ngr_lift_per_rm": round(mng / msp, 2) if msp else None,
        "money_spend": round(msp),
        "kind": "acq" if obj == "Acquisition" else "money",
    })
campaigns.sort(key=lambda c: -c["spend"])

attr = [c for c in campaigns if c["campaign"] != "Unattributed"]
unattr = next((c for c in campaigns if c["campaign"] == "Unattributed"), {"spend": 0, "codes": 0})
gaps = sorted([r for r in recs if r["campaign"] == "Unattributed"], key=lambda r: -r["spend"])[:12]

rollup = {
    "campaigns": campaigns,
    "coverage": {"total_spend": round(tot_spend), "attributed_spend": round(sum(c["spend"] for c in attr)),
                 "attributed_pct": round(sum(c["spend"] for c in attr) / tot_spend * 100, 1),
                 "unattributed_spend": round(unattr["spend"]), "unattributed_codes": unattr["codes"]},
    "gaps": [{"code": r["code"], "spend": round(r["spend"]), "owner": r["owner"], "pillar": r["pillar"]} for r in gaps],
    "basis": "Spend is exact (code → campaign → bonus cost). Outcomes are directional own-baseline — an association, NOT causal attribution; a validated holdout model is the proof step. Owner is inferred from code/name and is a hypothesis until a source team confirms.",
}
m = json.load(open(S / "acq/acq-metrics-MY.json", encoding="utf-8"))
m["campaign_rollup"] = rollup
json.dump(m, open(S / "acq/acq-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(S / "acq/acq-metrics-MY.json", encoding="utf-8"))  # round-trip

cv = rollup["coverage"]
assert abs(cv["attributed_spend"] + cv["unattributed_spend"] - cv["total_spend"]) < 2, "spend does not cross-foot"
print(f"CAMPAIGN ROLLUP — {len(campaigns)} campaigns | spend RM{cv['total_spend']:,} | attributed {cv['attributed_pct']}% | unattributed {cv['unattributed_codes']} codes RM{cv['unattributed_spend']:,}")
print(f"  {'CAMPAIGN':22s} {'OWNER':11s} {'OBJ':12s} {'SPEND':>12} {'SHARE':>6}  OUTCOME (directional)")
for c in campaigns:
    out = (f"RM{c['cost_per_ftd']}/dep · {c['conversion']}% conv" if c["kind"] == "acq" and c["cost_per_ftd"] is not None
           else (f"{'+' if (c['ngr_lift_per_rm'] or 0) >= 0 else ''}RM{c['ngr_lift_per_rm']}/RM1" if c["ngr_lift_per_rm"] is not None else "—"))
    print(f"  {c['campaign'][:22]:22s} {c['owner'][:11]:11s} {c['objective'][:12]:12s} RM{c['spend']:>10,} {str(c['spend_share'])+'%':>6}  {out}")
print("Merged campaign_rollup into acq-metrics-MY.json (cross-foot OK).")
