"""Incrementality for the Retention tab — FORWARD NET REVENUE vs the player's own pre-window.

Replaces the earlier redeposit-COUNT vs tier x mechanic peer baseline with a MONEY read (per
forward-pull-spec.md, consumer #2, user decision "replace with forward-NGR"): for each retention
code, the net revenue its players produced in the 90 days AFTER claiming, minus what those same
players produced in the 90 days BEFORE (their own baseline). Directional own-baseline, NOT causal
(confounded by regression-to-mean; the holdout is the proof). Reads scratchpad/ret/forward-outcomes-MY.json
(grain A: per code x member, from rf_forward.py) + ret-metrics-MY.json (spend / is_winback). No member rows.
Run after rf_forward.py. Usage: python bin/ret_report/incrementality.py
"""
import json
from collections import defaultdict
from pathlib import Path

RET = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/ret")
m = json.load(open(RET / "ret-metrics-MY.json", encoding="utf-8"))
fwd = json.load(open(RET / "forward-outcomes-MY.json", encoding="utf-8"))

meta = {c["code"]: c for c in m["codes"]}
by_code = defaultdict(list)
for r in fwd:
    by_code[r["code"]].append(r)

rows = []
for code, rs in by_code.items():
    mc = meta.get(code, {})
    if mc.get("is_winback"):                       # win-back held for VIP (not graded here)
        continue
    mat = [r for r in rs if r["mature_90"]]         # only members with a full 90-day forward window
    if not mat:
        continue
    fwd90 = sum(r["fwd_ngr_90"] for r in mat)
    pre90 = sum(r["pre_ngr_90"] for r in mat)
    bon90 = sum(r["bonus_amount"] for r in mat)
    incr = fwd90 - pre90                            # extra net revenue vs the players' own prior-90 baseline
    rows.append({
        "code": code, "spend": round(mc.get("spend", bon90)), "mature_90": len(mat),
        "fwd_ngr_90": round(fwd90), "pre_ngr_90": round(pre90), "incr_ngr_90": round(incr),
        "incr_per_rm_90": round(incr / bon90, 2) if bon90 else None,
        "fwd_per_rm_90": round(fwd90 / bon90, 2) if bon90 else None,
        "mechanic": mc.get("mechanic", ""), "_bon90": round(bon90),
    })
rows.sort(key=lambda d: -d["spend"])

tot_fwd = sum(r["fwd_ngr_90"] for r in rows)
tot_pre = sum(r["pre_ngr_90"] for r in rows)
tot_incr = tot_fwd - tot_pre
tot_bon = sum(r["_bon90"] for r in rows)
tot_spend = sum(r["spend"] for r in rows)
pos = [r for r in rows if r["incr_ngr_90"] > 0]
spend_pos = sum(r["spend"] for r in pos)
for r in rows:
    r.pop("_bon90", None)

m["incrementality"] = {
    "summary": {
        "codes": len(rows),
        "total_fwd_ngr_90": round(tot_fwd),
        "total_pre_ngr_90": round(tot_pre),
        "incremental_ngr_90": round(tot_incr),
        "blended_incr_per_rm_90": round(tot_incr / tot_bon, 2) if tot_bon else None,
        "blended_fwd_per_rm_90": round(tot_fwd / tot_bon, 2) if tot_bon else None,
        "n_positive": len(pos), "n_flat_or_negative": len(rows) - len(pos),
        "spend_share_positive": round(spend_pos / tot_spend * 100, 1) if tot_spend else 0.0,
    },
    "by_code": rows[:15],
    "basis": ("Incremental net revenue = net revenue in the 90 days after claiming minus the same players' "
              "net revenue in the 90 days before (their own baseline), over members with a full 90-day window; "
              "NGR is net of the bonus. Directional own-baseline, NOT a controlled test (confounded by "
              "regression-to-mean). Win-back codes excluded (held for VIP)."),
}
json.dump(m, open(RET / "ret-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(RET / "ret-metrics-MY.json", encoding="utf-8"))  # round-trip

s = m["incrementality"]["summary"]
print(f"INCREMENTALITY (forward NGR, own-baseline) — {s['codes']} codes | fwd90 RM{s['total_fwd_ngr_90']:,} vs pre90 RM{s['total_pre_ngr_90']:,} -> incremental RM{s['incremental_ngr_90']:+,}")
print(f"  blended incremental per RM1: RM{s['blended_incr_per_rm_90']} (gross forward per RM1 RM{s['blended_fwd_per_rm_90']})")
print(f"  codes net-positive vs own baseline: {s['n_positive']}/{s['codes']} ({s['spend_share_positive']}% of spend); flat/negative: {s['n_flat_or_negative']}")
print("  TOP CODES BY SPEND:")
for d in m["incrementality"]["by_code"][:8]:
    print(f"    {d['code'][:30]:30s} spend RM{d['spend']:>9,} · incr/RM {d['incr_per_rm_90']} · incr RM{d['incr_ngr_90']:>10,}")
print("Merged ret.incrementality (forward-NGR) into ret-metrics-MY.json (round-trip OK).")
