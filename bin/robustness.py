"""Trust / fragility layer — per-code coverage + one-member fragility, all pillars.

Emits a uniform `robustness` object onto every graded code:
  {n, matured_pct, top1_share, ex_top1_per_rm, survives, provisional}
Retention reuses existing ngr_top1_share / ngr_lift_per_rm_ex_top1; VIP computes the
top member's share from claim-rows; Acquisition is head-count (coverage only).
Aggregated only. Run after the pillar metrics builders.
Usage: python bin/robustness.py
"""
import json
from collections import defaultdict
from pathlib import Path

S = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
N_FLOOR = 30        # money-judged codes below this many claimers = thin
FTD_FLOOR = 10      # acquisition codes below this many new depositors = thin
WHALE = 0.50        # one member >= half the code's value = one-whale-carried

def pct(a, b): return round(a / b * 100) if b else None

# ---- RETENTION (fields already present) ----
ret = json.load(open(S / "ret/ret-metrics-MY.json", encoding="utf-8"))
for c in ret["codes"]:
    n = c.get("claimers", 0); mat = c.get("matured_30", 0)
    top1 = c.get("ngr_top1_share"); ex = c.get("ngr_lift_per_rm_ex_top1"); perrm = c.get("ngr_lift_per_rm")
    if top1 is not None and not (0 <= top1 <= 1.2): top1 = None       # unstable when net NGR is small/offsetting
    survives = None if (ex is None or perrm is None) else (ex >= 0 if perrm >= 0 else ex < 0)
    prov = bool(c.get("provisional") or n < N_FLOOR or (top1 is not None and top1 >= WHALE) or survives is False)
    c["robustness"] = {"n": n, "matured_pct": pct(mat, n), "top1_share": round(top1 * 100) if top1 is not None else None,
                       "ex_top1_per_rm": ex, "survives": survives, "provisional": prov}
json.dump(ret, open(S / "ret/ret-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---- VIP (compute top member from claim-rows) ----
vip = json.load(open(S / "vip/vip-metrics-MY.json", encoding="utf-8"))
cr = json.load(open(S / "vip/claim-rows-MY.json", encoding="utf-8"))
mem = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))     # code -> member -> [ngr, cost]
for r in cr:
    m = mem[r["code"]][r["member"]]; m[0] += r["ngr_lift"]; m[1] += r["bonus_cost"]
for c in vip["codes"]:
    d = mem.get(c["code"], {}); n = c.get("claimers", 0); mat = c.get("matured_30", 0)
    perrm = c.get("ngr_lift_per_rm")
    top1 = ex = survives = None
    if d:
        tot_ngr = sum(v[0] for v in d.values()); tot_cost = sum(v[1] for v in d.values())
        tm = max(d.values(), key=lambda v: v[0])
        top1 = (tm[0] / tot_ngr) if tot_ngr > 0 else None
        if top1 is not None and top1 > 1.2: top1 = None              # unstable when net NGR is small/offsetting
        rem_cost = tot_cost - tm[1]
        ex = round((tot_ngr - tm[0]) / rem_cost, 2) if rem_cost else None
        if ex is not None and perrm is not None:
            survives = ex >= 0 if perrm >= 0 else ex < 0
    prov = bool(n < N_FLOOR or (top1 is not None and top1 >= WHALE) or survives is False)
    c["robustness"] = {"n": n, "matured_pct": pct(mat, n), "top1_share": round(top1 * 100) if top1 is not None else None,
                       "ex_top1_per_rm": ex, "survives": survives, "provisional": prov}
json.dump(vip, open(S / "vip/vip-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---- ACQUISITION (head-count coverage) ----
acq = json.load(open(S / "acq/acq-metrics-MY.json", encoding="utf-8"))
for c in acq["codes"]:
    n = c.get("ftd", 0)
    c["robustness"] = {"n": n, "matured_pct": c.get("stick_mature_share"), "top1_share": None,
                       "ex_top1_per_rm": None, "survives": None, "provisional": bool(n < FTD_FLOOR)}
json.dump(acq, open(S / "acq/acq-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

for nm, mp, floor in [("RET", ret, N_FLOOR), ("VIP", vip, N_FLOOR), ("ACQ", acq, FTD_FLOOR)]:
    codes = mp["codes"]; prov = sum(1 for c in codes if c["robustness"]["provisional"])
    whale = sum(1 for c in codes if (c["robustness"]["top1_share"] or 0) >= WHALE * 100)
    print(f"{nm}: {len(codes)} codes | provisional {prov} | one-whale-carried (top1>=50%) {whale}")
print("Merged robustness into all three pillar metrics.")
