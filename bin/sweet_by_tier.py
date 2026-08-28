"""Bonus sweet spot BY TIER — how bonus size and type land differently per tier.

Money-pillar analysis (VIP + Retention): the per-tier refinement of the pooled size read.
Reads a pillar's claim-rows (member-level, stays in scratchpad) and its metrics (for
code->mechanic), then cross-tabs net-revenue-per-RM and deposit-lift-per-RM by:
  (1) tier x bonus-size band   — the size sweet spot
  (2) tier x mechanic          — the type sweet spot
NGR net of bonus (break-even 0). Directional own-baseline, not a controlled test.
Emits aggregated `sweet_by_tier` into the pillar metrics.
Usage: python bin/sweet_by_tier.py [vip|ret]   (default vip)
"""
import json, sys
from collections import defaultdict
from pathlib import Path

PILLAR = sys.argv[1] if len(sys.argv) > 1 else "vip"
assert PILLAR in ("vip", "ret"), "pillar must be vip or ret"
SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad") / PILLAR
cr = json.load(open(SCR / "claim-rows-MY.json", encoding="utf-8"))
m = json.load(open(SCR / f"{PILLAR}-metrics-MY.json", encoding="utf-8"))

TIERS = ["Diamond", "Platinum", "Gold", "Silver", "Bronze"]
BANDS = ["<RM50", "RM50\u2013150", "RM150\u2013400", "RM400\u20131000", "RM1000+"]
MECH_LABEL = {"reload": "Deposit reload", "free-credit": "Free credit", "free-spins": "Free spins", "mini-game": "Mini-game"}
MECH_ORDER = ["reload", "free-credit", "free-spins", "mini-game", "other"]
N_FLOOR = 30
FS_INFLATED_MAX = 0.03   # free-spins/mini-game < 3% of a tier's spend = near-zero-cost, paper ROI inflated

norm = lambda t: (t or "Unknown").replace(" (Trial)", "").strip()
def band(a): return "<RM50" if a < 50 else "RM50\u2013150" if a < 150 else "RM150\u2013400" if a < 400 else "RM400\u20131000" if a < 1000 else "RM1000+"
mech_of = {c["code"]: (c.get("mechanic") or "other") for c in m["codes"]}
MECHS = [x for x in MECH_ORDER if x in set(mech_of.values())]
# VIP: judge only the money-judged lanes (Performance + Engagement), matching the deposit-split card —
# cashback (Lane B) and entitlement gifts (Lane C) are not sized for ROI and would distort the read.
lane_of = {c["code"]: c.get("lane") for c in m["codes"]}
MONEY_LANES = ("A-performance", "D-engagement")
in_scope = (lambda code: lane_of.get(code) in MONEY_LANES) if PILLAR == "vip" else (lambda code: True)
# deposit-required vs no-deposit — the realistic axis. A no-deposit bonus of ANY mechanic is a
# giveaway meant to attract/reactivate, so it is judged on deposits pulled in, not net revenue.
def depreq(c):
    dr = c.get("deposit_required")
    return "deposit" if dr is True else "no_deposit" if dr is False else "unknown"
depreq_of = {c["code"]: depreq(c) for c in m["codes"]}
DEPREQ = ["deposit", "no_deposit"]
DEPREQ_LABEL = {"deposit": "Deposit-required", "no_deposit": "No-deposit (giveaway)"}

rows = [r for r in cr if r.get("mature_7")]
size_agg = defaultdict(lambda: {"cost": 0.0, "dep": 0.0, "ngr": 0.0, "n": 0})
mech_agg = defaultdict(lambda: {"cost": 0.0, "dep": 0.0, "ngr": 0.0, "n": 0})
dr_agg = defaultdict(lambda: {"cost": 0.0, "dep": 0.0, "ngr": 0.0, "n": 0})
tier_spend = defaultdict(float)
for r in rows:
    t = norm(r["tier"])
    if t not in TIERS or not in_scope(r["code"]):
        continue
    sd = size_agg[(t, band(r["bonus_cost"]))]
    sd["cost"] += r["bonus_cost"]; sd["dep"] += r["dep_lift"]; sd["ngr"] += r["ngr_lift"]; sd["n"] += 1
    md = mech_agg[(t, mech_of.get(r["code"], "other"))]
    md["cost"] += r["bonus_cost"]; md["dep"] += r["dep_lift"]; md["ngr"] += r["ngr_lift"]; md["n"] += 1
    dq = depreq_of.get(r["code"], "unknown")
    if dq in DEPREQ:
        dd = dr_agg[(t, dq)]
        dd["cost"] += r["bonus_cost"]; dd["dep"] += r["dep_lift"]; dd["ngr"] += r["ngr_lift"]; dd["n"] += 1
    tier_spend[t] += r["bonus_cost"]

def cell(agg, t, k):
    d = agg.get((t, k))
    if not d or d["n"] == 0:
        return None
    return {"tier": t, "key": k, "n": d["n"], "spend": round(d["cost"]),
            "dep_per_rm": round(d["dep"] / d["cost"], 2) if d["cost"] else None,
            "ngr_per_rm": round(d["ngr"] / d["cost"], 2) if d["cost"] else None,
            "thin": d["n"] < N_FLOOR}

