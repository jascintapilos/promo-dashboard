"""Merge Lane-A (Performance) forward payback into vip-metrics-MY.json. See forward-pull-spec.md (consumer #2).

Lane A is graded on a myopic 7-day NGR lift. This adds the measured 30/60/90-day forward payback
(grain A: forward-outcomes-MY.json) per Lane-A code + a lane rollup, so the tab can show whether a
performance bonus keeps paying past the first week. Observational (own pre-window baseline), not causal.

Merge builder (loads vip-metrics, appends, saves — like decision_layer/whale_detection). NO ClickHouse
pull, so it never refreshes other blocks. Run AFTER the VIP pipeline, once 01d_forward_outcomes.py exists.
Usage: python bin/vip_report/02c_lane_a_forward.py
"""
import json, os
from collections import defaultdict

SCR = os.environ.get(
    "VIP_SCR",
    "C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/"
    "879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad",
)
VIP = os.path.join(SCR, "vip")
PATH = os.path.join(VIP, "vip-metrics-MY.json")

j = json.load(open(PATH, encoding="utf-8"))
claims = json.load(open(os.path.join(VIP, "claim-rows-MY.json"), encoding="utf-8"))
fwd = {(r["code"], r["member"]): r for r in
       json.load(open(os.path.join(VIP, "forward-outcomes-MY.json"), encoding="utf-8"))}

# members per code (claim-rows is one row per code x member)
members_by_code = defaultdict(list)
for r in claims:
    members_by_code[r["code"]].append(r["member"])

def code_forward(code):
    fA = [fwd[(code, mem)] for mem in members_by_code.get(code, []) if (code, mem) in fwd]
    if not fA:
        return None
    def fsum(w, fld): return sum(x[fld] for x in fA if x.get("mature_%d" % w))
    def fbon(w):      return sum(x["bonus_amount"] for x in fA if x.get("mature_%d" % w))
    f90, p90, b90 = fsum(90, "fwd_ngr_90"), fsum(90, "pre_ngr_90"), fbon(90)
    b30, b60 = fbon(30), fbon(60)
    return {
        "fwd_ngr_30": round(fsum(30, "fwd_ngr_30")), "fwd_ngr_60": round(fsum(60, "fwd_ngr_60")), "fwd_ngr_90": round(f90),
        "fwd_ngr_per_rm_30": round(fsum(30, "fwd_ngr_30") / b30, 2) if b30 else None,
        "fwd_ngr_per_rm_60": round(fsum(60, "fwd_ngr_60") / b60, 2) if b60 else None,
        "fwd_ngr_per_rm_90": round(f90 / b90, 2) if b90 else None,
        "fwd_incremental_90": round(f90 - p90),                      # forward NGR net of the player's own pre-90 window
        "fwd_incr_per_rm_90": round((f90 - p90) / b90, 2) if b90 else None,
        "fwd_mature_90": sum(1 for x in fA if x.get("mature_90")), "fwd_claimers": len(fA),
        "_b90": round(b90), "_pre90": round(p90),                   # raw, for the lane rollup only
    }

# per Lane-A code
la_codes = []
for c in j.get("codes", []):
    if c.get("lane") != "A-performance":
        continue
    cf = code_forward(c["code"])
    if not cf:
        continue
    raw_b90, raw_pre90 = cf.pop("_b90"), cf.pop("_pre90")
    c.update(cf)
    la_codes.append((c, raw_b90, raw_pre90))

# lane rollup — 90-day per-RM headline (Σ NGR / Σ mature-90 bonus); 30/60 as the raw NGR ramp
la_f90 = sum(c["fwd_ngr_90"] for c, _, _ in la_codes)
la_b90 = sum(b for _, b, _ in la_codes)
la_pre90 = sum(p for _, _, p in la_codes)
ls = j.setdefault("lane_summary", {}).setdefault("A-performance", {})
ls.update({
    "fwd_ngr_30": sum(c["fwd_ngr_30"] for c, _, _ in la_codes),
    "fwd_ngr_60": sum(c["fwd_ngr_60"] for c, _, _ in la_codes),
    "fwd_ngr_90": la_f90,
    "fwd_ngr_per_rm_90": round(la_f90 / la_b90, 2) if la_b90 else None,
    "fwd_incremental_90": la_f90 - la_pre90,
    "fwd_incr_per_rm_90": round((la_f90 - la_pre90) / la_b90, 2) if la_b90 else None,
    "fwd_mature_90": sum(c["fwd_mature_90"] for c, _, _ in la_codes),
    "fwd_claimers": sum(c["fwd_claimers"] for c, _, _ in la_codes),
    "fwd_ngr_lift_per_rm_7d": ls.get("ngr_lift_per_rm"),          # the 7-day figure, for the "past the first week" contrast
})

json.dump(j, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"Lane-A forward merged -> {PATH}")
print(f"  {len(la_codes)} Lane-A codes with forward data | mature-90 claimers {ls['fwd_mature_90']:,}")
print(f"  7-day NGR/RM {ls.get('fwd_ngr_lift_per_rm_7d')} -> forward 90d NGR/RM {ls['fwd_ngr_per_rm_90']} "
      f"| incremental/RM (vs own pre-90) {ls['fwd_incr_per_rm_90']}")
print(f"  Sigma forward NGR 30/60/90 = RM{ls['fwd_ngr_30']:,} / RM{ls['fwd_ngr_60']:,} / RM{ls['fwd_ngr_90']:,}")
