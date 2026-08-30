"""Phase 1.1 attribution strengthening — matched-control DiD with a PRE-TREND match (MY).

Coarsened exact matching on (end-tier x anchor-month x pre-90-NGR tertile x PRE-TREND tertile), where
pre-trend = pre_90 - pre_pre_90 (the -180..-90 -> -90..0 slope). Matching on the trajectory (not just the
level) makes treated and control PARALLEL before the claim — the validity condition for the difference-in-
differences. Controls are comparably active (deposited in the pre-window); deltas winsorized.

    DiD = (treated_fwd90 - treated_pre90) - mean_control(fwd90 - pre90)

Reports, per code: own-baseline lift (today's number), the matched-control DiD (Tier-2 candidate), the RTM
gap, AND the residual pre-trend gap (treated slope - control slope; ~0 = parallel = valid). Attributed
(observational), NOT causal (controls still got OTHER promos) — the holdout is Tier 3.

Out: scratchpad/attribution/matched-did-MY.json (per-code aggregate; NO member rows)
Usage: python bin/attribution/phase1_matched_did.py [top_n_per_pillar]
"""
import sys, json, statistics
from pathlib import Path
from collections import defaultdict

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ATTR = SCR / "attribution"
TOP_N = int(sys.argv[1]) if len(sys.argv) > 1 else 10
MIN_CONTROLS = 8

