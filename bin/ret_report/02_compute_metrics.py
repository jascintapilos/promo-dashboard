"""Task 3 (rev. after adversarial QC) — per-code retention metrics + rollups + KPIs (MY).

Reads scratchpad/ret/claim-rows-MY.json (per code x member: 7d/14d attribution lift, dep-days
7/30/60/90, tier-at-claim, recency) + ret-codes-MY.json (name, mechanic, is_winback). Emits
scratchpad/ret/ret-metrics-MY.json.

Headline = NGR Lift per RM (Sigma ngr_lift / Sigma bonus_cost). NGR from Daily_GMT8_Snapshot is
NET of the promo bonus (empirically verified: corr(bonus, GGR-NGR)=0.79, GGR-NGR ~= bonus + other),
so break-even = 0 and +NGR-Lift is profit AFTER the bonus's own cost.

Fixes from the 5-lens adversarial QC:
  - win-back is a FLAG (detected on code+name in 00); win-back codes are HELD, and EXCLUDED from the
    rollups / tier_normal / blended KPIs so their near-zero-baseline lift can't inflate the headline.
  - redeposit-uplift comparator is stratified by (tier x mechanic) with an n>=30 fallback ladder
    (reloads require a deposit to claim, so an all-mechanic norm mislabels every reload 'incremental').
  - NGR headline gated on 7-day maturity (mature_7); redeposit/durability on 30/60/90 as before.
  - single-member concentration: top-1 member NGR share + ex-top1 NGR/RM, so one whale can't mint a Scale.
  - Unknown tier is its own bucket (not folded into the real 'Classic' tier).
  - mech_tier_grid cells with n<30 flagged low_n; recency 'no recent deposit (120d+)' (not 'lapsed/none').
Usage: python bin/ret_report/02_compute_metrics.py
"""
import json, re
from collections import defaultdict
from pathlib import Path

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
RET = SCR / "ret"
MIN_NORM_N = 30   # min matured rows for a comparator cell to be trusted before falling back

rows = json.load(open(RET / "claim-rows-MY.json", encoding="utf-8"))
meta = {r["code"]: r for r in json.load(open(RET / "ret-codes-MY.json", encoding="utf-8"))}

TIER_ORDER = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Classic", "Unknown", "Other"]
TIER_KEYWORDS = {"bronze": "Bronze", "silver": "Silver", "gold": "Gold",
                 "platinum": "Platinum", "plat": "Platinum", "diamond": "Diamond"}

def norm_tier(t):
    t = (t or "Unknown").strip()
    if t in ("Agent Credit", "Scammers"): return "Other"
    if t in ("", "Unknown"): return "Unknown"          # keep separate from the real 'Classic' tier
    return re.sub(r"\s*\(Trial\)$", "", t)

def implied_tier(name):
    n = (name or "").lower()
    for kw, tier in TIER_KEYWORDS.items():
        if re.search(r"\b" + kw, n):
            return tier
    return None

def recency_bucket(days):
    if days is None: return "no recent deposit (120d+)"
    if days <= 14: return "active 0-14d"
    if days <= 30: return "cooling 15-30d"
    if days <= 60: return "dormant 31-60d"
    return "lapsed 60-120d"

for r in rows:
    m = meta.get(r["code"], {})
    r["ntier"] = norm_tier(r.get("tier"))
    r["mech"] = m.get("mechanic", "other")
    r["is_winback"] = bool(m.get("is_winback"))
    r["rbucket"] = recency_bucket(r.get("recency_days"))
    r["retained"] = 1 if r.get("redep_days_30", 0) >= 1 else 0

judged = [r for r in rows if not r["is_winback"]]   # win-back held out of comparator/rollups/KPIs

# ---- tier x mechanic redeposit comparator (n>=30 ladder: cell -> mechanic -> global) ----
def acc(keyfn, src):
    d = defaultdict(lambda: [0, 0])
    for r in src:
        if r["mature_30"]:
            v = d[keyfn(r)]; v[1] += 1; v[0] += r["retained"]
    return d
cell = acc(lambda r: (r["ntier"], r["mech"]), judged)
mnorm = acc(lambda r: r["mech"], judged)
gret = [sum(r["retained"] for r in judged if r["mature_30"]), sum(1 for r in judged if r["mature_30"])]
gnorm = gret[0] / gret[1] if gret[1] else 0.0

