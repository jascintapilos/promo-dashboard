"""Incrementality proxy + cost-per-incremental-retained for the Retention tab.

Answers: are retained redeposits actually caused by the offer, or would these
players have redeposited anyway at their tier's normal rate? Uses fields already in
ret-metrics-MY.json (redeposit_expected = tier x mechanic baseline, retained,
matured_30). Emits a `ret.incrementality` block. Directional (own-baseline), not causal.
No member rows. Run after the retention metrics builder.
Usage: python bin/ret_report/incrementality.py
"""
import json
from pathlib import Path

RET = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/ret")
m = json.load(open(RET / "ret-metrics-MY.json", encoding="utf-8"))

# graded retention codes (win-back held for VIP; need a matured window + a baseline)
codes = [c for c in m["codes"]
         if not c.get("is_winback") and c.get("matured_30") and c.get("redeposit_expected") is not None
         and c.get("retained") is not None]

by = []
for c in codes:
    exp_ret = c["redeposit_expected"] / 100 * c["matured_30"]     # players the baseline says would redeposit anyway
    inc = round(c["retained"] - exp_ret)                          # extra retained the offer appears to add
    by.append({
        "code": c["code"], "spend": c["spend"], "matured_30": c["matured_30"],
        "retained": c["retained"], "expected_retained": round(exp_ret),
        "incremental": inc, "uplift_pp": c.get("redeposit_uplift"),
        "cost_per_incremental": round(c["spend"] / inc) if inc > 0 else None,
        "cost_per_retained": c.get("cost_per_retained"),
        "ngr_lift_per_rm": c.get("ngr_lift_per_rm"),
    })
by.sort(key=lambda d: -d["spend"])

tot_spend = sum(c["spend"] for c in codes)
tot_ret = sum(c["retained"] for c in codes)
tot_exp = sum(c["redeposit_expected"] / 100 * c["matured_30"] for c in codes)
tot_inc = round(tot_ret - tot_exp)
pos = [d for d in by if d["incremental"] > 0]
spend_pos = sum(d["spend"] for d in pos)

m["incrementality"] = {
    "summary": {
        "codes": len(codes),
        "total_retained": tot_ret,
        "expected_retained": round(tot_exp),
        "incremental_retained": tot_inc,
        "blended_cost_per_incremental": round(tot_spend / tot_inc) if tot_inc > 0 else None,
        "n_positive": len(pos), "n_flat_or_negative": len(codes) - len(pos),
        "spend_share_positive": round(spend_pos / tot_spend * 100, 1) if tot_spend else 0.0,
    },
    "by_code": by[:15],
    "basis": "Incremental retained = actual redepositors minus the tier x mechanic baseline expectation (redeposit_expected). Directional own-baseline, not a controlled test. Win-back codes excluded (held for VIP).",
}
json.dump(m, open(RET / "ret-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(RET / "ret-metrics-MY.json", encoding="utf-8"))  # round-trip

s = m["incrementality"]["summary"]
print(f"INCREMENTALITY — {s['codes']} codes | retained {s['total_retained']:,} vs baseline-expected {s['expected_retained']:,} → incremental {s['incremental_retained']:+,}")
print(f"  blended cost per incremental retained: {'RM'+str(s['blended_cost_per_incremental']) if s['blended_cost_per_incremental'] else 'n/a (net incremental <= 0)'}")
print(f"  codes adding retention above baseline: {s['n_positive']}/{s['codes']} ({s['spend_share_positive']}% of spend); flat/negative: {s['n_flat_or_negative']}")
print("  TOP CODES BY SPEND:")
for d in by[:8]:
    cpi = ('RM'+str(d['cost_per_incremental'])) if d['cost_per_incremental'] else 'n/a'
    print(f"    {d['code'][:30]:30s} spend RM{d['spend']:>9,} · uplift {str(d['uplift_pp']):>6}pp · incr {d['incremental']:>6} · cost/incr {cpi:>8}")
print("Merged ret.incrementality into ret-metrics-MY.json (round-trip OK).")