size_grid = [c for t in TIERS for b in BANDS if (c := cell(size_agg, t, b))]
mech_grid = [c for t in TIERS for mc in MECHS if (c := cell(mech_agg, t, mc))]
depreq_grid = [c for t in TIERS for dq in DEPREQ if (c := cell(dr_agg, t, dq))]

def best(cells, t):
    cand = [c for c in cells if c["tier"] == t and not c["thin"] and c["ngr_per_rm"] is not None]
    return max(cand, key=lambda c: c["ngr_per_rm"]) if cand else None

per_tier = []
for t in TIERS:
    sb = best(size_grid, t)
    mt = {c["key"]: c for c in mech_grid if c["tier"] == t}
    pays = [MECH_LABEL.get(k, k) for k in MECHS if k in mt and (mt[k]["ngr_per_rm"] or 0) > 0 and not mt[k]["thin"]]
    loses = [MECH_LABEL.get(k, k) for k in MECHS if k in mt and (mt[k]["ngr_per_rm"] or 0) <= 0 and not mt[k]["thin"]]
    # "scalable" pay = a paying mechanic that is NOT a tiny near-zero-cost sweetener
    def inflated(k): return k in ("free-spins", "mini-game") and tier_spend[t] and mt.get(k) and mt[k]["spend"] / tier_spend[t] < FS_INFLATED_MAX
    scalable = [MECH_LABEL.get(k, k) for k in MECHS if k in mt and (mt[k]["ngr_per_rm"] or 0) > 0 and not mt[k]["thin"] and not inflated(k)]
    sweeteners = [MECH_LABEL.get(k, k) for k in MECHS if k in mt and inflated(k)]
    per_tier.append({
        "tier": t, "spend": round(tier_spend[t]),
        "sweet_band": sb["key"] if sb else None, "sweet_band_ngr": sb["ngr_per_rm"] if sb else None,
        "sweet_band_dep": sb["dep_per_rm"] if sb else None,
        "pays": pays, "loses": loses, "scalable_pays": scalable, "sweeteners": sweeteners,
    })

m["sweet_by_tier"] = {
    "pillar": PILLAR, "tiers": TIERS, "size_bands": BANDS, "mechs": MECHS, "mech_labels": MECH_LABEL,
    "depreq": DEPREQ, "depreq_labels": DEPREQ_LABEL, "depreq_grid": depreq_grid,
    "size_grid": size_grid, "mech_grid": mech_grid, "per_tier": per_tier, "n_floor": N_FLOOR,
    "scope": ("Money-judged lanes (Performance + Engagement)" if PILLAR == "vip" else "All retention bonuses"),
    "basis": ("Every matured-7 claim, cut two ways: by the bonus size actually paid, and by mechanic. "
              "Net revenue per RM1 is net of the bonus (0 = paid for itself); deposit-lift per RM1 is extra deposit "
              "driven vs the player-type baseline. The pooled-size read, split by end-of-period tier."),
    "caveat": ("Directional own-baseline, not a controlled test. Read no-deposit bonuses of ANY mechanic (free-credit, "
               "free-spins, or a deposit bonus with no deposit gate) as giveaways meant to pull deposits in \u2014 so judge them "
               "on deposits attracted per RM, not on net revenue, which is negative by design. Deposit-required bonuses are the "
               "ones judged on net revenue, because the player put money in first. Free-spins shows big net-revenue multiples on "
               "tiny spend (each spin costs next to nothing) \u2014 don't read those literally. Cells under 30 claims are marked "
               "thin; a matched holdout is the proof step before resizing."),
}
json.dump(m, open(SCR / f"{PILLAR}-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(SCR / f"{PILLAR}-metrics-MY.json", encoding="utf-8"))  # round-trip

print(f"[{PILLAR.upper()}] SWEET SPOT BY TIER  (mechs: {', '.join(MECHS)})")
for t in TIERS:
    sc = {c["key"]: c for c in size_grid if c["tier"] == t}
    print(f"  {t:9s} size " + " ".join(f"{b}={sc[b]['ngr_per_rm']}{'*' if sc[b]['thin'] else ''}" for b in BANDS if b in sc))
print("  DEPOSIT-REQUIRED (net/RM) vs NO-DEPOSIT giveaway (deposit-attracted/RM):")
for t in TIERS:
    dc = {c["key"]: c for c in depreq_grid if c["tier"] == t}
    dep = dc.get("deposit"); nd = dc.get("no_deposit")
    print(f"    {t:9s} deposit-req net={dep['ngr_per_rm'] if dep else '-'}/RM | no-deposit attracts={nd['dep_per_rm'] if nd else '-'}/RM (net {nd['ngr_per_rm'] if nd else '-'})")
print(f"Merged sweet_by_tier into {PILLAR}-metrics-MY.json.")
