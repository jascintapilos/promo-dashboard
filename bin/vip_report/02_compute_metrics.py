"""Task 4 — per-code VIP metrics by lane + revenue quality + rollups (MY).

Reads claim-rows-MY.json (per code x member) + vip-codes-MY.json (lane/sub_type/mechanic) +
rescue-forward-MY.json (Lane B forward NGR). Lane-appropriate metrics:
  Lane A (Performance): NGR Lift per RM (mature_7) + redeposit-uplift vs tier x mechanic norm +
        durability + cost/retained + top-1 concentration + GGR-coverage + FC dead-money.
  Lane B (Win-back): reactivation rate (raw + organic-net) + cost per reactivated + forward
        net-margin 30/60/90 per reactivated + recency buckets.  [NGR/RM shown but NOT the judge.]
  Lane D (Engagement): habitual-collector share + GGR-coverage + does-it-pay (NGR/RM) + claim freq.
  Lane C (Entitlement): recipients + downstream NGR + dormant-gift leakage.  [not graded]
Plus lane summaries + tier x mechanic grid (Lane A) + by-tier. NGR is NET of bonus -> break-even 0.

Out: scratchpad/vip/vip-metrics-MY.json  (Task 5 02b_program.py appends the program-wide block)
Usage: python bin/vip_report/02_compute_metrics.py
"""
import json, re
from collections import defaultdict
from pathlib import Path
import sys as _s; _s.path.insert(0, str(Path(__file__).resolve().parents[2]))
from csir_config import CURRENCY, SUF, SYMBOL, MARKET, money, PERIOD_LABEL, AS_OF

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
VIP = SCR / "vip"
MIN_NORM_N = 30

rows = json.load(open(VIP / f"claim-rows-{SUF}.json", encoding="utf-8"))
meta = {r["code"]: r for r in json.load(open(VIP / f"vip-codes-{SUF}.json", encoding="utf-8"))}
fwd = {(r["code"], r["member"]): r for r in json.load(open(VIP / f"rescue-forward-{SUF}.json", encoding="utf-8"))}

TIER_ORDER = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Classic", "Unknown", "Other"]

def norm_tier(t):
    t = (t or "Unknown").strip()
    if t in ("Agent Credit", "Scammers"): return "Other"
    if t in ("", "Unknown"): return "Unknown"
    return re.sub(r"\s*\(Trial\)$", "", t)

def recency_bucket(days):
    if days is None: return "lapsed/none (120d+)"
    if days <= 14: return "active 0-14d"
    if days <= 30: return "cooling 15-30d"
    if days <= 60: return "dormant 31-60d"
    return "lapsed 60-120d"

_sb = [round(money(50)), round(money(150)), round(money(400))]
SIZE_ORDER = [f"<{SYMBOL}{_sb[0]}", f"{SYMBOL}{_sb[0]}-{_sb[1]}", f"{SYMBOL}{_sb[1]}-{_sb[2]}", f"{SYMBOL}{_sb[2]}+"]
def size_band(spend, claims):
    a = spend / max(1, claims)
    return SIZE_ORDER[0] if a < _sb[0] else SIZE_ORDER[1] if a < _sb[1] else SIZE_ORDER[2] if a < _sb[2] else SIZE_ORDER[3]
def size_rank(spend, claims):
    return SIZE_ORDER.index(size_band(spend, claims))
def wager(blob):
    m = re.search(r"(\d+)\s*[xX]\b", blob or "")
    return m.group(1) + "X" if m else "none/other"

for r in rows:
    m = meta.get(r["code"], {})
    r["lane"] = m.get("lane", "A-performance"); r["mech"] = m.get("mechanic", "other")
    r["sub"] = m.get("sub_type", ""); r["ntier"] = norm_tier(r.get("tier"))
    r["rbucket"] = recency_bucket(r.get("recency_days"))
    r["retained"] = 1 if r.get("redep_days_30", 0) >= 1 else 0

laneA = [r for r in rows if r["lane"] == "A-performance"]

# ---- Lane A tier x mechanic redeposit comparator ----
def acc(keyfn, src):
    d = defaultdict(lambda: [0, 0])
    for r in src:
        if r["mature_30"]:
            v = d[keyfn(r)]; v[1] += 1; v[0] += r["retained"]
    return d
cell = acc(lambda r: (r["ntier"], r["mech"]), laneA); mnorm = acc(lambda r: r["mech"], laneA)
g = [sum(r["retained"] for r in laneA if r["mature_30"]), sum(1 for r in laneA if r["mature_30"])]
gnorm = g[0] / g[1] if g[1] else 0.0
def tnl(t, mech):
    cc = cell.get((t, mech))
    if cc and cc[1] >= MIN_NORM_N: return cc[0] / cc[1]
    mm = mnorm.get(mech)
    if mm and mm[1] >= MIN_NORM_N: return mm[0] / mm[1]
    return gnorm

