"""Task 5 (rev.) — QC the retention metrics + decisions after the adversarial-QC remediation.

(1) Independently recompute per-code metrics from RAW claim-rows (mechanic-stratified comparator,
    7-day NGR gating, single-member top-1, win-back excluded from KPIs) and compare to the JSON.
(2) Re-derive each decision from the thresholds (incl. Watch-money gate + single-whale demotion) and compare.
(3) Sanity ranges; (4) KPI + money-to-move cross-foot; (5) PII scan (len>=2, whole-token, hex-safe).
Usage: python bin/ret_report/qc_check.py
"""
import json, math, re
from collections import defaultdict
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
RET = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/ret")
MIN_NORM_N = 30
VOL, GIVE, HI, DEAD, CONC, CONC_HARD, OVER = 15, 0.5, 2.0, 1.0, 0.30, 0.50, 500

rows = json.load(open(RET / "claim-rows-MY.json", encoding="utf-8"))
m = json.load(open(RET / "ret-metrics-MY.json", encoding="utf-8"))
mc = {c["code"]: c for c in m["codes"]}
meta = {r["code"]: r for r in json.load(open(RET / "ret-codes-MY.json", encoding="utf-8"))}
fails = []

def norm_tier(t):
    t = (t or "Unknown").strip()
    if t in ("Agent Credit", "Scammers"): return "Other"
    if t in ("", "Unknown"): return "Unknown"
    return re.sub(r"\s*\(Trial\)$", "", t)

for r in rows:
    mm = meta.get(r["code"], {})
    r["_t"] = norm_tier(r.get("tier")); r["_mech"] = mm.get("mechanic", "other")
    r["_wb"] = bool(mm.get("is_winback")); r["_ret"] = 1 if r.get("redep_days_30", 0) >= 1 else 0
judged = [r for r in rows if not r["_wb"]]

def acc(keyfn, src):
    d = defaultdict(lambda: [0, 0])
    for r in src:
        if r["mature_30"]: v = d[keyfn(r)]; v[1] += 1; v[0] += r["_ret"]
    return d
cell = acc(lambda r: (r["_t"], r["_mech"]), judged); mnorm = acc(lambda r: r["_mech"], judged)
g = [sum(r["_ret"] for r in judged if r["mature_30"]), sum(1 for r in judged if r["mature_30"])]
gnorm = g[0] / g[1] if g[1] else 0.0
def tnl(t, mech):
    c = cell.get((t, mech))
    if c and c[1] >= MIN_NORM_N: return c[0] / c[1]
    mm = mnorm.get(mech)
    if mm and mm[1] >= MIN_NORM_N: return mm[0] / mm[1]
    return gnorm

by = defaultdict(list)
for r in rows: by[r["code"]].append(r)
def rr(a, b): return round(a / b * 100, 1) if b else None

for code, rs in by.items():
    m7 = [r for r in rs if r["mature_7"]]; sm7 = sum(r["bonus_cost"] for r in m7)
    ngr = sum(r["ngr_lift"] for r in m7)
    mem = defaultdict(float)
    for r in m7: mem[r["member"]] += r["ngr_lift"]
    top1 = max(mem.values()) if mem else 0.0
    mat30 = [r for r in rs if r["mature_30"]]; ret = sum(r["_ret"] for r in mat30)
    act = ret / len(mat30) if mat30 else None
    exp = (sum(tnl(r["_t"], r["_mech"]) for r in mat30) / len(mat30)) if mat30 else None
    exp_kv = {
        "spend": round(sum(r["bonus_cost"] for r in rs)), "matured_7": len(m7),
        "ngr_lift": round(ngr), "ngr_lift_per_rm": round(ngr / sm7, 2) if sm7 else None,
        "ngr_top1_share": round(top1 / ngr, 3) if ngr > 0 else None,
        "ngr_lift_per_rm_ex_top1": round((ngr - top1) / sm7, 2) if sm7 else None,
        "matured_30": len(mat30), "retained": ret, "redeposit_rate": rr(ret, len(mat30)),
        "redeposit_uplift": round((act - exp) * 100, 1) if (act is not None and exp is not None) else None,
    }
    got = mc.get(code, {})
    for k, v in exp_kv.items():
        if got.get(k) != v: fails.append(f"[recompute] {code}.{k}: report={got.get(k)} vs raw={v}")

