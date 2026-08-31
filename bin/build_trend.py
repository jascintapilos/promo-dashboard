"""Month-over-month trend (MY) — reconstructed from the cached per-claim rows.

Buckets every claim by its claim-month and computes, per month:
  - spend by pillar (Acquisition / Retention non-Hold / VIP all-lanes)
  - money-is-judge EFFICIENCY = incremental NGR per RM (Retention non-Hold + VIP Lane A;
    cashback ring-fenced out), computed over MATURED-7 claims for a fair month-to-month read
  - acquisition cost-per-FTD (new-player spend / new FTDs)
  - VIP cashback spend (ring-fenced, shown separately)
  - claim volume by pillar
August is provisional (7-day windows for late-Aug claims haven't matured).
Self-checks: Σ monthly rolls up to the published pillar headlines (asserts within tolerance).
Writes scratchpad/trend-MY.json. NGR is net of the bonus (break-even 0) — never re-subtract.
Usage: python bin/build_trend.py
"""
import json
from collections import defaultdict
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csir_config import SUF, CURRENCY, MARKET, AS_OF, MONTHS

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
MON_LABELS = {"01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
              "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec"}
PARTIAL = {MONTHS[-1]}  # last month's 7-day windows aren't matured at the data cut -> provisional

def mkey(d): return d[:7]  # YYYY-MM

# ---- load ----
ret_m = json.load(open(SCR / f"ret/ret-metrics-{SUF}.json", encoding="utf-8"))
holds = set(c["code"] for c in ret_m["codes"] if c["decision"] == "Hold")
ret_rows = json.load(open(SCR / f"ret/claim-rows-{SUF}.json", encoding="utf-8"))
vip_m = json.load(open(SCR / f"vip/vip-metrics-{SUF}.json", encoding="utf-8"))
lane = {c["code"]: c["lane"] for c in vip_m["codes"]}
vip_rows = json.load(open(SCR / f"vip/claim-rows-{SUF}.json", encoding="utf-8"))
acq_out = json.load(open(SCR / f"acq/claim-outcomes-{SUF}.json", encoding="utf-8"))

# ---- per-month accumulators ----
# spend by pillar (money out the door each month)
sp_acq, sp_ret, sp_vip, sp_cashback = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float)
cl_acq, cl_ret, cl_vip = defaultdict(int), defaultdict(int), defaultdict(int)
# efficiency (money-is-judge): matured-7 spend + ngr for Retention non-Hold + VIP Lane A.
# Split by component — retention and VIP performance are OPPOSITE stories, a blend would mislead.
eff_sp, eff_ng = defaultdict(float), defaultdict(float)          # combined (roll-up + frontier consistency)
re_sp, re_ng = defaultdict(float), defaultdict(float)            # retention non-Hold
va_sp, va_ng = defaultdict(float), defaultdict(float)            # VIP A-performance
# acquisition cost-per-FTD: new-player spend + new FTDs
acq_spnew, acq_ftd = defaultdict(float), defaultdict(int)

for r in ret_rows:
    m = mkey(r["claim_date"])
    if r["code"] in holds:
        continue
    sp_ret[m] += r["bonus_cost"]; cl_ret[m] += r.get("claims", 1)
    if r["mature_7"]:
        eff_sp[m] += r["bonus_cost"]; eff_ng[m] += r["ngr_lift"]
        re_sp[m] += r["bonus_cost"]; re_ng[m] += r["ngr_lift"]

for r in vip_rows:
    m = mkey(r["claim_date"]); L = lane.get(r["code"])
    sp_vip[m] += r["bonus_cost"]; cl_vip[m] += r.get("claims", 1)
    if L == "B-cashback":
        sp_cashback[m] += r["bonus_cost"]
    if L == "A-performance" and r["mature_7"]:
        eff_sp[m] += r["bonus_cost"]; eff_ng[m] += r["ngr_lift"]
        va_sp[m] += r["bonus_cost"]; va_ng[m] += r["ngr_lift"]

for r in acq_out:
    m = mkey(r["claim_date"])
    sp_acq[m] += r["bonus_cost"]; cl_acq[m] += r.get("claims", 1)
    if r["is_new"]:
        acq_spnew[m] += r["bonus_cost"]
        if r["ftd_in_7d"]:
            acq_ftd[m] += 1

months = sorted(set(list(sp_acq) + list(sp_ret) + list(sp_vip)))
labels = [MON_LABELS[m[5:7]] for m in months]

def col(dd, ms): return [round(dd.get(m, 0)) for m in ms]

