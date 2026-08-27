"""Task 7 — QC the VIP metrics + decisions.

(1) Independently recompute per-code core metrics from RAW claim-rows (spend, matured_7/30, ngr_lift
    on mature_7, ngr_lift_per_rm, ggr_coverage) and compare to vip-metrics-MY.json.
(2) Re-derive each decision from the thresholds (mirror 03's per-lane deciders) and compare.
(3) Program-wide cross-foot to the member ledger (net-negative, subsidy, whale).
(4) Sanity ranges + structural PII guard.
Usage: python bin/vip_report/qc_check.py
"""
import json, re
from collections import defaultdict
from pathlib import Path

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
VOL, GIVE, HI, DEAD, CONC, CONC_HARD, OVER = 15, 0.5, 2.0, 1.0, 0.30, 0.50, 500

rows = json.load(open(VIP / "claim-rows-MY.json", encoding="utf-8"))
meta = {r["code"]: r for r in json.load(open(VIP / "vip-codes-MY.json", encoding="utf-8"))}
m = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))
ledger = json.load(open(VIP / "member-ledger-MY.json", encoding="utf-8"))
mc = {c["code"]: c for c in m["codes"]}
BE_VERDICT = {t: d.get("verdict", "") for t, d in json.load(open(VIP / "cashback-breakeven-MY.json", encoding="utf-8")).get("break_even", {}).items()} if (VIP / "cashback-breakeven-MY.json").exists() else {}
fails = []

for r in rows:
    r["_mech"] = meta.get(r["code"], {}).get("mechanic", "other")

# ---- (1) recompute per-code core (lane-agnostic) ----
by = defaultdict(list)
for r in rows: by[r["code"]].append(r)
for code, rs in by.items():
    m7 = [r for r in rs if r["mature_7"]]; sm7 = sum(r["bonus_cost"] for r in m7)
    spend = sum(r["bonus_cost"] for r in rs); ngr = sum(r["ngr_lift"] for r in m7); ggr = sum(r["w7_ggr"] for r in m7)
    exp = {"spend": round(spend), "matured_7": len(m7), "matured_30": sum(1 for r in rs if r["mature_30"]),
           "ngr_lift": round(ngr), "ngr_lift_per_rm": round(ngr / sm7, 2) if sm7 else None,
           "ggr_coverage": round(ggr / spend, 1) if spend else None}
    got = mc.get(code, {})
    for k, v in exp.items():
        if got.get(k) != v: fails.append(f"[recompute] {code}.{k}: report={got.get(k)} vs raw={v}")

# ---- (2) re-derive decisions (mirror 03) ----
def redecide(c):
    lane = c["lane"]
    if lane == "A-performance":
        money, up = c["ngr_lift_per_rm"], c.get("redeposit_uplift")
        if (c["matured_7"] or 0) < VOL or money is None: return "Monitor"
        if c["matured_30"] < VOL: return "Watch-money"
        incr = (up is not None and up > DEAD)
        if money < 0 and not incr: d = "Stop"
        elif money < 0 and incr: d = "Reduce"
        elif money < GIVE: d = "Optimise"
        elif not incr: d = "Optimise"
        elif money < HI: d = "Maintain"
        else: d = "Scale"
        s, e = c.get("ngr_top1_share"), c.get("ngr_lift_per_rm_ex_top1")
        if d == "Scale" and s and s > CONC and e is not None and e < HI: d = "Optimise" if e < GIVE else "Maintain"
        if d == "Stop" and c.get("size_band") in ("RM400+", "RM150-400"): d = "Reduce"
        return d
    if lane == "B-cashback":
        if (c["matured_30"] or 0) < VOL: return "Monitor"
        v = BE_VERDICT.get(c.get("tier_top"))
        if v:
            if v.startswith("FAILS"): return "Trim"
            if v.startswith("CLEARS"): return "Keep"
            return "Review"
        if not c.get("recovers_cost"): return "Trim"
        return "Keep"
    if lane == "D-engagement":
        if (c.get("matured_7") or 0) < VOL: return "Monitor"
        if not c.get("pays_for_itself"): return "Trim"
        return "Trim" if (c.get("habitual_share") or 0) > 30 else "Keep"
    return "Entitlement"
for c in m["codes"]:
    if redecide(c) != c.get("decision"):
        fails.append(f"[decision] {c['code']} ({c['lane']}): report={c.get('decision')} vs rule={redecide(c)}")

# ---- (3) program-wide cross-foot to ledger ----
p = m.get("program", {})
neg = [d for d in ledger if d["ytd_ngr"] < 0]
if p.get("net_negative_members") != len(neg): fails.append(f"[program] net_negative report={p.get('net_negative_members')} vs {len(neg)}")
if abs(p.get("subsidy_rm", 0) - sum(d["vip_bonus"] for d in neg)) > 1: fails.append("[program] subsidy mismatch")
if abs(p.get("total_bonus", 0) - sum(d["vip_bonus"] for d in ledger)) > 5: fails.append("[program] total_bonus mismatch")

# ---- (4) sanity + PII ----
for c in m["codes"]:
    for k in ("redeposit_rate", "retention_after_loss", "habitual_share", "leakage_share"):
        v = c.get(k)
        if v is not None and (v < 0 or v > 100): fails.append(f"[sanity] {c['code']}.{k}={v}")
midset = {str(d["member"]) for d in ledger}
def walk(o, key=None, out=None):
    if isinstance(o, str) and o in midset: out.append(o)
    elif isinstance(o, dict):
        for k, v in o.items(): walk(v, k, out)
    elif isinstance(o, list):
        for it in o: walk(it, key, out)
    return out
leaked = sorted(set(walk(m, out=[])))
if leaked: fails.append(f"[PII] {len(leaked)} member id(s) as string values e.g. {leaked[:3]}")

print(f"QC: {len(by)} codes recomputed, {len(m['codes'])} decisions re-derived, program cross-foot, PII over {len(midset):,} ids")
if fails:
    print(f"FAIL ({len(fails)}):"); [print("  -", f) for f in fails[:40]]
else:
    print("PASS — metrics cross-foot to raw, decisions follow thresholds (4 lanes), program cross-foots to ledger, ranges sane, no PII.")
from collections import Counter
print("  decisions by lane:", {L: dict(Counter(c["decision"] for c in m["codes"] if c["lane"] == L)) for L in ("A-performance", "B-cashback", "D-engagement", "C-entitlement")})
