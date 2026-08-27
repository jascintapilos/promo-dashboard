"""Task 9 — QC the built acquisition report.

(1) Independently recompute per-code + blended metrics from the RAW claim-outcomes and compare to
    acq-metrics-MY.json (catches aggregation bugs like the stick one).
(2) Re-derive each decision from cost/stick + thresholds and compare (decisions follow the rule).
(3) Sanity: rates in [0,100], cost>0, ftd<=claimers.
(4) PII scan: no member IDs from claim-outcomes appear in the built HTML.
Usage: python bin/acq_report/qc_check.py
"""
import json, statistics as st
from pathlib import Path
from collections import defaultdict

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
ACQ = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/acq")

rows = json.load(open(ACQ / "claim-outcomes-MY.json", encoding="utf-8"))
m = json.load(open(ACQ / "acq-metrics-MY.json", encoding="utf-8"))
mc = {c["code"]: c for c in m["codes"]}
fails = []

# (1) recompute per code
by = defaultdict(list)
for r in rows: by[r["code"]].append(r)
for code, rs in by.items():
    claimers = len(rs)
    ftd = sum(1 for r in rs if r["ftd_in_7d"])
    new = sum(1 for r in rs if r["is_new"])
    spend_f = sum(r["bonus_cost"] for r in rs)
    new_spend_f = sum(r["bonus_cost"] for r in rs if r.get("is_new"))   # acquisition cost basis (new players only)
    spend = round(spend_f)
    ftd_mat = [r for r in rs if r["ftd_in_7d"] and r["mature_30"]]
    stuck = sum(1 for r in ftd_mat if r["dep_days_30"] >= 2)
    exp = {
        "claimers": claimers, "ftd": ftd, "spend": spend, "spend_new": round(new_spend_f),
        "conversion": round(ftd / claimers * 100, 1) if claimers else 0.0,
        "purity": round(new / claimers * 100, 1) if claimers else 0.0,
        "cost_per_ftd": round(new_spend_f / ftd) if ftd else None,   # new-player-attributed (match 02)
        "stick_30": round(stuck / len(ftd_mat) * 100, 1) if ftd_mat else None,
    }
    got = mc[code]
    for k, v in exp.items():
        if got.get(k) != v:
            fails.append(f"[recompute] {code}.{k}: report={got.get(k)} vs raw={v}")

# (2) decision follows thresholds
T = m["thresholds"]
def redecide(c):
    if "REFER" in c["code"].upper(): return "Referral"
    if c.get("purity") is not None and c["purity"] < T.get("reload_purity", 40): return "Reload"
    if c["claimers"] < T["floor_claimers"]: return "Low volume"
    if c["ftd"] == 0: return "Stop"
    cost = c["cost_per_ftd"]; stick = c["stick_30"] if c["stick_30"] is not None else T["stick_median"]
    cheap, dear = cost <= T["cost_per_ftd_p25"], cost >= T["cost_per_ftd_p75"]
    gs = stick >= T["stick_median"]
    if cheap and gs: return "Scale"
    if dear and not gs: return "Reduce"
    if dear or not gs: return "Optimise"
    return "Maintain"
for c in m["codes"]:
    if redecide(c) != c["decision"]:
        fails.append(f"[decision] {c['code']}: report={c['decision']} vs rule={redecide(c)}")

# (3) sanity
for c in m["codes"]:
    if c["conversion"] > 100 or c["purity"] > 100 or (c["stick_30"] or 0) > 100: fails.append(f"[sanity] {c['code']} rate>100")
    if c["cost_per_ftd"] is not None and c["cost_per_ftd"] <= 0: fails.append(f"[sanity] {c['code']} cost<=0")
    if c["ftd"] > c["claimers"]: fails.append(f"[sanity] {c['code']} ftd>claimers")

# blended KPI cross-foot
assert m["kpis"]["spend"] == sum(c["spend"] for c in m["codes"]), "KPI spend mismatch"
assert m["kpis"]["ftd"] == sum(c["ftd"] for c in m["codes"]), "KPI ftd mismatch"

# (4) PII scan
html = (ROOT / "outputs/acq-dashboard-MY.html").read_text(encoding="utf-8")
mids = list({str(r["member"]) for r in rows})
leaked = [x for x in mids if len(x) >= 5 and (x in html)]
if leaked: fails.append(f"[PII] {len(leaked)} member id(s) found in HTML e.g. {leaked[:3]}")

print(f"QC checks: {len(by)} codes recomputed, {len(m['codes'])} decisions re-derived, PII scan over {len(mids):,} member ids")
if fails:
    print(f"FAIL ({len(fails)}):")
    for f in fails[:30]: print("  -", f)
else:
    print("PASS — report cross-foots to raw, decisions follow the thresholds, ranges sane, no member-id PII in HTML.")
print(f"  blended: spend RM{m['kpis']['spend']:,} | FTD {m['kpis']['ftd']:,} | cost/FTD RM{m['kpis']['cost_per_ftd']} | stick {m['kpis']['stick_30']}%")