rr = lambda n, s: round(n / s, 2) if s else None
efficiency = []
for m in months:
    s, n = eff_sp.get(m, 0), eff_ng.get(m, 0)
    efficiency.append({"month": m, "spend_m7": round(s), "ngr_m7": round(n), "per_rm": rr(n, s),
                       "per_rm_ret": rr(re_ng.get(m, 0), re_sp.get(m, 0)), "ret_spend": round(re_sp.get(m, 0)),
                       "per_rm_vip": rr(va_ng.get(m, 0), va_sp.get(m, 0)), "vip_spend": round(va_sp.get(m, 0))})
acq_series = []
for m in months:
    s, f = acq_spnew.get(m, 0), acq_ftd.get(m, 0)
    acq_series.append({"month": m, "spend_new": round(s), "ftd": f,
                       "cost_per_ftd": round(s / f) if f else None})

# ---- headline read: retention vs VIP performance are opposite stories (exclude partial Aug) ----
full = [e for e in efficiency if e["month"] not in PARTIAL]
first3, last3 = full[:3], full[-3:]
avg = lambda xs, k: round(sum((x[k] or 0) for x in xs) / len(xs), 2) if xs else None
ret_early, ret_late = avg(first3, "per_rm_ret"), avg(last3, "per_rm_ret")
vip_early, vip_late = avg(first3, "per_rm_vip"), avg(last3, "per_rm_vip")
def direction(e, l):
    return "improving" if (l is not None and e is not None and l > e + 0.05) else \
           "degrading" if (l is not None and e is not None and l < e - 0.05) else "broadly flat"

out = {
    "market": MARKET, "currency": CURRENCY, "data_as_of": AS_OF,
    "months": months, "labels": labels, "partial": {m: True for m in months if m in PARTIAL},
    "spend_by_pillar": {"acq": col(sp_acq, months), "ret": col(sp_ret, months), "vip": col(sp_vip, months)},
    "cashback_spend": col(sp_cashback, months),
    "claims": {"acq": col(cl_acq, months), "ret": col(cl_ret, months), "vip": col(cl_vip, months)},
    "efficiency": efficiency,
    "acq": acq_series,
    "read": {"ret_early": ret_early, "ret_late": ret_late, "ret_dir": direction(ret_early, ret_late),
             "vip_early": vip_early, "vip_late": vip_late, "vip_dir": direction(vip_early, vip_late)},
}
json.dump(out, open(SCR / f"trend-{SUF}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---- self-checks: roll-up to published headlines ----
def close(a, b, tol): return abs(a - b) <= tol
checks = []
eff_ng_tot = sum(eff_ng.values())
RET_SPEND, RET_NGR = ret_m["kpis"]["spend"], ret_m["kpis"]["ngr_lift"]
VIPA_NGR = vip_m["lane_summary"]["A-performance"]["ngr_lift"]
acq_k = json.load(open(SCR / f"acq/acq-metrics-{SUF}.json", encoding="utf-8"))["kpis"]
checks.append(("RET spend (all non-Hold)", sum(sp_ret.values()), RET_SPEND, 50))
checks.append(("efficiency NGR (retM7 + vipA_M7)", eff_ng_tot, RET_NGR + VIPA_NGR, 50))
checks.append(("ACQ new-FTD total", sum(acq_ftd.values()), acq_k["ftd"], 2))
checks.append(("ACQ new-spend total", sum(acq_spnew.values()), acq_k["spend_new_graded"], 50))

print(f"TREND built: {len(months)} months {months[0]}..{months[-1]} (partial: {list(out['partial'])})")
print(f"  efficiency per-RM by month: " + " · ".join(f"{MON_LABELS[e['month'][5:7]]} {e['per_rm']}" for e in efficiency))
print(f"  acq cost/FTD by month: " + " · ".join(f"{MON_LABELS[a['month'][5:7]]} {a['cost_per_ftd']}" for a in acq_series))
print(f"  READ: retention {out['read']['ret_dir']} ({ret_early}->{ret_late}/RM) | VIP performance {out['read']['vip_dir']} ({vip_early}->{vip_late}/RM)")
print(f"  VIP-A per-RM by month: " + " · ".join(f"{MON_LABELS[e['month'][5:7]]} {e['per_rm_vip']}" for e in efficiency))
print("  SELF-CHECKS (sum-of-monthly vs published headline):")
ok = True
for name, got, exp, tol in checks:
    good = close(got, exp, tol); ok = ok and good
    print(f"    [{'PASS' if good else 'FAIL'}] {name}: monthly={got:,.0f} vs headline={exp:,.0f} (tol {tol})")
print("  =>", "ALL ROLL-UP CHECKS PASS" if ok else "ROLL-UP MISMATCH — investigate")
