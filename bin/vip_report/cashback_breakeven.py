"""Task 3 — cashback per-tier break-even + top-Diamond downside (MY).

Break-even: NGR is NET of the cashback, so the cashback pays for itself iff INCREMENTAL forward NGR
(treated - matched-untreated) > 0 — do NOT subtract the cost again. Report both observational estimates
(cross-section matched + within-member) per tier, per treated losing-week, vs the cashback paid per week.
Downside: how few top Diamonds must churn (lose their annual value) to wipe out the RM1.33M Diamond cashback.
Out: scratchpad/vip/cashback-breakeven-MY.json
Usage: python bin/vip_report/cashback_breakeven.py
"""
import json, re
from pathlib import Path

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
inc = json.load(open(VIP / "cashback-incrementality-MY.json", encoding="utf-8"))
metrics = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))
ledger = json.load(open(VIP / "member-ledger-MY.json", encoding="utf-8"))

TIER_KW = {"Diamond": "diamond", "Platinum": "platinum", "Gold": "gold", "Silver": "silver", "Bronze": "bronze"}
# cashback cost + claims per tier from the Lane-B codes (tier-named rescue codes)
cb = [c for c in metrics["codes"] if c["lane"] == "B-cashback"]
cost_by_tier, claims_by_tier = {}, {}
for tier, kw in TIER_KW.items():
    codes = [c for c in cb if kw in (c["code"] + " " + c["name"]).lower()]
    cost_by_tier[tier] = sum(c["spend"] for c in codes)
    claims_by_tier[tier] = sum(c["claims"] for c in codes)

print("=== PER-TIER BREAK-EVEN (NGR is net of cashback -> pays for itself iff incremental forward NGR > 0) ===")
print(f"  {'TIER':9s} | cashback/claim | incr NGR/week: cross-section | within-member | verdict")
be = {}
for tier in ["Diamond", "Platinum", "Gold", "Silver", "Bronze"]:
    cost = cost_by_tier.get(tier, 0); claims = claims_by_tier.get(tier, 0)
    per_claim = round(cost / claims) if claims else None
    cross = inc["intensive_margin"].get(tier, {}).get("inc_ngr30")
    within = inc["within_member"].get(tier, {}).get("within_inc_ngr30")
    if cross is not None and within is not None:
        verdict = "CLEARS both" if (cross > 0 and within > 0) else "FAILS both" if (cross <= 0 and within <= 0) else "INCONCLUSIVE (sign flips by method)"
    else:
        verdict = "n/a"
    pc = f"{per_claim:>6,}" if per_claim is not None else "   n/a"   # thin/recent window -> None; keep the print alive
    cx = f"{cross:>8,}" if cross is not None else "     n/a"
    wn = f"{within:>7,}" if within is not None else "    n/a"
    print(f"  {tier:9s} | RM{pc} | cross RM{cx} | within RM{wn} | {verdict}")
    be[tier] = {"cashback_cost": cost, "claims": claims, "cashback_per_claim": per_claim,
                "incr_ngr_week_cross": cross, "incr_ngr_week_within": within, "verdict": verdict}

# ---- top-Diamond downside: how few churns wipe the RM1.33M Diamond cashback ----
DIAMOND_COST = cost_by_tier.get("Diamond", 0)
dia = sorted((d["ytd_ngr"] for d in ledger if d.get("tier_end") == "Diamond" and d["ytd_ngr"] > 0), reverse=True)
cum, n_wipe = 0, 0
for v in dia:
    cum += v; n_wipe += 1
    if cum >= DIAMOND_COST: break
downside = {"diamond_cashback": DIAMOND_COST, "diamond_members_positive": len(dia),
            "top_diamond_ytd_ngr": [round(v) for v in dia[:5]],
            "churns_to_wipe_saving": n_wipe if dia else None,
            "top1_ytd_ngr": round(dia[0]) if dia else None}
print(f"\n=== TOP-DIAMOND DOWNSIDE (the reason NOT to cut on observational evidence) ===")
print(f"  Diamond cashback 'saving' if cut: RM{DIAMOND_COST:,}")
print(f"  Top Diamonds' YTD NGR (proxy annual value): {['RM'+format(v,',') for v in downside['top_diamond_ytd_ngr']]}")
print(f"  -> churning just {n_wipe} top Diamond(s) wipes out the entire RM{DIAMOND_COST:,} 'saving'.")
_t1 = downside['top1_ytd_ngr']
print(f"  (Cutting the cashback to save RM{DIAMOND_COST:,} while risking players worth RM{format(_t1, ',') if _t1 is not None else 'n/a'}+ each = a bad trade unless the holdout proves the cashback is truly dead-weight.)")

out = {"break_even": be, "top_diamond_downside": downside,
       "read": ("Observational estimates bracket zero and flip sign by method for Diamond (cross-section vs within-member), "
                "so the RM1.33M can be neither justified nor condemned on this data. Cutting it risks a handful of top "
                "Diamonds worth more than the whole 'saving'. Decision: hold at current rate, run the rate-crossover holdout.")}
json.dump(out, open(VIP / "cashback-breakeven-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("\nSaved scratchpad/vip/cashback-breakeven-MY.json")