def tier_normal_lookup(tier, mech):
    c = cell.get((tier, mech))
    if c and c[1] >= MIN_NORM_N: return c[0] / c[1]
    m = mnorm.get(mech)
    if m and m[1] >= MIN_NORM_N: return m[0] / m[1]
    return gnorm

by = defaultdict(list)
for r in rows:
    by[r["code"]].append(r)

def rate(a, b): return round(a / b * 100, 1) if b else None

codes = []
for code, rs in by.items():
    m = meta.get(code, {})
    spend = sum(r["bonus_cost"] for r in rs)                     # full cost basis (display / money-to-move)
    claims = sum(r["claims"] for r in rs)
    m7 = [r for r in rs if r["mature_7"]]                        # 7-day money window observed
    spend_m7 = sum(r["bonus_cost"] for r in m7)
    ngr = sum(r["ngr_lift"] for r in m7)                         # NGR headline gated on 7-day maturity
    dep = sum(r["dep_lift"] for r in m7)
    # single-member NGR concentration (on the money basis)
    mem_ngr = defaultdict(float)
    for r in m7: mem_ngr[r["member"]] += r["ngr_lift"]
    top1 = max(mem_ngr.values()) if mem_ngr else 0.0
    top1_share = round(top1 / ngr, 3) if ngr > 0 else None
    ngr_ex1_per_rm = round((ngr - top1) / spend_m7, 2) if spend_m7 else None
    # redeposit (30d) + mechanic-stratified uplift
    mat30 = [r for r in rs if r["mature_30"]]
    spend_mat = sum(r["bonus_cost"] for r in mat30)
    retained = sum(r["retained"] for r in mat30)
    actual = retained / len(mat30) if mat30 else None
    expected = (sum(tier_normal_lookup(r["ntier"], r["mech"]) for r in mat30) / len(mat30)) if mat30 else None
    # durability
    mat60 = [r for r in rs if r["mature_60"]]; mat90 = [r for r in rs if r["mature_90"]]
    active60 = sum(1 for r in mat60 if (r["dep_days_60"] - r["dep_days_30"]) >= 1)
    active90 = sum(1 for r in mat90 if (r["dep_days_90"] - r["dep_days_60"]) >= 1)
    persist = sum(1 for r in mat30 if r["dep_days_8_29"] >= 1)
    # tier mix / purity
    tmix = defaultdict(float)
    for r in rs: tmix[r["ntier"]] += r["bonus_cost"]
    tier_top = max(tmix, key=tmix.get) if tmix else "Unknown"
    imp = implied_tier(m.get("name", ""))
    purity = round(sum(r["bonus_cost"] for r in rs if r["ntier"] == imp) / spend * 100, 1) if (imp and spend) else None
    codes.append({
        "code": code, "name": m.get("name", ""), "mechanic": m.get("mechanic", ""),
        "is_winback": bool(m.get("is_winback")),
        "claimers": len(rs), "claims": claims, "spend": round(spend),
        "matured_7": len(m7),
        "ngr_lift": round(ngr), "ngr_lift_per_rm": round(ngr / spend_m7, 2) if spend_m7 else None,
        "ngr_top1_share": top1_share, "ngr_lift_per_rm_ex_top1": ngr_ex1_per_rm,
        "dep_lift": round(dep), "dep_lift_per_rm": round(dep / spend_m7, 2) if spend_m7 else None,
        "matured_30": len(mat30), "retained": retained,
        "redeposit_rate": rate(retained, len(mat30)),
        "redeposit_expected": round(expected * 100, 1) if expected is not None else None,
        "redeposit_uplift": round((actual - expected) * 100, 1) if (actual is not None and expected is not None) else None,
        "cost_per_retained": round(spend_mat / retained) if retained else None,
        "persist_8_29": rate(persist, len(mat30)),
        "matured_60": len(mat60), "active_60": rate(active60, len(mat60)),
        "matured_90": len(mat90), "active_90": rate(active90, len(mat90)),
        "avg_bonus_per_claim": round(spend / claims) if claims else None,
        "tier_top": tier_top, "tier_top_share": round(tmix[tier_top] / spend * 100, 1) if spend else None,
        "implied_tier": imp, "target_purity": purity,
    })
