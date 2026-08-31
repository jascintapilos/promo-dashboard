"""Task 5 — per-code acquisition metrics + KPIs + by-mechanic + monthly FTD trend.

Reads scratchpad/acq/claim-outcomes-MY.json (one row per code x member, redeemed/active base)
and acq-codes-MY.json (name, mechanic). Emits scratchpad/acq/acq-metrics-MY.json.

Bases (stated on the report):
  claimers   = distinct members who redeemed/activated the code
  FTD        = members whose first-ever deposit fell within 7 days of the claim
  conversion = FTD / claimers
  purity     = new players (no deposit before claim) / claimers
  cost/FTD   = redeemed bonus cost / FTD
  dep-lift/RM= NEW players' 7-day window deposit / redeemed bonus cost  (acquisition = new money)
  30-day stick = of FTDs with a mature 30-day window, share who deposited again within 30 days
Usage: python bin/acq_report/02_compute_metrics.py
"""
import sys, json, statistics as st
from pathlib import Path
from collections import defaultdict
ROOT = Path(__file__).resolve().parents[2]; sys.path.insert(0, str(ROOT))
from csir_config import CURRENCY, SUF, SYMBOL, MARKET, PERIOD_LABEL, AS_OF, MONTHS

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ACQ = SCR / "acq"
# MONTHS imported from csir_config (every month the window spans; default Jan..Aug 2026)

rows = json.load(open(ACQ / f"claim-outcomes-{SUF}.json", encoding="utf-8"))
meta = {r["code"]: r for r in json.load(open(ACQ / f"acq-codes-{SUF}.json", encoding="utf-8"))}

by = defaultdict(list)
for r in rows:
    by[r["code"]].append(r)

def med(xs): return round(st.median(xs)) if xs else 0

MECH_LABEL = {"FreeSpinBonus": "Free spins", "DepositBonus": "Deposit (reload)", "FreeCredit": "Free credit"}
def mlabel(m): return MECH_LABEL.get(m, m or "")
def is_ref(code): return "REFER" in (code or "").upper()

codes = []
for code, rs in by.items():
    claimers = len(rs)
    spend = sum(r["bonus_cost"] for r in rs)
    ftds = [r for r in rs if r["ftd_in_7d"]]
    ftd = len(ftds)
    new = [r for r in rs if r["is_new"]]
    new_w7 = sum(r["w7_dep"] for r in new)
    new_spend = sum(r["bonus_cost"] for r in new)          # acquisition cost = spend on NEW players only
    ftd_mat = [r for r in ftds if r["mature_30"]]
    stuck = sum(1 for r in ftd_mat if r["dep_days_30"] >= 2)
    mech_raw = meta.get(code, {}).get("mechanic", "")
    codes.append({
        "code": code,
        "name": meta.get(code, {}).get("name", ""),
        "mechanic": mech_raw, "mech_label": mlabel(mech_raw),
        "claimers": claimers,
        "new_players": len(new),
        "ftd": ftd,
        "spend": round(spend), "spend_new": round(new_spend),
        "conversion": round(ftd / claimers * 100, 1) if claimers else 0.0,
        "purity": round(len(new) / claimers * 100, 1) if claimers else 0.0,
        # HEADLINE cost is new-player-attributed: total spend charges existing-player reload bonuses
        # onto new heads and 4x-overstates cost for low-purity codes (the Stage-3 Reduce artifact).
        "cost_per_ftd": round(new_spend / ftd) if ftd else None,
        "cost_per_ftd_total": round(spend / ftd) if ftd else None,
        "dep_lift_per_rm": round(new_w7 / new_spend, 1) if new_spend else None,
        "ftd_mature": len(ftd_mat),
        "stick_30": round(stuck / len(ftd_mat) * 100, 1) if ftd_mat else None,
        "stick_mature_share": round(len(ftd_mat) / ftd * 100) if ftd else None,   # % of FTDs with a matured 30-day window
        "first_dep_median": med([r["first_dep_amt"] for r in ftds]),
        "ngr_w7": round(sum(r["w7_ngr"] for r in rs)),
        "claims": sum(r["claims"] for r in rs),
    })
codes.sort(key=lambda x: -x["spend"])

