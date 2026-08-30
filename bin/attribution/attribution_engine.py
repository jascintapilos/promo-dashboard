"""Unified attribution engine (Phase 3 core) — ONE canonical, tier-labelled number per promo (MY).

Resolves the "two engines answer the same question differently" problem: instead of the 7d-vs-14d windowed
lift (engine A) and the 30/60/90 forward pull (engine B) giving different reads, this produces a single
canonical attributed value per code from the best available method, with its confidence tier and the
fatigue-adjusted marginal (repeat) value.

Per code, the canonical number is:
  Tier 2 "fair-comparison"   — the matched-control DiD (Phase 1.1) where parallel-trends holds
  needs-holdout              — codes with players but no valid look-alike (the 44)
  Tier 1 "directional"       — own-baseline forward lift where no matched-control was run (small codes)
Window is a parameter (default 90d, net of bonus, maturity-gated). Fatigue factor (Phase 2) gives the
marginal value of a repeat claim. Output feeds the report; retiring A/B from live grading is the staged
final step (needs coverage + the holdout), NOT done here.

Out: scratchpad/attribution/attribution-engine-MY.json (per-code canonical + tier; NO member rows)
Usage: python bin/attribution/attribution_engine.py [window]   (window in {30,60,90}, default 90)
"""
import sys, json
from pathlib import Path
from collections import defaultdict

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ATTR = SCR / "attribution"
W = int(sys.argv[1]) if len(sys.argv) > 1 else 90

def norm(t): return (t or "Unknown")

# ---- own-baseline forward lift per code (engine B, windowed, net of bonus) ----
def own_by_code(path, pillar):
    agg = defaultdict(lambda: {"bonus": 0.0, "lift": 0.0, "n": 0, "nmat": 0})
    for r in json.load(open(path, encoding="utf-8")):
        mat = r.get(f"mature_{W}")
        a = agg[r["code"]]; a["bonus"] += r["bonus_amount"]; a["n"] += 1
        if mat:
            a["lift"] += r[f"fwd_ngr_{W}"] - r[f"pre_ngr_{W}"]; a["nmat"] += 1
    return {c: {"pillar": pillar, "bonus": round(v["bonus"]), "n": v["n"], "nmat": v["nmat"],
                "own_per_rm": round(v["lift"] / v["bonus"], 2) if v["bonus"] else None} for c, v in agg.items()}

own = {}
own.update(own_by_code(SCR / "ret/forward-outcomes-MY.json", "RET"))
own.update(own_by_code(SCR / "vip/forward-outcomes-MY.json", "VIP"))

# ---- matched-control result (engine's Tier-2 upgrade, at 90d) ----
md = {r["code"]: r for r in json.load(open(ATTR / "matched-did-MY.json", encoding="utf-8"))}
# ---- fatigue factors (marginal repeat value) ----
fat = json.load(open(ATTR / "fatigue-MY.json", encoding="utf-8"))
def fatigue_factor(pillar, ordn=4):
    cv = fat["by_pillar"].get(pillar, {})
    f = (cv.get(str(ordn)) or cv.get(ordn) or {}).get("factor")
    return f if f is not None else 1.0

codes = []
for c, o in own.items():
    m = md.get(c)
    if m and m.get("parallel_trends"):
        val, tier = m["did_incr_per_rm"], "fair-comparison"        # Tier 2
    elif m and not m.get("parallel_trends"):
        val, tier = o["own_per_rm"], "needs-holdout"               # no valid look-alike
    else:
        val, tier = o["own_per_rm"], "directional"                 # Tier 1 (own-baseline only)
    ff = fatigue_factor(o["pillar"])
    codes.append({"code": c, "pillar": o["pillar"], "bonus": o["bonus"], "window": W,
                  "attributed_per_rm": val, "tier": tier,
                  "marginal_repeat_per_rm": round(val * ff, 2) if val is not None else None,
                  "fatigue_factor_4th": ff, "own_per_rm": o["own_per_rm"], "matured": o["nmat"]})

codes.sort(key=lambda x: -x["bonus"])
by_tier = defaultdict(lambda: {"n": 0, "bonus": 0})
for c in codes:
    a = by_tier[c["tier"]]; a["n"] += 1; a["bonus"] += c["bonus"]

# reconciliation: does the canonical number change the sign vs the own-baseline (would flip a keep/cut call)?
comp = [c for c in codes if c["attributed_per_rm"] is not None and c["own_per_rm"] is not None and c["tier"] == "fair-comparison"]
flips = [c for c in comp if (c["attributed_per_rm"] < 0) != (c["own_per_rm"] < 0)]

out = {"as_of": "2026-08-30", "window": W, "n_codes": len(codes),
       "tiers": {k: by_tier[k] for k in ("fair-comparison", "directional", "needs-holdout")},
       "reconcile": {"tier2_codes": len(comp), "sign_flips_vs_own": len(flips),
                     "flip_bonus": sum(c["bonus"] for c in flips)},
       "codes": codes}
json.dump(out, open(ATTR / "attribution-engine-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print(f"UNIFIED ATTRIBUTION ENGINE — one canonical number per code (window {W}d, net of bonus)")
print(f"{len(codes)} codes | tier split:")
for k in ("fair-comparison", "directional", "needs-holdout"):
    a = by_tier[k]; print(f"  {k:<16} {a['n']:>4} codes  RM{a['bonus']:>11,}")
print(f"\nCanonical vs own-baseline (Tier-2 codes): {len(flips)} of {len(comp)} change the keep/cut sign (RM{sum(c['bonus'] for c in flips):,})")
print("Fatigue-adjusted marginal (4th repeat claim) = attributed x pillar factor: "
      f"RET x{fatigue_factor('RET')} · VIP x{fatigue_factor('VIP')}")
print("Saved scratchpad/attribution/attribution-engine-MY.json")