codes.sort(key=lambda x: -x["spend"])

# ---- blended KPIs (judged = non-winback) ----
jcodes = [c for c in codes if not c["is_winback"]]
tot_spend = sum(c["spend"] for c in jcodes)
tot_ngr = sum(c["ngr_lift"] for c in jcodes)
spend_m7_all = sum(r["bonus_cost"] for r in judged if r["mature_7"])
tot_mat = sum(c["matured_30"] for c in jcodes)
tot_ret = sum(c["retained"] for c in jcodes)
tot_spend_mat = sum(r["bonus_cost"] for r in judged if r["mature_30"])
wb_spend = sum(c["spend"] for c in codes if c["is_winback"])
kpis = {
    "spend": tot_spend, "winback_spend_held": round(wb_spend),
    "ngr_lift": tot_ngr,
    "ngr_lift_per_rm": round(tot_ngr / spend_m7_all, 2) if spend_m7_all else None,
    "redeposit_rate": rate(tot_ret, tot_mat),
    "players_retained": tot_ret,
    "cost_per_retained": round(tot_spend_mat / tot_ret) if tot_ret else None,
    "claimers": len(judged), "members": len({r["member"] for r in judged}),
}

def rollup(keyfn, src):
    agg = defaultdict(lambda: {"spend": 0.0, "sm7": 0.0, "ngr": 0.0, "mat": 0, "ret": 0, "n": 0, "codes": set()})
    for r in src:
        d = agg[keyfn(r)]
        d["spend"] += r["bonus_cost"]; d["n"] += 1; d["codes"].add(r["code"])
        if r["mature_7"]: d["sm7"] += r["bonus_cost"]; d["ngr"] += r["ngr_lift"]
        if r["mature_30"]: d["mat"] += 1; d["ret"] += r["retained"]
    return agg

def perrm(v): return round(v["ngr"] / v["sm7"], 2) if v["sm7"] else None

mech = rollup(lambda r: r["mech"], judged)
by_mech = [{"mechanic": k, "codes": len(v["codes"]), "spend": round(v["spend"]),
            "ngr_lift": round(v["ngr"]), "ngr_lift_per_rm": perrm(v), "redeposit_rate": rate(v["ret"], v["mat"])}
           for k, v in mech.items()]
by_mech.sort(key=lambda x: -(x["ngr_lift_per_rm"] if x["ngr_lift_per_rm"] is not None else -9))

tier = rollup(lambda r: r["ntier"], judged)
by_tier = [{"tier": k, "codes": len(v["codes"]), "spend": round(v["spend"]),
            "ngr_lift": round(v["ngr"]), "ngr_lift_per_rm": perrm(v), "redeposit_rate": rate(v["ret"], v["mat"])}
           for k, v in tier.items()]
by_tier.sort(key=lambda x: TIER_ORDER.index(x["tier"]) if x["tier"] in TIER_ORDER else 99)

grid = rollup(lambda r: (r["mech"], r["ntier"]), judged)
mech_tier_grid = [{"mechanic": k[0], "tier": k[1], "spend": round(v["spend"]), "n": v["n"],
                   "ngr_lift_per_rm": perrm(v), "low_n": v["n"] < MIN_NORM_N}
                  for k, v in grid.items()]

REC_ORDER = ["active 0-14d", "cooling 15-30d", "dormant 31-60d", "lapsed 60-120d", "no recent deposit (120d+)"]
recb = rollup(lambda r: r["rbucket"], judged)
by_recency = [{"bucket": k, "n": v["n"], "spend": round(v["spend"]),
               "ngr_lift": round(v["ngr"]), "ngr_lift_per_rm": perrm(v), "redeposit_rate": rate(v["ret"], v["mat"])}
              for k, v in recb.items()]
by_recency.sort(key=lambda x: REC_ORDER.index(x["bucket"]) if x["bucket"] in REC_ORDER else 99)