by = defaultdict(list)
for r in rows: by[r["code"]].append(r)
def rate(a, b): return round(a / b * 100, 1) if b else None

codes = []
for code, rs in by.items():
    m = meta.get(code, {}); lane = m.get("lane", "A-performance")
    spend = sum(r["bonus_cost"] for r in rs); claims = sum(r["claims"] for r in rs)
    m7 = [r for r in rs if r["mature_7"]]; spend_m7 = sum(r["bonus_cost"] for r in m7)
    ngr = sum(r["ngr_lift"] for r in m7); ggr_win = sum(r["w7_ggr"] for r in m7)
    mat30 = [r for r in rs if r["mature_30"]]
    d = {"code": code, "name": m.get("name", ""), "lane": lane, "sub_type": m.get("sub_type", ""),
         "mechanic": m.get("mechanic", ""), "is_cashback": bool(m.get("is_cashback")),
         "claimers": len(rs), "claims": claims, "spend": round(spend), "matured_7": len(m7), "matured_30": len(mat30),
         "ngr_lift": round(ngr), "ngr_lift_per_rm": round(ngr / spend_m7, 2) if spend_m7 else None,
         "ggr_window": round(ggr_win), "ggr_coverage": round(ggr_win / spend, 1) if spend else None,
         "avg_amount": round(spend / claims) if claims else None,
         "size_band": size_band(spend, claims), "size_rank": size_rank(spend, claims), "wagering": wager(code + " " + m.get("name", "")),
         "tier_top": None}
    tmix = defaultdict(float)
    for r in rs: tmix[r["ntier"]] += r["bonus_cost"]
    d["tier_top"] = max(tmix, key=tmix.get) if tmix else "Unknown"

    if lane == "A-performance":
        retained = sum(r["retained"] for r in mat30)
        actual = retained / len(mat30) if mat30 else None
        expected = (sum(tnl(r["ntier"], r["mech"]) for r in mat30) / len(mat30)) if mat30 else None
        spend_mat = sum(r["bonus_cost"] for r in mat30)
        mem_ngr = defaultdict(float)
        for r in m7: mem_ngr[r["member"]] += r["ngr_lift"]
        top1 = max(mem_ngr.values()) if mem_ngr else 0.0
        # FC dead-money: FreeCredit rows with ~0 GGR and no deposit in the window
        dead = [r for r in m7 if r["w7_ggr"] < 0.05 * (r["bonus_cost"] or 1) and r["w7_dep"] <= 0] if m.get("mechanic") == "free-credit" else []
        d.update({
            "retained": retained, "redeposit_rate": rate(retained, len(mat30)),
            "redeposit_uplift": round((actual - expected) * 100, 1) if (actual is not None and expected is not None) else None,
            "cost_per_retained": round(spend_mat / retained) if retained else None,
            "ngr_top1_share": round(top1 / ngr, 3) if ngr > 0 else None,
            "ngr_lift_per_rm_ex_top1": round((ngr - top1) / spend_m7, 2) if spend_m7 else None,
            "dead_money_share": round(sum(r["bonus_cost"] for r in dead) / spend_m7 * 100, 1) if (m.get("mechanic") == "free-credit" and spend_m7) else None,
        })
    elif lane == "B-cashback":
        # loss-cashback: soften a losing VIP's week to keep them playing. Judge on retention-after-loss
        # + forward net-margin, NOT the 7-day NGR/RM (the cashback is a give-back after a loss).
        kept = sum(1 for r in mat30 if r["retained"])
        f30 = sum(fwd.get((code, r["member"]), {}).get("fwd_ngr_30", 0) for r in rs)
        f60 = sum(fwd.get((code, r["member"]), {}).get("fwd_ngr_60", 0) for r in rs)
        f90 = sum(fwd.get((code, r["member"]), {}).get("fwd_ngr_90", 0) for r in rs)
        pre_loss = sum(fwd.get((code, r["member"]), {}).get("pre_loss_ggr", 0) for r in rs)
        losing = sum(1 for r in rs if fwd.get((code, r["member"]), {}).get("pre_loss_ggr", 0) > 0)
        d.update({
            "kept_playing": kept, "retention_after_loss": rate(kept, len(mat30)),
            "pct_were_losing": rate(losing, len(rs)),
            "pre_loss_ggr": round(pre_loss),
            "cashback_rate_pct": round(spend / pre_loss * 100, 1) if pre_loss > 0 else None,   # % of loss returned
            "fwd_ngr_30": round(f30), "fwd_ngr_60": round(f60), "fwd_ngr_90": round(f90),
            "fwd_margin_per_member": round(f30 / len(rs)) if rs else None,
            "recovers_cost": bool(f30 > 0),
        })
    elif lane == "D-engagement":
        # habitual collectors: took the freebie, ~0 GGR and no deposit
        hab = [r for r in m7 if r["w7_ggr"] < 0.05 * (r["bonus_cost"] or 1) and r["w7_dep"] <= 0]
        d.update({
            "habitual_share": round(sum(r["bonus_cost"] for r in hab) / spend_m7 * 100, 1) if spend_m7 else None,
            "pays_for_itself": bool(ggr_win > spend),   # GGR covers the giveaway
            "claim_freq": round(claims / len(rs), 1) if rs else None,   # claims per member (habit)
        })
    else:  # C-entitlement
        dormant = [r for r in rs if (r.get("recency_days") is None or r["recency_days"] > 30)]
        no_post = [r for r in dormant if r["w7_dep"] <= 0 and r["w7_ggr"] < 0.05 * (r["bonus_cost"] or 1)]
        d.update({
            "recipients": len(rs), "downstream_ngr": round(ngr),
            "leakage_share": round(sum(r["bonus_cost"] for r in no_post) / spend * 100, 1) if spend else None,
        })
    codes.append(d)