def norm_tier(t): return (t or "Unknown").replace(" (Trial)", "").strip() or "Unknown"
def anchor_of(cd): y, m, _ = str(cd)[:10].split("-"); return f"{y}-{m}-15"
def tertiles(vals):
    s = sorted(vals); return [s[len(s)//3], s[2*len(s)//3]]
def binof(v, edges):
    b = 0
    for e in edges:
        if v > e: b += 1
    return b

# ---- controls (active only) ----
ctrl = [r for r in json.load(open(ATTR / "control-cohort-MY.json", encoding="utf-8")) if r["pre_dep_90"] > 0]
for r in ctrl:
    r["tier"] = norm_tier(r["tier"]); r["trend"] = r["pre_90"] - r["pre_pre_90"]
_cd = sorted(r["fwd_90"] - r["pre_90"] for r in ctrl)
W_LO, W_HI = _cd[int(len(_cd)*0.02)], _cd[int(len(_cd)*0.98)]
def wins(v): return W_LO if v < W_LO else (W_HI if v > W_HI else v)
PRE_E = tertiles([r["pre_90"] for r in ctrl])
TRD_E = tertiles([r["trend"] for r in ctrl])

cell_delta = defaultdict(list)     # (tier,anchor,preBin,trendBin) -> [(member, winsor fwd-pre)]
cell_trend = defaultdict(list)     # -> [control pre-trend]
for r in ctrl:
    key = (r["tier"], r["anchor"], binof(r["pre_90"], PRE_E), binof(r["trend"], TRD_E))
    cell_delta[key].append((r["member"], wins(r["fwd_90"] - r["pre_90"])))
    cell_trend[key].append(r["trend"])

# ---- treated (ret + vip) + tier + pre-trend ----
pretrend = {(r["code"], r["member"]): r["pre_pre_90"] for r in json.load(open(ATTR / "treated-pretrend-MY.json", encoding="utf-8"))}
def load_treated(fwd_path, claim_path, pillar):
    tier_of = {(r["code"], r["member"]): norm_tier(r.get("tier")) for r in json.load(open(claim_path, encoding="utf-8"))}
    rows = []
    for r in json.load(open(fwd_path, encoding="utf-8")):
        if not r.get("mature_90"): continue
        m = str(r["member"]); pp = pretrend.get((r["code"], m))
        if pp is None: continue
        rows.append({"pillar": pillar, "code": r["code"], "member": m, "anchor": anchor_of(r["claim_date"]),
                     "tier": tier_of.get((r["code"], m), "Unknown"), "pre_90": r["pre_ngr_90"],
                     "fwd_90": r["fwd_ngr_90"], "bonus": r["bonus_amount"], "trend": r["pre_ngr_90"] - pp})
    return rows
treated = (load_treated(SCR/"ret/forward-outcomes-MY.json", SCR/"ret/claim-rows-MY.json", "RET")
           + load_treated(SCR/"vip/forward-outcomes-MY.json", SCR/"vip/claim-rows-MY.json", "VIP"))

claimers = defaultdict(set)
for t in treated: claimers[t["code"]].add(t["member"])
bonus_by_code = defaultdict(float); pillar_of = {}
for t in treated: bonus_by_code[t["code"]] += t["bonus"]; pillar_of[t["code"]] = t["pillar"]
ranked = defaultdict(list)
for code, b in bonus_by_code.items(): ranked[pillar_of[code]].append((code, b))
pick = set(c for p in ("RET","VIP") for c, _ in sorted(ranked[p], key=lambda x:-x[1])[:TOP_N])

tre_by_code = defaultdict(list)
for t in treated:
    if t["code"] in pick: tre_by_code[t["code"]].append(t)

results = []
for code, ts in tre_by_code.items():
    own, did, bonus, matched, unmatched, ptgap = [], [], 0.0, 0, 0, []
    for t in ts:
        key = (t["tier"], t["anchor"], binof(t["pre_90"], PRE_E), binof(t["trend"], TRD_E))
        pool = [(m, d) for (m, d) in cell_delta.get(key, []) if m not in claimers[code]]
        if len(pool) < MIN_CONTROLS: unmatched += 1; continue
        cdelta = statistics.mean(d for _, d in pool)
        ctrend = statistics.mean(cell_trend.get(key, [0]))
        t_delta = wins(t["fwd_90"] - t["pre_90"])
        own.append(t_delta); did.append(t_delta - cdelta); bonus += t["bonus"]; matched += 1
        ptgap.append(t["trend"] - ctrend)          # residual pre-trend (treated slope - control slope)
    if matched < 20 or bonus <= 0: continue
    own_sum, did_sum = sum(own), sum(did)
    results.append({"pillar": pillar_of[code], "code": code, "n_treated": matched, "n_unmatched": unmatched,
        "bonus": round(bonus), "own_incr_per_rm": round(own_sum/bonus, 2), "did_incr_per_rm": round(did_sum/bonus, 2),
        "rtm_gap_per_rm": round((own_sum-did_sum)/bonus, 2), "own_incr_ngr": round(own_sum), "did_incr_ngr": round(did_sum),
        "pretrend_gap_med": round(statistics.median(ptgap)) if ptgap else None})   # ~0 = parallel = valid

results.sort(key=lambda r: -r["bonus"])
for r in results:
    r["parallel_trends"] = r["pretrend_gap_med"] is not None and abs(r["pretrend_gap_med"]) < 300
json.dump(results, open(ATTR / "matched-did-MY.json", "w", encoding="utf-8"), default=str)

valid = [r for r in results if r["parallel_trends"]]
tb = sum(r["bonus"] for r in valid); to = sum(r["own_incr_ngr"] for r in valid); td = sum(r["did_incr_ngr"] for r in valid)
# direction of the correction (bonus-weighted), on valid codes
pess = [r for r in valid if r["rtm_gap_per_rm"] < -0.2]     # DiD > own by >0.2 -> report too pessimistic
opti = [r for r in valid if r["rtm_gap_per_rm"] > 0.2]      # DiD < own -> report too optimistic
same = [r for r in valid if abs(r["rtm_gap_per_rm"]) <= 0.2]
bshare = lambda g: round(100 * sum(x["bonus"] for x in g) / tb) if tb else 0
print(f"=== Matched-DiD (Phase 1.1) across ALL codes ===")
print(f"codes with >=20 matched treated: {len(results)} | pass parallel-trends (valid): {len(valid)} | RM{tb:,} bonus covered")
print(f"AGG over valid codes: own {round(to/tb,2)}/RM vs matched-control {round(td/tb,2)}/RM | RTM gap {round((to-td)/tb,2)}/RM ({round(100*(to-td)/to) if to else 0}% of own-baseline)")
print(f"\nDirection of the correction (valid codes, count | % of valid bonus):")
print(f"  report TOO PESSIMISTIC (matched > own): {len(pess):>3} codes | {bshare(pess)}% of bonus")
print(f"  about right (|gap|<=0.2/RM):            {len(same):>3} codes | {bshare(same)}% of bonus")
print(f"  report TOO OPTIMISTIC (matched < own):  {len(opti):>3} codes | {bshare(opti)}% of bonus")
print(f"\nBiggest corrections (valid codes, by |RTM gap/RM|):")
for r in sorted(valid, key=lambda x:-abs(x["rtm_gap_per_rm"]))[:12]:
    d = "too pessimistic" if r["rtm_gap_per_rm"] < 0 else "too optimistic"
    print(f"  {r['code'][:30]:<31}{r['pillar']:<4} own {r['own_incr_per_rm']:>6}/RM -> DiD {r['did_incr_per_rm']:>6}/RM  (gap {r['rtm_gap_per_rm']:>6}, {d})")
inval = [r for r in results if not r["parallel_trends"]]
print(f"\nNO valid observational control ({len(inval)} codes, RM{sum(r['bonus'] for r in inval):,} bonus) -> need the holdout.")
print("Saved scratchpad/attribution/matched-did-MY.json")
