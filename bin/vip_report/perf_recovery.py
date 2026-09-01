#!/usr/bin/env python3
"""VIP performance — the return over longer windows (meeting #7: surface the 90-day).

VIP performance (Lane A) is judged on a short window where it looks like a loss, but the
money keeps coming. This builds the baseline-adjusted forward LIFT per RM of bonus at
30/60/90 days (fwd_ngr − pre_ngr, from the member-level forward-outcomes pull), plus the
7-day headline from Lane A, so the report can show the recovery curve instead of stopping
at week one.

Consistent basis: lift = own-baseline-adjusted (forward minus the same members' pre-claim
window), per RM of granted bonus. Directional (own-baseline), not causal — holdout proves it.

Reads scratchpad/vip/forward-outcomes-{MK}.json + vip/vip-metrics-{MK}.json (no DB).
Writes scratchpad/vip-recovery-{MK}.json. Loops MY + SG (skips a market with no forward pull).
Usage: python bin/vip_report/perf_recovery.py
"""
import json, os, sys

SCRATCH = os.environ.get("SCRATCH") or (
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")


def load(p):
    fp = os.path.join(SCRATCH, p)
    return json.load(open(fp, encoding="utf-8")) if os.path.exists(fp) else None


for MK, SYM in (("MY", "RM"), ("SG", "S$")):
    fo = load(f"vip/forward-outcomes-{MK}.json")
    vip = load(f"vip/vip-metrics-{MK}.json")
    if not fo or not vip:
        print(f"[{MK}] skip — no forward pull (VIP forward/causal is gated here)")
        continue

    # 7-day headline: Lane A own-baseline lift per RM (the week-one number)
    la = [c for c in vip["codes"] if c.get("lane") == "A-performance"]
    sp7 = sum(c.get("spend") or 0 for c in la)
    lift7 = sum(c.get("ngr_lift") or 0 for c in la)
    windows = [{"days": 7, "per_rm": round(lift7 / sp7, 2) if sp7 else None,
                "n": sum(c.get("claims") or 0 for c in la), "basis": "Lane A 7-day own-baseline lift"}]

    # 30/60/90: member-level forward lift (fwd_ngr − pre_ngr) per RM of bonus, matured only
    for w in (30, 60, 90):
        sp = lf = n = 0
        for r in fo:
            if r.get(f"mature_{w}") and r.get("bonus_amount"):
                sp += r["bonus_amount"]
                lf += (r.get(f"fwd_ngr_{w}") or 0) - (r.get(f"pre_ngr_{w}") or 0)
                n += 1
        windows.append({"days": w, "per_rm": round(lf / sp, 2) if sp else None,
                        "n": n, "spend": round(sp), "basis": f"{w}-day forward vs own {w}-day pre-baseline"})

    # where it crosses break-even (recovery point)
    cross = next((wd["days"] for wd in windows if (wd["per_rm"] or -1) >= 0), None)
    out = {"market": MK, "sym": SYM, "windows": windows, "breakeven_day": cross,
           "final": windows[-1]["per_rm"],
           "basis": ("VIP performance (Lane A) net-revenue LIFT per bonus RM over lengthening windows — "
                     "own-baseline-adjusted (forward minus the same members' pre-claim window). 7-day is the "
                     "Lane A headline; 30/60/90 are the member-level forward pull. Directional (own-baseline), "
                     "not causal — the holdout is the proof.")}
    path = os.path.join(SCRATCH, f"vip-recovery-{MK}.json")
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    curve = " -> ".join(f"{wd['days']}d {wd['per_rm']:+}" for wd in windows)
    print(f"[{MK}] wrote {os.path.basename(path)} — {curve}  (break-even by day {cross})")
