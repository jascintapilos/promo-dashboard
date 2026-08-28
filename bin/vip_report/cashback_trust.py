"""Cashback trust panel — placebo + durability for the VIP Lane B verdict.

Answers: is Lane B's cashback 'pays for itself' verdict real, or an artefact of
own-baseline with no holdout — and does any value hold past 30 days? Assembles a
`vip.cashback_trust` block from the already-computed cashback_validation
(intensive_margin matched effect, placebo, read) plus a treated-only forward-NGR
durability trajectory (30/60/90d) from rescue-forward-MY.json. Aggregated only.
Usage: python bin/vip_report/cashback_trust.py
"""
import json
from pathlib import Path

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
m = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))
CV = m["cashback_validation"]
im, pl = CV.get("intensive_margin", {}), CV.get("placebo", {})
TIERS = ["Diamond", "Platinum", "Gold", "Silver", "Bronze"]

tiers = []
for t in TIERS:
    a, p = im.get(t, {}), pl.get(t, {})
    real30, real60 = a.get("inc_ngr30"), a.get("inc_ngr60")
    plac, sup = p.get("placebo_inc_ngr30"), a.get("on_support_pct")
    if real30 is None:
        v = "—"
    elif real30 < 0 and (real60 is None or real60 < 0):
        v = "costs money"
    elif plac is not None and abs(real30) <= abs(plac) * 1.2:
        v = "can't tell — within noise"
    elif real30 > 0:
        v = "pays, holds to 60d" if (real60 is None or real60 >= real30 * 0.6) else "pays early, fades"
    else:
        v = "can't tell"
    tiers.append({"tier": t, "inc_ngr30": real30, "inc_ngr60": real60,
                  "placebo30": plac, "on_support": sup, "verdict": v})

# durability: treated rescue claimers' forward net revenue at 30/60/90 days (treated-only trajectory)
rf = json.load(open(VIP / "rescue-forward-MY.json", encoding="utf-8"))
fwd = {"n": len(rf),
       "ngr30": round(sum(r["fwd_ngr_30"] for r in rf)),
       "ngr60": round(sum(r["fwd_ngr_60"] for r in rf)),
       "ngr90": round(sum(r["fwd_ngr_90"] for r in rf))}

m["cashback_trust"] = {
    "tiers": tiers, "forward_treated": fwd, "read": CV.get("read"),
    "basis": "Matched incremental net revenue (treated rescue claimers vs a matched no-cashback group), by tier, at 30 and 60 days. Placebo = the same test on a shifted date — should be near zero; a real effect must clearly beat it. On-support = how comparable the two groups are. Forward net revenue = treated claimers' net revenue 30/60/90 days out (durability; treated-only, no control at 90).",
}
json.dump(m, open(VIP / "vip-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))  # round-trip

print("CASHBACK TRUST — matched incremental NGR vs placebo, by tier:")
for t in tiers:
    print(f"  {t['tier']:9s} real30 {str(t['inc_ngr30']):>8} · real60 {str(t['inc_ngr60']):>8} · placebo30 {str(t['placebo30']):>8} · support {str(t['on_support'])+'%':>4} → {t['verdict']}")
print(f"\nFORWARD (treated rescue claimers, n={fwd['n']:,}): NGR 30d RM{fwd['ngr30']:,} → 60d RM{fwd['ngr60']:,} → 90d RM{fwd['ngr90']:,}")
print(f"READ: {CV.get('read','')[:160]}")
print("Merged vip.cashback_trust into vip-metrics-MY.json (round-trip OK).")
