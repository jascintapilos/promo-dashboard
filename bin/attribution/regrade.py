"""Re-grade the pillar decision tables using the fair-comparison number (MY).

Post-processing step (runs AFTER the metrics builders, BEFORE the report build). For each RET/VIP code:
  - stamps fair_per_rm + tier from the unified attribution engine onto the code (for the frontier + tables),
  - and where the fair number CLEARLY REVERSES the current call, overrides the decision and marks it:
      cut (Stop/Reduce/Trim) but fair says it EARNS (>= +0.5/RM) -> Optimise/Keep (or Scale if >= +2)
      keep/scale (Scale/Keep) but fair says it LOSES (<= -0.5/RM) -> Reduce
Only fair-comparison (Tier-2) codes are eligible; near-zero (|fair|<0.5) is left alone. Conservative: it
fixes the direction-reversals, not every grade. Overrides are ephemeral (a metrics regen resets them).

Writes back scratchpad/{ret,vip}/*-metrics-MY.json. Usage: python bin/attribution/regrade.py
"""
import json
from pathlib import Path

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
eng = {c["code"]: c for c in json.load(open(SCR / "attribution/attribution-engine-MY.json", encoding="utf-8"))["codes"]}
CUT = {"Stop", "Reduce", "Trim"}
# KEEP = every "keep it / it's fine" call that the fair number can reverse to a cut. Must include
# Retention's "Maintain" (keep-as-is) AND "Optimise" (keep-but-tune) — otherwise a code the fair
# check says loses stays coloured as a keep call and strands in the chart's losing zone, and the
# Summary's "grades reconciled" all-clear reads falsely (those disagreements never enter the review queue).
KEEP = {"Scale", "Keep", "Maintain", "Optimise"}
THR = 0.5      # clearly-disagrees threshold /RM

def regrade(path, pillar):
    m = json.load(open(path, encoding="utf-8"))
    changed = []
    for c in m["codes"]:
        e = eng.get(c["code"])
        if not e:
            continue
        c["tier"] = e.get("tier")
        # ONLY stamp a fair number on codes the engine actually fair-comparison checked (tier
        # "fair-comparison"). dir/hold codes carry a DIRECTIONAL imputation in attributed_per_rm,
        # not a look-alike comparison — leaving their fair_per_rm null makes every consumer
        # (charts, tables, the "fair"/✓ tag, the VIP decision-box aggregate) fall back to
        # own-baseline and reserves the fair tag for the ~74 genuinely-checked codes (matches the
        # Summary's "74 checked / 44 need holdout" split; avoids over-stating confidence).
        c["fair_per_rm"] = e.get("attributed_per_rm") if e.get("tier") == "fair-comparison" else None
        # restore any prior override so this is idempotent
        if c.get("regraded_from"):
            c["decision"] = c["regraded_from"]; c.pop("regraded", None); c.pop("regraded_from", None)
        fp = e.get("attributed_per_rm")
        if e.get("tier") != "fair-comparison" or fp is None:
            continue
        d = c["decision"]; new = None
        if d in CUT and fp >= THR:                      # graded to cut, but it earns
            new = "Scale" if fp >= 2 else ("Optimise" if pillar == "RET" else "Keep")
        elif d in KEEP and fp <= -THR:                  # graded to keep/scale, but it loses
            new = "Reduce"
        if new and new != d:
            c["regraded_from"] = d; c["regraded"] = True; c["decision"] = new
            changed.append((c["code"], d, new, fp))
    # the re-grade moves codes across the Stop/Reduce <-> Optimise/Scale boundary, so the
    # precomputed money_to_move aggregates are now stale. Recompute them from the LIVE decisions
    # for BOTH pillars — the KEEP set now includes "Optimise", so a fair down-grade can flip a
    # VIP Lane-A code (Optimise->Reduce) too, not just RET. Every JS consumer reads these fields
    # (Summary portfolio/banner/totMove, retention callLead + forward pmetrics, VIP vipMove).
    if isinstance(m.get("money_to_move"), dict):
        mtm = m["money_to_move"]
        if pillar == "RET":
            spendby = lambda decs: round(sum(x["spend"] for x in m["codes"] if x.get("decision") in decs))
            mtm["stop_reduce"] = spendby({"Stop", "Reduce"})
            mtm["optimise"] = spendby({"Optimise"})
            mtm["scale"] = spendby({"Scale"})
            mtm["watch_money"] = spendby({"Watch-money"})
            f = lambda n: f"{n:,}"
            mtm["line"] = (f"RM{f(mtm['stop_reduce'])} sits in Stop/Reduce promos — move it into the Scale winners "
                           f"(RM{f(mtm['scale'])} today). RM{f(mtm['optimise'])} in Optimise promos is partly recoverable by "
                           f"right-sizing; RM{f(mtm['watch_money'])} is a read, not proof yet (still waiting to see who deposits again).")
        elif pillar == "VIP":
            laneA = [x for x in m["codes"] if x.get("lane") == "A-performance"]
            laneSpendby = lambda decs: round(sum(x["spend"] for x in laneA if x.get("decision") in decs))
            mtm["laneA_stop_reduce"] = laneSpendby({"Stop", "Reduce"})
            mtm["laneA_scale"] = laneSpendby({"Scale"})
    json.dump(m, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return changed

ch = regrade(SCR / "ret/ret-metrics-MY.json", "RET") + regrade(SCR / "vip/vip-metrics-MY.json", "VIP")
print(f"RE-GRADE — {len(ch)} codes changed by the fair-comparison number:")
for code, old, new, fp in sorted(ch, key=lambda x: x[0]):
    print(f"  {code[:34]:<35} {old:>9} -> {new:<9} (fair {fp:+.2f}/RM)")
print("Stamped fair_per_rm + tier on every RET/VIP code; overrides idempotent (regraded_from kept).")
print("Saved scratchpad/{ret,vip}/*-metrics-MY.json")