# blended KPIs — on the GRADED acquisition set (exclude referral: 0 FTD by design inflates cost),
# cost per FTD is new-player-attributed (see per-code note).
graded = [c for c in codes if not is_ref(c["code"])]
tot_spend = sum(c["spend"] for c in codes)                       # total pillar spend (all codes)
tot_spend_new = sum(c["spend_new"] for c in graded)              # new-player spend on graded codes
tot_ftd = sum(c["ftd"] for c in graded)
tot_ftd_mat = sum(c["ftd_mature"] for c in graded)
tot_stuck = sum(1 for r in rows if r["ftd_in_7d"] and r["mature_30"] and r["dep_days_30"] >= 2 and not is_ref(r["code"]))
tot_claimers = sum(c["claimers"] for c in codes)
kpis = {
    "spend": tot_spend,
    "spend_new_graded": tot_spend_new,
    "ftd": tot_ftd,
    "cost_per_ftd": round(tot_spend_new / tot_ftd) if tot_ftd else None,   # new-attributed, graded
    "stick_30": round(tot_stuck / tot_ftd_mat * 100, 1) if tot_ftd_mat else None,
    "claimers": tot_claimers,
    "conversion": round(tot_ftd / tot_claimers * 100, 1) if tot_claimers else 0.0,
}

# by mechanic (new-player-attributed cost + plain label)
mech = defaultdict(lambda: {"spend_new": 0.0, "ftd": 0, "ftd_mat": 0, "stuck": 0, "claimers": 0})
for r in rows:
    if is_ref(r["code"]): continue
    m = meta.get(r["code"], {}).get("mechanic", "?")
    d = mech[m]; d["claimers"] += 1
    if r.get("is_new"): d["spend_new"] += r["bonus_cost"]
    if r["ftd_in_7d"]:
        d["ftd"] += 1
        if r["mature_30"]:
            d["ftd_mat"] += 1
            if r["dep_days_30"] >= 2: d["stuck"] += 1
by_mech = [{"mechanic": m, "mech_label": mlabel(m), "spend": round(d["spend_new"]), "ftd": d["ftd"],
            "cost_per_ftd": round(d["spend_new"]/d["ftd"]) if d["ftd"] else None,
            "stick_30": round(d["stuck"]/d["ftd_mat"]*100,1) if d["ftd_mat"] else None}
           for m, d in mech.items()]
by_mech.sort(key=lambda x: (x["cost_per_ftd"] is None, x["cost_per_ftd"] or 0))

# monthly FTD trend (by claim month)
tr = defaultdict(int)
for r in rows:
    if r["ftd_in_7d"] and not is_ref(r["code"]): tr[r["claim_date"][:7]] += 1   # graded basis (exclude referral), matches the headline KPI
trend = [{"month": m[5:], "ftd": tr.get(m, 0)} for m in MONTHS]

facts = {
    "market": MARKET, "currency": CURRENCY,
    "period": PERIOD_LABEL, "data_as_of": AS_OF,
    "basis": "TL-approved Pillar=Acquisition; redeemed/active claims; FTD=first-ever deposit within 7 days of claim; 30-day stick on matured claims (<=2026-07-28); claims after ~20 Aug have partial 7-day windows",
    "kpis": kpis, "by_mechanic": by_mech, "trend": trend, "trend_partial_month": "08", "codes": codes,
}
json.dump(facts, open(ACQ / f"acq-metrics-{SUF}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# --- cross-foot + sanity ---
assert sum(c["ftd"] for c in codes) == tot_ftd
assert abs(sum(c["spend"] for c in codes) - tot_spend) < 1
bad = [c["code"] for c in codes if c["conversion"] > 100 or c["purity"] > 100 or (c["stick_30"] or 0) > 100]
print(f"codes: {len(codes)} | claimers {tot_claimers:,} | FTDs {tot_ftd:,} | spend {SYMBOL}{tot_spend:,} | blended cost/FTD {SYMBOL}{kpis['cost_per_ftd']} | conv {kpis['conversion']}% | stick {kpis['stick_30']}%")
print(f"  range check (conv/purity/stick <=100): {'OK' if not bad else 'FAIL '+str(bad)}")
print(f"  by mechanic: " + " | ".join(f"{m['mechanic']} RM{m['cost_per_ftd']}/FTD stick {m['stick_30']}%" for m in by_mech))
print(f"  FTD trend: " + " ".join(f"{t['month']}:{t['ftd']}" for t in trend))
print("\n  TOP CODES BY SPEND:")
print(f"  {'CODE':34s} {'MECH':6s} {'CLM':>5} {'FTD':>5} {'CONV':>5} {'PUR':>5} {'RM/FTD':>7} {'LIFT':>5} {'STICK':>6}")
for c in codes[:12]:
    print(f"  {c['code'][:34]:34s} {c['mechanic'][:6]:6s} {c['claimers']:>5} {c['ftd']:>5} {str(c['conversion'])+'%':>5} {str(c['purity'])+'%':>5} {('RM'+str(c['cost_per_ftd'])) if c['cost_per_ftd'] else '  n/a':>7} {(str(c['dep_lift_per_rm'])+'x') if c['dep_lift_per_rm'] is not None else ' n/a':>5} {(str(c['stick_30'])+'%') if c['stick_30'] is not None else '  n/a':>6}")
print("Saved scratchpad/acq/acq-metrics-MY.json")
