"""Forward plan (v1) — turn the promo decisions into a proposed budget + expected payoff (MY).

Reads the per-pillar decision tables (acq/ret/vip metrics) + the unified attribution engine (canonical
attributed net-rev/RM + confidence tier per code) and builds:
  - Free up: RM freed by cutting the Stop/Reduce/Trim codes (arithmetic, near-certain).
  - Stops losses of: net revenue you stop bleeding by cutting the LOSING codes (banded by confidence).
  - Redirect into winners: extra net revenue if the freed RM is reinvested into Scale winners at their
    fatigue-adjusted MARGINAL rate (banded).
  - Watch-outs: codes graded cut that the fair check says actually EARN -> excluded, don't cut.
  - Not bankable yet: impact resting on needs-holdout codes.
  - Proposed budget by pillar (current -> after the moves).

ASSUMPTIONS (tunable): Stop frees 100% of a code's bonus; Reduce/Trim free 50%. Net-rev/RM is the canonical
attributed number (fair-comparison where valid, else own-baseline). Reinvestment earns at the Scale winners'
marginal (repeat-fatigued) rate. Band = tier mix (fair +/-20%, directional +/-50%, needs-holdout excluded).

Out: scratchpad/attribution/forward-plan-MY.json (aggregate; NO member rows)
Usage: python bin/attribution/forward_plan.py
"""
import json
from pathlib import Path
from collections import defaultdict

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ATTR = SCR / "attribution"
CUT = {"Stop": 1.0, "Reduce": 0.5, "Trim": 0.5}
BAND = {"fair-comparison": 0.20, "directional": 0.50, "needs-holdout": None}   # None => not banked

def load(path, pillar):
    return [{"pillar": pillar, "code": c["code"], "decision": c.get("decision"), "spend": c.get("spend", 0) or 0}
            for c in json.load(open(path, encoding="utf-8"))["codes"]]
codes = (load(SCR / "ret/ret-metrics-MY.json", "Retention")
         + load(SCR / "vip/vip-metrics-MY.json", "VIP"))     # net-rev/RM applies to ret+VIP; acq graded on cost/FTD
eng = {c["code"]: c for c in json.load(open(ATTR / "attribution-engine-MY.json", encoding="utf-8"))["codes"]}

freed = 0.0
protect = {"exp": 0.0, "lo": 0.0, "hi": 0.0}      # net rev you stop losing by cutting losers
dontcut = []                                       # cut-graded but fair says it earns
holdout_impact = 0.0                               # impact resting on needs-holdout codes
by_pillar = defaultdict(lambda: {"spend": 0.0, "freed": 0.0})
scale_num, scale_den = 0.0, 0.0                    # for the reinvestment marginal rate

for c in codes:
    e = eng.get(c["code"], {}); ar = e.get("attributed_per_rm"); tier = e.get("tier", "directional")
    by_pillar[c["pillar"]]["spend"] += c["spend"]
    d = c["decision"]
    if d in CUT and c["spend"] > 0:
        f = CUT[d] * c["spend"]
        if ar is None:
            freed += f; by_pillar[c["pillar"]]["freed"] += f; continue
        if ar >= 0.2:                              # fair/own says it EARNS -> cutting is a mistake
            dontcut.append({"code": c["code"], "pillar": c["pillar"], "per_rm": ar, "freed_if_cut": round(f)})
            continue
        freed += f; by_pillar[c["pillar"]]["freed"] += f
        stop_loss = -ar * f                        # ar<0 -> positive = net rev you stop losing
        if tier == "needs-holdout":
            holdout_impact += stop_loss
        else:
            b = BAND[tier]; protect["exp"] += stop_loss
            protect["lo"] += stop_loss * (1 - b); protect["hi"] += stop_loss * (1 + b)
    elif d == "Scale" and ar is not None and (e.get("marginal_repeat_per_rm") or 0) > 0:
        mr = min(e.get("marginal_repeat_per_rm") or ar, 3.0)     # cap per-code marginal (free-spins outliers, saturation)
        scale_num += mr * c["spend"]; scale_den += c["spend"]

# reinvestment is the most speculative leg: returns diminish fast as you pour budget into a few winners.
# Use a CONSERVATIVE capped marginal rate, and assume only a fraction of the freed budget can be absorbed.
REINVEST_ABSORB = 0.5                                            # only ~half the freed RM can be productively redirected
reinvest_rate = min(round(scale_num / scale_den, 2), 2.0) if scale_den else 0.0
reinvestable = freed * REINVEST_ABSORB
reinvest_gain = {"rate": reinvest_rate, "reinvestable": round(reinvestable),
                 "exp": round(reinvestable * reinvest_rate), "lo": round(reinvestable * reinvest_rate * 0.4),
                 "hi": round(reinvestable * reinvest_rate * 1.3)}

out = {
    "as_of": "2026-08-30", "assumptions": {"stop_frees": "100%", "reduce_trim_frees": "50%",
        "net_rev_source": "canonical attributed /RM (fair where valid, else own-baseline)",
        "reinvest_rate_per_rm": reinvest_rate, "bands": "fair +/-20%, directional +/-50%, needs-holdout not banked"},
    "free_up": round(freed),
    "stops_losing": {k: round(v) for k, v in protect.items()},
    "reinvest_into_winners": reinvest_gain,
    "total_swing_exp": round(protect["exp"] + reinvest_gain["exp"]),
    "dont_cut": {"n": len(dontcut), "freed_if_cut": round(sum(x["freed_if_cut"] for x in dontcut)),
                 "codes": sorted(dontcut, key=lambda x: -x["freed_if_cut"])[:8]},
    "not_bankable_holdout": round(holdout_impact),
    "by_pillar": {p: {"current_spend": round(v["spend"]), "freed": round(v["freed"]),
                      "proposed_after_cuts": round(v["spend"] - v["freed"])} for p, v in by_pillar.items()},
}
json.dump(out, open(ATTR / "forward-plan-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print("FORWARD PLAN (v1)")
print(f"  FREE UP (near-certain, arithmetic):        RM{out['free_up']:,}")
print(f"  STOPS LOSING (cut the losers, net rev):     RM{out['stops_losing']['exp']:,}   band RM{out['stops_losing']['lo']:,}–RM{out['stops_losing']['hi']:,}")
print(f"  REDIRECT into winners (@ {reinvest_rate}/RM marginal): RM{reinvest_gain['exp']:,}   band RM{reinvest_gain['lo']:,}–RM{reinvest_gain['hi']:,}")
print(f"  => TOTAL EXPECTED NET-REV SWING:            RM{out['total_swing_exp']:,}")
print(f"  DON'T CUT ({out['dont_cut']['n']} codes, fair says they earn): would wrongly free RM{out['dont_cut']['freed_if_cut']:,}")
print(f"  NOT BANKABLE until holdout:                 RM{out['not_bankable_holdout']:,}")
print("  By pillar (current -> after cuts):")
for p, v in out["by_pillar"].items():
    print(f"    {p:<10} RM{v['current_spend']:>10,}  free RM{v['freed']:>9,}  -> RM{v['proposed_after_cuts']:>10,}")
print("Saved scratchpad/attribution/forward-plan-MY.json")
