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
KEEP = {"Scale", "Keep"}
THR = 0.5      # clearly-disagrees threshold /RM

def regrade(path, pillar):
    m = json.load(open(path, encoding="utf-8"))
    changed = []
    for c in m["codes"]:
        e = eng.get(c["code"])
        if not e:
            continue
        c["fair_per_rm"] = e.get("attributed_per_rm")
        c["tier"] = e.get("tier")
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
    json.dump(m, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return changed

ch = regrade(SCR / "ret/ret-metrics-MY.json", "RET") + regrade(SCR / "vip/vip-metrics-MY.json", "VIP")
print(f"RE-GRADE — {len(ch)} codes changed by the fair-comparison number:")
for code, old, new, fp in sorted(ch, key=lambda x: x[0]):
    print(f"  {code[:34]:<35} {old:>9} -> {new:<9} (fair {fp:+.2f}/RM)")
print("Stamped fair_per_rm + tier on every RET/VIP code; overrides idempotent (regraded_from kept).")
print("Saved scratchpad/{ret,vip}/*-metrics-MY.json")
