#!/usr/bin/env python3
"""Emit the `trend_decomp` block into vip-metrics-MY.json (VIP decision layer, P2).

Answers "why is VIP performance degrading". Reads ONLY existing scratchpad data
(claim-rows + codes) — no ClickHouse pulls. Focus = Lane A (Performance), the
money-judged lane that is degrading. Decomposes the decline in net-revenue-per-RM
into a MIX effect (shift toward no-deposit giveaways) and a RATE effect (within-
group softening), plus a do-nothing projection.

Run: python bin/vip_report/trend_decompose.py
"""
import json, os

SCR = os.environ.get(
    "VIP_SCR",
    "C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/"
    "879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad",
)
VIPDIR = os.path.join(SCR, "vip")
PATH = os.path.join(VIPDIR, "vip-metrics-MY.json")

j = json.load(open(PATH, encoding="utf-8"))
codes = j.get("codes", []) or []
cmap = {c.get("code"): c for c in codes}
claims = json.load(open(os.path.join(VIPDIR, "claim-rows-MY.json"), encoding="utf-8"))

data_as_of = j.get("data_as_of", "")

# ---- monthly Lane-A series, split deposit vs no-deposit ----------------------
mon = {}   # month -> {dep:{spend,ngr}, nod:{spend,ngr}}
for r in claims:
    c = cmap.get(r.get("code"))
    if not c or c.get("lane") != "A-performance" or not r.get("mature_7"):
        continue
    m = (r.get("claim_date") or "")[:7]
    if not m:
        continue
    d = mon.setdefault(m, {"dep": {"spend": 0.0, "ngr": 0.0}, "nod": {"spend": 0.0, "ngr": 0.0}})
    g = "nod" if not c.get("deposit_required") else "dep"
    d[g]["spend"] += r.get("bonus_cost") or 0
    d[g]["ngr"] += r.get("ngr_lift") or 0

months = sorted(mon.keys())
last_month = months[-1] if months else None


def per_rm(x):
    return round(x["ngr"] / x["spend"], 3) if x["spend"] else None


monthly = []
for m in months:
    d = mon[m]
    spend = d["dep"]["spend"] + d["nod"]["spend"]
    ngr = d["dep"]["ngr"] + d["nod"]["ngr"]
    monthly.append({
        "month": m,
        "spend": round(spend),
        "ngr_per_rm": round(ngr / spend, 3) if spend else None,
        "nodep_share": round(d["nod"]["spend"] / spend * 100) if spend else None,
        "partial": (m == last_month and (data_as_of[8:10] or "31") < "28"),
    })

# ---- shift-share decomposition: first half vs second half -------------------
half = len(months) // 2
H1m, H2m = months[:half], months[half:]


def agg(ms):
    dep = {"spend": sum(mon[m]["dep"]["spend"] for m in ms), "ngr": sum(mon[m]["dep"]["ngr"] for m in ms)}
    nod = {"spend": sum(mon[m]["nod"]["spend"] for m in ms), "ngr": sum(mon[m]["nod"]["ngr"] for m in ms)}
    tot = dep["spend"] + nod["spend"]
    return {
        "nodep_share": nod["spend"] / tot if tot else 0,
        "rate_dep": (dep["ngr"] / dep["spend"]) if dep["spend"] else 0,
        "rate_nod": (nod["ngr"] / nod["spend"]) if nod["spend"] else 0,
        "overall": (dep["ngr"] + nod["ngr"]) / tot if tot else 0,
    }


A, B = agg(H1m), agg(H2m)
# overall = share_nod*rate_nod + share_dep*rate_dep ; two-group shift-share
d_share = B["nodep_share"] - A["nodep_share"]
mix_effect = d_share * (A["rate_nod"] - A["rate_dep"])                      # more no-deposit at H1 rates
rate_effect = (B["nodep_share"] * (B["rate_nod"] - A["rate_nod"])
               + (1 - B["nodep_share"]) * (B["rate_dep"] - A["rate_dep"]))  # within-group softening
overall_delta = B["overall"] - A["overall"]

decomposition = {
    "h1_months": H1m, "h2_months": H2m,
    "h1_ngr_per_rm": round(A["overall"], 3), "h2_ngr_per_rm": round(B["overall"], 3),
    "overall_delta": round(overall_delta, 3),
    "mix_effect": round(mix_effect, 3),
    "rate_effect": round(rate_effect, 3),
    "nodep_share_h1": round(A["nodep_share"] * 100), "nodep_share_h2": round(B["nodep_share"] * 100),
    "basis": ("Two-group shift-share of Lane A net-revenue-per-RM, first half vs second half. MIX = the drag "
              "from shifting spend toward no-deposit giveaways (at H1 rates); RATE = within-group softening "
              "(includes tier-level softening). Directional own-baseline, not causal."),
}

# ---- do-nothing projection: least-squares slope over full months ------------
pts = [(i, m["ngr_per_rm"]) for i, m in enumerate(monthly) if m["ngr_per_rm"] is not None and not m["partial"]]
projection = None
if len(pts) >= 3:
    n = len(pts)
    sx = sum(p[0] for p in pts); sy = sum(p[1] for p in pts)
    sxx = sum(p[0] ** 2 for p in pts); sxy = sum(p[0] * p[1] for p in pts)
    denom = (n * sxx - sx * sx) or 1
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    last_i = pts[-1][0]
    proj = [{"step": k, "ngr_per_rm_proj": round(intercept + slope * (last_i + k), 3)} for k in range(1, 4)]
    projection = {
        "slope_per_month": round(slope, 3), "next_3": proj,
        "basis": "Linear extrapolation of the non-partial monthly points (do-nothing baseline).",
        "caveat": "Extrapolation, NOT a forecast; the last month is partial and excluded from the fit.",
    }

trend_decomp = {
    "scope": "Lane A (Performance) — the money-judged VIP lane",
    "monthly": monthly, "decomposition": decomposition, "projection": projection,
}

j["trend_decomp"] = trend_decomp
json.dump(j, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print(f"trend_decomp written -> {PATH}")
print("  monthly Lane A ngr/RM:", ", ".join(f"{m['month'][5:]}:{m['ngr_per_rm']}" + ("*" if m['partial'] else "") for m in monthly))
print(f"  decomposition: H1 {decomposition['h1_ngr_per_rm']} -> H2 {decomposition['h2_ngr_per_rm']} "
      f"(delta {decomposition['overall_delta']}) = mix {decomposition['mix_effect']} + rate {decomposition['rate_effect']}")
print(f"  no-deposit share H1 {decomposition['nodep_share_h1']}% -> H2 {decomposition['nodep_share_h2']}%")
if projection:
    print(f"  projection slope {projection['slope_per_month']}/mo, next3 {[p['ngr_per_rm_proj'] for p in projection['next_3']]}")
