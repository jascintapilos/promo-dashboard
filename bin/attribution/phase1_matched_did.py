"""Phase 1 attribution strengthening — matched-control difference-in-differences (MY).

Coarsened exact matching: each treated claimer is matched to untreated controls in the same
(end-tier x anchor-month x pre-90-NGR band) cell (controls = sampled members NOT claiming that code,
from phase1_control_pull.py). Then the code's incremental NGR is the difference-in-differences:

    DiD = (treated_fwd90 - treated_pre90) - mean_control(fwd90 - pre90)

The control group's own before->after change absorbs regression-to-the-mean (matched on pre-state) and
seasonality (same anchor month). Compared to today's OWN-baseline number (treated_fwd - treated_pre alone),
the gap is the RTM+trend the own-baseline was booking as promo value. Attributed (observational), NOT causal
(controls still received OTHER promos) — the holdout is Tier 3.

Out: scratchpad/attribution/matched-did-MY.json  (per-code, aggregate; NO member rows)
Usage: python bin/attribution/phase1_matched_did.py [top_n_per_pillar]   (default 10)
"""
import sys, json, statistics
from pathlib import Path
from collections import defaultdict

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ATTR = SCR / "attribution"
TOP_N = int(sys.argv[1]) if len(sys.argv) > 1 else 10
MIN_CONTROLS = 8            # per cell
N_BINS = 5                  # pre-90 NGR quantile bins

def norm_tier(t):
    return (t or "Unknown").replace(" (Trial)", "").strip() or "Unknown"

def anchor_of(claim_date):
    y, m, _ = str(claim_date)[:10].split("-")
    return f"{y}-{m}-15"

# ---- load control cohort ----
ctrl = json.load(open(ATTR / "control-cohort-MY.json", encoding="utf-8"))
for r in ctrl:
    r["tier"] = norm_tier(r["tier"])

# ---- pre-90 quantile bin edges (pooled over controls) ----
pre_vals = sorted(r["pre_90"] for r in ctrl)
edges = [pre_vals[int(len(pre_vals) * k / N_BINS)] for k in range(1, N_BINS)]
def binof(v):
    b = 0
    for e in edges:
        if v > e:
            b += 1
    return b

# winsorize deltas (whale NGR tails otherwise dominate every mean) — cap at 2nd/98th pct of control deltas
_cd = sorted(r["fwd_90"] - r["pre_90"] for r in ctrl)
W_LO, W_HI = _cd[int(len(_cd) * 0.02)], _cd[int(len(_cd) * 0.98)]
def wins(v):
    return W_LO if v < W_LO else (W_HI if v > W_HI else v)

# control cell -> list of (member, winsorized fwd-pre), and pre-trend (pre - pre_pre)
cell_delta = defaultdict(list)      # (tier,anchor,bin) -> [(member, fwd90-pre90)]
cell_pretrend = defaultdict(list)   # -> [pre90 - pre_pre90]
for r in ctrl:
    if r["pre_dep_90"] <= 0:      # controls must be comparably active (deposited pre-window), like treated who claimed
        continue
    key = (r["tier"], r["anchor"], binof(r["pre_90"]))
    cell_delta[key].append((r["member"], wins(r["fwd_90"] - r["pre_90"])))
    cell_pretrend[key].append(wins(r["pre_90"] - r["pre_pre_90"]))

# ---- load treated (ret + vip) with tier ----
def load_treated(fwd_path, claim_path, pillar):
    fwd = json.load(open(fwd_path, encoding="utf-8"))
    tier_of = {(r["code"], r["member"]): norm_tier(r.get("tier")) for r in json.load(open(claim_path, encoding="utf-8"))}
    rows = []
    for r in fwd:
        if not r.get("mature_90"):
            continue
        rows.append({"pillar": pillar, "code": r["code"], "member": str(r["member"]),
                     "anchor": anchor_of(r["claim_date"]), "tier": tier_of.get((r["code"], r["member"]), "Unknown"),
                     "pre_90": r["pre_ngr_90"], "fwd_90": r["fwd_ngr_90"], "bonus": r["bonus_amount"]})
    return rows

treated = (load_treated(SCR / "ret/forward-outcomes-MY.json", SCR / "ret/claim-rows-MY.json", "RET")
           + load_treated(SCR / "vip/forward-outcomes-MY.json", SCR / "vip/claim-rows-MY.json", "VIP"))

