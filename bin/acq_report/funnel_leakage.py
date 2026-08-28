"""Claim -> deposit funnel + freebie-hunter RM leakage for the Acquisition tab.

Answers: how much acquisition spend goes to people who claim the bonus and never
deposit, and which codes leak the most? Reads member rows (claim-outcomes-MY.json),
emits an aggregated `acq.funnel` block into acq-metrics-MY.json. No member rows are
written out. Run after 02_compute_metrics.py.
Usage: python bin/acq_report/funnel_leakage.py
"""
import json
from collections import defaultdict
from pathlib import Path

ACQ = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/acq")
rows = json.load(open(ACQ / "claim-outcomes-MY.json", encoding="utf-8"))
m = json.load(open(ACQ / "acq-metrics-MY.json", encoding="utf-8"))
is_ref = lambda c: "REFER" in (c or "").upper()

by = defaultdict(list)
for r in rows:
    if is_ref(r["code"]):
        continue
    by[r["code"]].append(r)

def stats(rs):
    claimers = len(rs)
    depositors = sum(1 for r in rs if r["ftd_in_7d"])
    stuck = claimers - depositors
    spend = round(sum(r["bonus_cost"] for r in rs))
    leakage = round(sum(r["bonus_cost"] for r in rs if not r["ftd_in_7d"]))   # spend on claimers with no first deposit
    return {"claimers": claimers, "depositors": depositors, "stuck": stuck,
            "spend": spend, "leakage_rm": leakage,
            "conv_pct": round(depositors / claimers * 100, 1) if claimers else 0.0,
            "leak_pct": round(leakage / spend * 100, 1) if spend else 0.0}

by_code = []
for code, rs in by.items():
    d = stats(rs); d["code"] = code
    by_code.append(d)
by_code.sort(key=lambda d: -d["leakage_rm"])

blended = stats([r for r in rows if not is_ref(r["code"])])

m["funnel"] = {
    "blended": blended,
    "by_code": by_code[:12],
    "basis": "Graded (non-referral) acquisition claims. Leakage = redeemed bonus spent on claimers who made no first deposit within 7 days.",
}
json.dump(m, open(ACQ / "acq-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(ACQ / "acq-metrics-MY.json", encoding="utf-8"))  # round-trip

# cross-foot
assert blended["claimers"] == blended["depositors"] + blended["stuck"]
assert blended["leakage_rm"] <= blended["spend"]
print(f"FUNNEL — claimers {blended['claimers']:,} -> depositors {blended['depositors']:,} ({blended['conv_pct']}%) -> stuck {blended['stuck']:,}")
print(f"  leakage: RM{blended['leakage_rm']:,} of RM{blended['spend']:,} ({blended['leak_pct']}%) spent on claimers who never deposited")
print("  TOP LEAKAGE CODES:")
for d in by_code[:8]:
    print(f"    {d['code'][:34]:34s} leak RM{d['leakage_rm']:>8,} ({d['leak_pct']:>5}% of spend) · conv {d['conv_pct']:>5}% · {d['stuck']:>4} stuck")
print("Merged acq.funnel into acq-metrics-MY.json (round-trip OK).")