codes.sort(key=lambda x: -x["spend"])

# ---- lane summaries ----
lane_sum = {}
for L in ("A-performance", "B-cashback", "D-engagement", "C-entitlement"):
    lr = [r for r in rows if r["lane"] == L]; lm7 = [r for r in lr if r["mature_7"]]
    sp = sum(r["bonus_cost"] for r in lr); sm7 = sum(r["bonus_cost"] for r in lm7)
    ngr = sum(r["ngr_lift"] for r in lm7); ggr = sum(r["w7_ggr"] for r in lm7)
    lane_sum[L] = {"codes": sum(1 for c in codes if c["lane"] == L), "spend": round(sp),
                   "ngr_lift": round(ngr), "ngr_lift_per_rm": round(ngr / sm7, 2) if sm7 else None,
                   "ggr_coverage": round(ggr / sp, 1) if sp else None, "claimers": len(lr)}
# Lane B (cashback) forward-margin summary
lb = [c for c in codes if c["lane"] == "B-cashback"]
lane_sum["B-cashback"]["fwd_ngr_30"] = sum(c.get("fwd_ngr_30", 0) for c in lb)
lane_sum["B-cashback"]["fwd_ngr_90"] = sum(c.get("fwd_ngr_90", 0) for c in lb)
lane_sum["B-cashback"]["kept_playing"] = sum(c.get("kept_playing", 0) for c in lb)
lane_sum["B-cashback"]["pre_loss_ggr"] = sum(c.get("pre_loss_ggr", 0) for c in lb)

# ---- rollups: Lane A tier x mechanic grid + by-tier (perf) ----
def perrm(v): return round(v["ngr"] / v["sm7"], 2) if v["sm7"] else None
def rollA(keyfn):
    agg = defaultdict(lambda: {"spend": 0.0, "sm7": 0.0, "ngr": 0.0, "mat": 0, "ret": 0, "n": 0})
    for r in laneA:
        d = agg[keyfn(r)]; d["spend"] += r["bonus_cost"]; d["n"] += 1
        if r["mature_7"]: d["sm7"] += r["bonus_cost"]; d["ngr"] += r["ngr_lift"]
        if r["mature_30"]: d["mat"] += 1; d["ret"] += r["retained"]
    return agg
tier = rollA(lambda r: r["ntier"])
by_tier = [{"tier": k, "spend": round(v["spend"]), "ngr_lift_per_rm": perrm(v), "redeposit_rate": rate(v["ret"], v["mat"])}
           for k, v in tier.items()]
by_tier.sort(key=lambda x: TIER_ORDER.index(x["tier"]) if x["tier"] in TIER_ORDER else 99)
grid = rollA(lambda r: (r["mech"], r["ntier"]))
mech_tier_grid = [{"mechanic": k[0], "tier": k[1], "spend": round(v["spend"]), "n": v["n"],
                   "ngr_lift_per_rm": perrm(v), "low_n": v["n"] < MIN_NORM_N} for k, v in grid.items()]