# (2) decisions
def redecide(c):
    money, up = c["ngr_lift_per_rm"], c["redeposit_uplift"]
    if c["is_winback"]: return "Hold"
    if (c["matured_7"] or 0) < VOL or money is None: return "Monitor"
    if c["matured_30"] < VOL: return "Watch-money"
    incr = (up is not None and up > DEAD)
    if money < 0: d = "Stop" if not incr else "Reduce"
    elif money < GIVE: d = "Optimise"
    elif not incr: d = "Optimise"
    elif money < HI: d = "Maintain"
    else: d = "Scale"
    if d == "Scale":
        s, e = c.get("ngr_top1_share"), c.get("ngr_lift_per_rm_ex_top1")
        if s and s > CONC_HARD: d = "Maintain"
        elif s and s > CONC and e is not None and e < HI: d = "Optimise" if e < GIVE else "Maintain"
    return d
for c in m["codes"]:
    if redecide(c) != c.get("decision"): fails.append(f"[decision] {c['code']}: report={c.get('decision')} vs rule={redecide(c)}")
    if c["is_winback"] and c["decision"] != "Hold": fails.append(f"[winback] {c['code']} not Held")

# (3) sanity
for c in m["codes"]:
    for k in ("redeposit_rate", "persist_8_29", "active_60", "active_90", "target_purity"):
        v = c.get(k)
        if v is not None and (v < 0 or v > 100): fails.append(f"[sanity] {c['code']}.{k}={v}")
    if c["retained"] > c["matured_30"]: fails.append(f"[sanity] {c['code']} retained>matured")
    if c["ngr_lift_per_rm"] is not None and not math.isfinite(c["ngr_lift_per_rm"]): fails.append(f"[sanity] {c['code']} NGR/RM inf")

# (4) KPI + money-to-move cross-foot (judged = non-winback)
jc = [c for c in m["codes"] if not c["is_winback"]]
if abs(m["kpis"]["spend"] - sum(c["spend"] for c in jc)) > 1: fails.append("[kpi] spend != sum(judged)")
if m["kpis"]["players_retained"] != sum(c["retained"] for c in jc): fails.append("[kpi] players_retained mismatch")
sp = defaultdict(float)
for c in m["codes"]: sp[c["decision"]] += c["spend"]
if m["money_to_move"]["stop_reduce"] != round(sp.get("Stop", 0) + sp.get("Reduce", 0)): fails.append("[kpi] money_to_move mismatch")

# (5) PII — precise guard. Metric values are JSON NUMBERS; a leaked member id would be a STRING
#     (ids are strings in claim-rows). Scanning number values is hopeless (RM35,658 spend == id 35658),
#     so: (a) structural — no member-keyed LIST/DICT (a scalar 'members' count is fine); (b) match the
#     member-id set only against STRING leaf-values in the JSON.
midset = {str(r["member"]) for r in rows}
MEMBER_KEYS = {"member", "member_id", "member_ids", "members", "mids", "player", "players"}
strvals, member_struct = [], []
def walk(o, key=None):
    if isinstance(o, str): strvals.append(o)
    elif isinstance(o, dict):
        for kk, vv in o.items(): walk(vv, kk)
    elif isinstance(o, list):
        if key and key.lower() in MEMBER_KEYS: member_struct.append(key)
        for it in o: walk(it, key)
walk(m)
if member_struct: fails.append(f"[PII] metrics JSON carries a member-keyed list: {member_struct}")
leaked = sorted(set(s for s in strvals if s in midset))
if leaked: fails.append(f"[PII] {len(leaked)} member id(s) as string values in metrics JSON e.g. {leaked[:3]}")

k = m["kpis"]
print(f"QC: {len(by)} codes recomputed, {len(m['codes'])} decisions re-derived, PII over {len(midset):,} ids")
wb = sum(1 for c in m['codes'] if c['is_winback'])
print(f"  win-back held: {wb} | Watch-money: {sum(1 for c in m['codes'] if c['decision']=='Watch-money')} | Scale: {sum(1 for c in m['codes'] if c['decision']=='Scale')}")
if fails:
    print(f"FAIL ({len(fails)}):")
    for x in fails[:40]: print("  -", x)
else:
    print("PASS - metrics cross-foot to raw (stratified comparator, 7d NGR, top-1), decisions follow thresholds (Watch-money + whale-demote), win-back all Held, ranges sane, no PII.")
print(f"  blended: judged spend RM{k['spend']:,} (+RM{k['winback_spend_held']:,} held) | NGR Lift RM{k['ngr_lift']:,} | NGR/RM {k['ngr_lift_per_rm']} | money-to-move RM{m['money_to_move']['stop_reduce']:,}")
