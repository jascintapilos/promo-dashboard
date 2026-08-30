"""Build the compact attribution-strengthening block the report renders (MY).

Reads scratchpad/attribution/matched-did-MY.json (per-code matched-control DiD, aggregate) and emits a
small summary for the Summary-tab "are the promo grades right?" card: coverage, the robust aggregate
correction, the direction split, and the sign-flip watch-list. Aggregate is trimmed to |per-RM|<=15 to
drop tiny-bonus free-spins outliers; direction split is over all validity-passing codes.

Out: scratchpad/attribution/attribution-summary-MY.json
Usage: python bin/attribution/build_report_block.py
"""
import json
from pathlib import Path

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/attribution")
r = json.load(open(SCR / "matched-did-MY.json", encoding="utf-8"))

valid = [x for x in r if x.get("parallel_trends")]
holdo = [x for x in r if not x.get("parallel_trends")]
trim = [x for x in valid if abs(x["own_incr_per_rm"]) <= 15 and abs(x["did_incr_per_rm"]) <= 15]

def agg(g):
    tb = sum(x["bonus"] for x in g) or 1
    to = sum(x["own_incr_ngr"] for x in g); td = sum(x["did_incr_ngr"] for x in g)
    return round(to / tb, 2), round(td / tb, 2), round((to - td) / tb, 2)
own, did, gap = agg(trim)

tvb = sum(x["bonus"] for x in valid) or 1
pess = [x for x in valid if x["rtm_gap_per_rm"] < -0.2]
opti = [x for x in valid if x["rtm_gap_per_rm"] > 0.2]
bshare = lambda g: round(100 * sum(x["bonus"] for x in g) / tvb)

def clean(code):
    return code.replace("FT_", "").replace("optimove_my_", "").replace("_", " ").strip()[:26]

flips = [x for x in trim if (x["own_incr_per_rm"] < 0) != (x["did_incr_per_rm"] < 0)]
flips.sort(key=lambda x: -x["bonus"])
flip_rows = [{
    "code": clean(x["code"]), "pillar": x["pillar"], "n": x["n_treated"], "bonus": x["bonus"],
    "own": x["own_incr_per_rm"], "did": x["did_incr_per_rm"],
    "flip": "loser→winner" if x["own_incr_per_rm"] < 0 else "winner→loser",
    "thin": x["n_treated"] < 150,
} for x in flips]

out = {
    "as_of": "2026-08-30", "preview": True,
    "coverage": {"n_valid": len(valid), "bonus_valid": sum(x["bonus"] for x in valid),
                 "n_need_holdout": len(holdo), "bonus_need_holdout": sum(x["bonus"] for x in holdo)},
    "correction": {"own_per_rm": own, "did_per_rm": did, "gap_per_rm": gap,
                   "pct_of_own": round(100 * abs(gap) / abs(own)) if own else None},
    "direction": {"too_pessimistic_codes": len(pess), "too_pessimistic_bonus_pct": bshare(pess),
                  "too_optimistic_codes": len(opti), "too_optimistic_bonus_pct": bshare(opti)},
    "flips": flip_rows,
    "tiers": [["directional", "a rough read — compares a player to their own recent past (most numbers today)"],
              ["fair-comparison checked", "compared to look-alike players who did not get the promo"],
              ["proven", "survived a live holdout (random) test — none yet"]],
}

# fatigue (within-member) — optional
try:
    fat = json.load(open(SCR / "fatigue-MY.json", encoding="utf-8"))
    f = lambda cv, n: (cv.get(str(n)) or cv.get(n) or {}).get("factor")
    out["fatigue"] = {
        "vip_ord4": f(fat["by_pillar"]["VIP"], 4), "ret_ord5": f(fat["by_pillar"]["RET"], 5),
        "ret_ord6": f(fat["by_pillar"]["RET"], 6), "overall_ord4": f(fat["overall"], 4),
    }
except FileNotFoundError:
    pass

# cap segment (give-to-take) — optional
try:
    csj = json.load(open(SCR / "cap-segment-MY.json", encoding="utf-8"))
    cs = csj["summary"]
    out["cap_segment"] = {"cap_n": cs["CAP"]["n"], "cap_bonus": cs["CAP"]["bonus"],
                          "protect_n": cs["PROTECT"]["n"], "protect_bonus": cs["PROTECT"]["bonus"],
                          "keep_n": cs["KEEP"]["n"],
                          "by_tier": [{"tier": t, "n": v["n"], "bonus": v["bonus"]} for t, v in csj.get("cap_by_tier", {}).items()]}
except FileNotFoundError:
    pass
json.dump(out, open(SCR / "attribution-summary-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"attribution summary: valid {len(valid)} / need-holdout {len(holdo)} | own {own} -> fair {did} /RM (gap {gap}) | "
      f"too-pess {bshare(pess)}% / too-opt {bshare(opti)}% | {len(flip_rows)} flips")
print("Saved scratchpad/attribution/attribution-summary-MY.json")