# claimers per code (to exclude from that code's control pool)
claimers = defaultdict(set)
for t in treated:
    claimers[t["code"]].add(t["member"])

# ---- pick representative codes: top N by total bonus per pillar ----
bonus_by_code = defaultdict(float); pillar_of = {}
for t in treated:
    bonus_by_code[t["code"]] += t["bonus"]; pillar_of[t["code"]] = t["pillar"]
ranked = defaultdict(list)
for code, b in bonus_by_code.items():
    ranked[pillar_of[code]].append((code, b))
pick = []
for p in ("RET", "VIP"):
    pick += [c for c, _ in sorted(ranked[p], key=lambda x: -x[1])[:TOP_N]]
pick = set(pick)

# ---- per-code matched DiD ----
tre_by_code = defaultdict(list)
for t in treated:
    if t["code"] in pick:
        tre_by_code[t["code"]].append(t)

results = []
for code, ts in tre_by_code.items():
    own, did, bonus, matched, unmatched = [], [], 0.0, 0, 0
    bal_t, bal_c = [], []
    for t in ts:
        key = (t["tier"], t["anchor"], binof(t["pre_90"]))
        pool = [(m, d) for (m, d) in cell_delta.get(key, []) if m not in claimers[code]]
        if len(pool) < MIN_CONTROLS:
            unmatched += 1; continue
        cdelta = statistics.mean(d for _, d in pool)
        t_delta = wins(t["fwd_90"] - t["pre_90"])
        own.append(t_delta)                      # own-baseline "lift"
        did.append(t_delta - cdelta)             # matched-control DiD
        bonus += t["bonus"]; matched += 1
        bal_t.append(t["pre_90"]); bal_c.append(t["pre_90"] - (t["pre_90"]))  # placeholder; balance uses cell below
    if matched < 20 or bonus <= 0:
        continue
    own_sum, did_sum = sum(own), sum(did)
    # control-side pre-trend across this code's used cells (should be ~0 if parallel)
    used_keys = {(t["tier"], t["anchor"], binof(t["pre_90"])) for t in ts}
    pretrend = [v for k in used_keys for v in cell_pretrend.get(k, [])]
    results.append({
        "pillar": pillar_of[code], "code": code, "n_treated": matched, "n_unmatched": unmatched,
        "bonus": round(bonus),
        "own_incr_per_rm": round(own_sum / bonus, 2),          # what the report shows today
        "did_incr_per_rm": round(did_sum / bonus, 2),          # matched-control (Tier 2 candidate)
        "rtm_gap_per_rm": round((own_sum - did_sum) / bonus, 2),  # RTM+trend the own-baseline over-booked
        "own_incr_ngr": round(own_sum), "did_incr_ngr": round(did_sum),
        "ctrl_pretrend_med": round(statistics.median(pretrend)) if pretrend else None,  # placebo: ~0 = parallel
    })

results.sort(key=lambda r: -r["bonus"])
json.dump(results, open(ATTR / "matched-did-MY.json", "w", encoding="utf-8"), default=str)

print(f"Matched-DiD on {len(results)} codes (top {TOP_N}/pillar) | control pool {len({r['member'] for r in ctrl}):,} members")
print(f"{'code':<34}{'pillar':<5}{'nT':>5}{'own/RM':>9}{'DiD/RM':>9}{'RTMgap':>9}{'ctrlTrend':>10}")
for r in results:
    print(f"{r['code'][:33]:<34}{r['pillar']:<5}{r['n_treated']:>5}{r['own_incr_per_rm']:>9}{r['did_incr_per_rm']:>9}{r['rtm_gap_per_rm']:>9}{str(r['ctrl_pretrend_med']):>10}")
# program-level
tot_bonus = sum(r["bonus"] for r in results)
tot_own = sum(r["own_incr_ngr"] for r in results); tot_did = sum(r["did_incr_ngr"] for r in results)
print(f"\nAGG (these codes): own {round(tot_own/tot_bonus,2)}/RM vs matched-control {round(tot_did/tot_bonus,2)}/RM "
      f"| RTM+trend gap {round((tot_own-tot_did)/tot_bonus,2)}/RM ({round(100*(tot_own-tot_did)/tot_own) if tot_own else 0}% of the own-baseline lift)")
print("Saved scratchpad/attribution/matched-did-MY.json")