# ---- win-back summary (now detected on code+name; HELD, judged on the VIP tab) ----
wb_codes = [c for c in codes if c["is_winback"]]
winback = {
    "n_codes": len(wb_codes), "spend": round(wb_spend),
    "note": ("Win-back / reactivation codes (churn / comeback / optimove — detected on the code, not just "
             "the name). HELD out of the money matrix and every rollup: a lapsed player's near-zero baseline "
             "mechanically inflates lift-per-RM, so these are judged on the VIP tab with a control, not scaled here."),
}

# tier_normal (reported for transparency): mechanic-level + notable cells
tn_mech = {k: round(v[0] / v[1] * 100, 1) for k, v in mnorm.items() if v[1]}
tn_cell = {f"{t}|{mm}": round(v[0] / v[1] * 100, 1) for (t, mm), v in cell.items() if v[1] >= MIN_NORM_N}

facts = {
    "market": "MY", "currency": "MYR", "period": "2026-01-01 to 2026-08-25", "data_as_of": "2026-08-26",
    "basis": ("TL Pillar=Retention; redeemed/active claims. NGR Lift = 7-day post-claim window vs 14-day "
              "pre-claim baseline (time-decay, concurrency-split), gated on 7-day maturity; NGR is NET of the "
              "promo bonus (verified: corr(bonus,GGR-NGR)=0.79) so break-even=0. Retained = redeposit on days "
              "1-29 (matures 2026-07-28). Redeposit-uplift is directional vs a tier x mechanic comparator "
              "(own-population, n>=30 fallback ladder) — a matched control is the proof step. Win-back codes are "
              "held out of the matrix and rollups."),
    "kpis": kpis, "by_mechanic": by_mech, "by_tier": by_tier, "mech_tier_grid": mech_tier_grid,
    "by_recency": by_recency, "winback": winback,
    "tier_normal_mech": tn_mech, "tier_normal_cell": tn_cell, "codes": codes,
}
json.dump(facts, open(RET / "ret-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---- cross-foot + report ----
assert abs(sum(c["spend"] for c in jcodes) - tot_spend) < 1
print(f"codes: {len(codes)} ({len(jcodes)} judged + {len(wb_codes)} win-back held) | claimers {kpis['claimers']:,} | members {kpis['members']:,}")
print(f"  judged spend RM{tot_spend:,} (+ RM{round(wb_spend):,} win-back held) | NGR Lift RM{tot_ngr:,} | NGR/RM {kpis['ngr_lift_per_rm']} | redeposit {kpis['redeposit_rate']}%")
print("\n  BY MECHANIC (judged):")
for x in by_mech:
    print(f"    {x['mechanic']:12s} {x['codes']:>3}c  RM{x['spend']:>9,}  NGR/RM {str(x['ngr_lift_per_rm']):>6}  redep {x['redeposit_rate']}%")
print("  BY TIER (judged):")
for x in by_tier:
    print(f"    {x['tier']:9s} {x['codes']:>3}c  RM{x['spend']:>9,}  NGR/RM {str(x['ngr_lift_per_rm']):>6}  redep {x['redeposit_rate']}%")
print("  MECH x TIER grid NGR/RM (reload row — should be flatter than by_tier):")
for mm in ("reload", "free-credit", "free-spins"):
    cells = {g["tier"]: g["ngr_lift_per_rm"] for g in mech_tier_grid if g["mechanic"] == mm and not g["low_n"]}
    print(f"    {mm:11s} " + " ".join(f"{t}:{cells.get(t)}" for t in TIER_ORDER if t in cells))
print(f"  win-back: {len(wb_codes)} codes RM{round(wb_spend):,} HELD")
print(f"  tier_normal by mechanic: " + " ".join(f"{k}:{v}%" for k, v in sorted(tn_mech.items())))
# single-member concentration among top-money codes
conc = [c for c in codes if not c["is_winback"] and c["ngr_top1_share"] and c["ngr_top1_share"] > 0.3]
print(f"\n  codes with >30% of NGR from ONE member: {len(conc)}")
for c in sorted(conc, key=lambda x: -x["spend"])[:6]:
    print(f"    {c['code'][:32]:32s} NGR/RM {c['ngr_lift_per_rm']} -> ex-top1 {c['ngr_lift_per_rm_ex_top1']}  (top1 {int(c['ngr_top1_share']*100)}%)  spend RM{c['spend']:,}")
print("Saved scratchpad/ret/ret-metrics-MY.json")