# Lane A reward-size + wagering cuts — the free-credit bucket is bimodal (big-ticket loses, small wins)
laneA_codes = [c for c in codes if c["lane"] == "A-performance"]
def code_roll(keyfn):
    agg = defaultdict(lambda: {"n": 0, "spend": 0.0, "ngr": 0.0})
    for c in laneA_codes:
        d = agg[keyfn(c)]; d["n"] += 1; d["spend"] += c["spend"]; d["ngr"] += c["ngr_lift"]
    return agg
sz = code_roll(lambda c: c.get("size_band", "?"))
by_size = [{"band": k, "codes": v["n"], "spend": round(v["spend"]),
            "ngr_lift_per_rm": round(v["ngr"] / v["spend"], 2) if v["spend"] else None} for k, v in sz.items()]
by_size.sort(key=lambda x: SIZE_ORDER.index(x["band"]) if x["band"] in SIZE_ORDER else 99)
wg = code_roll(lambda c: c.get("wagering", "?"))
by_wagering = [{"wagering": k, "codes": v["n"], "spend": round(v["spend"]),
                "ngr_lift_per_rm": round(v["ngr"] / v["spend"], 2) if v["spend"] else None} for k, v in wg.items()]
by_wagering.sort(key=lambda x: -x["spend"])

facts = {"market": MARKET, "currency": CURRENCY, "period": PERIOD_LABEL, "data_as_of": AS_OF,
         "basis": ("TL Pillar=VIP; 4 lanes. NGR Lift = 7-day window vs 14-day baseline, NET of bonus (break-even 0). "
                   "Lane A (Performance) judged on NGR/RM (tier x mechanic comparator); Lane B (CASHBACK — Weekly "
                   "Rescue is a tiered loss-cashback, confirmed by WY; 98% of claimers were losing) judged on "
                   "retention-after-loss + forward 30/60/90d net-margin + cashback-rate (NGR/RM ring-fenced — a "
                   "give-back after a loss tanks the 7-day window); Lane D (Engagement) on engagement + break-even; "
                   "Lane C (Entitlement) not graded. Directional (own-baseline) pending a matched control."),
         "lane_summary": lane_sum, "by_tier": by_tier, "mech_tier_grid": mech_tier_grid,
         "by_size": by_size, "by_wagering": by_wagering, "codes": codes}
json.dump(facts, open(VIP / f"vip-metrics-{SUF}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print("LANE SUMMARY:")
for L, d in lane_sum.items():
    extra = f" | kept {d.get('kept_playing')} fwd30 RM{d.get('fwd_ngr_30',0):,} (loss RM{d.get('pre_loss_ggr',0):,})" if L == "B-cashback" else ""
    print(f"  {L:16s} {d['codes']:>3}c RM{d['spend']:>9,} | NGR/RM {str(d['ngr_lift_per_rm']):>6} | GGR-cov {d['ggr_coverage']}x{extra}")
print("\n  Lane A by REWARD SIZE (the bimodal free-credit split):")
for x in by_size:
    print(f"    {x['band']:12s} {x['codes']:>3}c RM{x['spend']:>9,} NGR/RM {x['ngr_lift_per_rm']}")
print("  Lane A by WAGERING:")
for x in by_wagering:
    print(f"    {x['wagering']:12s} {x['codes']:>3}c RM{x['spend']:>9,} NGR/RM {x['ngr_lift_per_rm']}")
print("\n  Lane A tier x mechanic NGR/RM (reload | free-credit):")
for mm in ("reload", "free-credit", "free-spins"):
    cells = {gc["tier"]: gc["ngr_lift_per_rm"] for gc in mech_tier_grid if gc["mechanic"] == mm and not gc["low_n"]}
    if cells: print(f"    {mm:11s} " + " ".join(f"{t}:{cells.get(t)}" for t in TIER_ORDER if t in cells))
print("\n  Lane B CASHBACK (retention-after-loss + forward margin is the judge, NOT 7d NGR/RM):")
for c in sorted(lb, key=lambda x: -x["spend"]):
    print(f"    {c['code'][:40]:40s} RM{c['spend']:>9,} | losing {c['pct_were_losing']}% | cashback {c['cashback_rate_pct']}% of loss | kept {c['retention_after_loss']}% | fwd30/member RM{c['fwd_margin_per_member']:,}")
print("\n  Lane D engagement:")
for c in sorted([c for c in codes if c["lane"] == "D-engagement"], key=lambda x: -x["spend"])[:6]:
    print(f"    {c['code'][:34]:34s} RM{c['spend']:>8,} NGR/RM {c['ngr_lift_per_rm']} habitual {c['habitual_share']}% pays {c['pays_for_itself']}")
print("Saved scratchpad/vip/vip-metrics-MY.json")
