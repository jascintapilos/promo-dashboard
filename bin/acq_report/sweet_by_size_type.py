"""Acquisition sweet spot by SIZE and TYPE (no tier — new depositors are pre-tier).

The acquisition analogue of the money-pillar 'sweet spot by tier'. New depositors have no
prior tier, and welcome offers are judged on COST, not net revenue — so this cuts the
acquisition claim-outcomes by bonus-size band and by mechanic, reporting cost per new
depositor (lower = better) and 30-day stick. Referral codes excluded (graded basis).
Emits aggregated `sweet_sizetype` into acq-metrics-MY.json.
Usage: python bin/acq_report/sweet_by_size_type.py
"""
import json
from collections import defaultdict
from pathlib import Path

ACQ = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/acq")
rows = json.load(open(ACQ / "claim-outcomes-MY.json", encoding="utf-8"))
m = json.load(open(ACQ / "acq-metrics-MY.json", encoding="utf-8"))

# acquisition bonuses are small (median ~RM50): finer bands than the VIP/money pillars
BANDS = ["<RM20", "RM20\u201350", "RM50\u2013100", "RM100+"]
def band(a): return "<RM20" if a < 20 else "RM20\u201350" if a < 50 else "RM50\u2013100" if a < 100 else "RM100+"
MECH_LABEL = {"FreeCredit": "Free credit", "DepositBonus": "Deposit (reload)", "FreeSpinBonus": "Free spins"}
MECH_ORDER = ["Free credit", "Deposit (reload)", "Free spins"]
is_ref = lambda code: "REFER" in (code or "").upper()
mech_of = {c["code"]: (c.get("mech_label") or c.get("mechanic") or "other") for c in m["codes"]}
def depreq(c):
    dr = c.get("deposit_required")
    return "Deposit-required" if dr is True else "No-deposit (giveaway)" if dr is False else "unknown"
depreq_of = {c["code"]: depreq(c) for c in m["codes"]}
DEPREQ_ORDER = ["Deposit-required", "No-deposit (giveaway)"]
FTD_FLOOR = 10   # bands/types with fewer new depositors than this are directional only

def agg_over(keyfn):
    g = defaultdict(lambda: {"claims": 0, "new_spend": 0.0, "ftd": 0, "mat30": 0, "stuck": 0})
    for r in rows:
        if is_ref(r["code"]):
            continue
        d = g[keyfn(r)]
        d["claims"] += 1
        if r.get("is_new"):
            d["new_spend"] += r.get("bonus_cost", 0.0)
        if r.get("ftd_in_7d"):
            d["ftd"] += 1
            if r.get("mature_30"):
                d["mat30"] += 1
                if r.get("dep_days_30", 0) >= 2:
                    d["stuck"] += 1
    return g

def rowsify(g, order):
    out = []
    for k in order:
        d = g.get(k)
        if not d or d["claims"] == 0:
            continue
        out.append({"key": k, "claims": d["claims"], "ftd": d["ftd"], "new_spend": round(d["new_spend"]),
                    "cost_per_ftd": round(d["new_spend"] / d["ftd"]) if d["ftd"] else None,
                    "conversion": round(d["ftd"] / d["claims"] * 100) if d["claims"] else None,
                    "stick_30": round(d["stuck"] / d["mat30"] * 100) if d["mat30"] else None,
                    "thin": d["ftd"] < FTD_FLOOR})
    return out

size_rows = rowsify(agg_over(lambda r: band(r.get("bonus_cost", 0.0))), BANDS)
mech_rows = rowsify(agg_over(lambda r: mech_of.get(r["code"], "other")), MECH_ORDER)
depreq_rows = rowsify(agg_over(lambda r: depreq_of.get(r["code"], "unknown")), DEPREQ_ORDER)

def cheapest(cells):
    cand = [c for c in cells if not c["thin"] and c["cost_per_ftd"] is not None]
    return min(cand, key=lambda c: c["cost_per_ftd"]) if cand else None

best_size = cheapest(size_rows)
best_mech = cheapest(mech_rows)
m["sweet_sizetype"] = {
    "bands": BANDS, "mechs": MECH_ORDER, "size_grid": size_rows, "mech_grid": mech_rows,
    "depreq": DEPREQ_ORDER, "depreq_grid": depreq_rows,
    "best_size": best_size["key"] if best_size else None, "best_size_cost": best_size["cost_per_ftd"] if best_size else None,
    "best_mech": best_mech["key"] if best_mech else None, "best_mech_cost": best_mech["cost_per_ftd"] if best_mech else None,
    "ftd_floor": FTD_FLOOR,
    "basis": ("Non-referral acquisition claims cut by the bonus size paid and by mechanic. Cost per new depositor = "
              "new-player bonus spend / first-time depositors won (lower is better); 30-day stick = share of matured "
              "FTDs who deposited again within 30 days. No tier — a first-time depositor has no prior tier."),
    "caveat": ("Observational, not a controlled test: the depositor happened to first-deposit within 7 days of claiming, "
               "not proof the bonus (or its size) caused it. Who gets which size/type differs, and bigger welcome offers "
               "are often deliberately loss-leading. Cells under 10 new depositors are marked thin."),
}
json.dump(m, open(ACQ / "acq-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(ACQ / "acq-metrics-MY.json", encoding="utf-8"))  # round-trip

print("[ACQ] SWEET SPOT BY SIZE + TYPE (cost per new depositor, lower=better)")
print("  BY SIZE:")
for c in size_rows:
    print(f"    {c['key']:9s} claims={c['claims']:>5} ftd={c['ftd']:>4} cost/FTD={('RM'+str(c['cost_per_ftd'])) if c['cost_per_ftd'] is not None else '-':>8} conv={c['conversion']}% stick={c['stick_30']}%{' *thin' if c['thin'] else ''}")
print("  BY TYPE:")
for c in mech_rows:
    print(f"    {c['key']:16s} claims={c['claims']:>5} ftd={c['ftd']:>4} cost/FTD={('RM'+str(c['cost_per_ftd'])) if c['cost_per_ftd'] is not None else '-':>8} conv={c['conversion']}% stick={c['stick_30']}%{' *thin' if c['thin'] else ''}")
print("  DEPOSIT-REQUIRED vs NO-DEPOSIT:")
for c in depreq_rows:
    print(f"    {c['key']:22s} claims={c['claims']:>5} ftd={c['ftd']:>4} cost/FTD={('RM'+str(c['cost_per_ftd'])) if c['cost_per_ftd'] is not None else '-':>8} conv={c['conversion']}% stick={c['stick_30']}%{' *thin' if c['thin'] else ''}")
print(f"  cheapest size: {m['sweet_sizetype']['best_size']} (RM{m['sweet_sizetype']['best_size_cost']}/FTD) · cheapest type: {m['sweet_sizetype']['best_mech']} (RM{m['sweet_sizetype']['best_mech_cost']}/FTD)")
print("Merged sweet_sizetype into acq-metrics-MY.json.")
