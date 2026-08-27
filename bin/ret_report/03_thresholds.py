"""Task 4 (rev. after adversarial QC) — draft decision thresholds + per-code verdicts (retention, MY).

Reads scratchpad/ret/ret-metrics-MY.json, assigns each code a verdict + plain reason + "Do:" action,
computes money-to-move, writes back.

Decision logic (gates first, then the NGR-Lift-per-RM x redeposit-uplift matrix). NGR is NET of the
bonus -> break-even = 0.
  GATE is_winback                                          -> Hold        (judged on the VIP tab)
  GATE matured_7 < VOL_FLOOR                               -> Monitor     (money window not observed / too few)
  GATE matured_30 < VOL_FLOOR (but matured_7 ok)           -> Watch-money (money observed, redeposit not matured -> provisional)
  MATRIX money = NGR Lift per RM, incr = uplift > +DEADBAND (materially above the tier x mechanic norm):
        money < 0  & not incr            -> Stop
        money < 0  & incr                -> Reduce
        0 <= money < GIVE_FLOOR          -> Optimise (thin / right-size)
        money >= GIVE_FLOOR & below norm -> Optimise (offer not retaining -> rework)
        money >= GIVE_FLOOR & at norm    -> Optimise (paying sure things -> tighten targeting)
        GIVE_FLOOR <= money < SCALE_HI & incr -> Maintain
        money >= SCALE_HI & incr         -> Scale
  GUARD single-member concentration: a Scale whose gain is >CONC_SHARE from ONE player and whose
        ex-top-member NGR/RM falls below the band is demoted (one whale can't mint a Scale).
Usage: python bin/ret_report/03_thresholds.py
"""
import json
from collections import defaultdict
from pathlib import Path

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
RET = SCR / "ret"

VOL_FLOOR = 15
GIVE_FLOOR = 0.5
SCALE_HI = 2.0
DEADBAND = 1.0        # pp: |uplift| < DEADBAND = at-norm (not incremental, not below)
OVER_REWARD_CPR = 500
CONC_SHARE = 0.30     # top-1 member NGR share above which a Scale is one-whale-sensitive (demote if ex-whale weak)
CONC_HARD = 0.50      # top-1 share above which a Scale is ALWAYS demoted (too concentrated to grow budget on)

f = json.load(open(RET / "ret-metrics-MY.json", encoding="utf-8"))
codes = f["codes"]

DO = {
    "Scale": "Grow it — more budget / wider eligibility. It brings players back AND makes money.",
    "Maintain": "Keep as-is — profitable and retaining. Re-check next cycle.",
    "Optimise-target": "Tighten who gets it — profitable, but it's reaching players who'd redeposit anyway.",
    "Optimise-rework": "Rework the offer — it makes money but retains BELOW its type's norm; it isn't the reason they came back.",
    "Optimise-size": "Right-size the offer — it barely clears break-even for what it gives. Cut bonus % or raise min-deposit.",
    "Reduce": "Trim the giveaway — it retains players but the offer is too generous to profit.",
    "Stop": "Stop or replace — loses money and doesn't retain better than its type's norm.",
    "Monitor": "Watch — the money window isn't observed yet or too few players to judge.",
    "Watch-money": "Directional read now, firm call at 30 days — money is observed but redeposit is still maturing.",
    "Hold": "Judged on the VIP tab — win-back / reactivation sits there (near-zero baseline inflates its lift).",
}

def decide(c):
    money, up = c["ngr_lift_per_rm"], c["redeposit_uplift"]
    mech = c["mechanic"] or "type"
    if c["is_winback"]:
        return "Hold", "Win-back / reactivation promo — held for the VIP tab (near-zero baseline inflates its lift).", DO["Hold"], False
    if (c["matured_7"] or 0) < VOL_FLOOR or money is None:
        why = "no 7-day money window yet (too new)" if not c["matured_7"] else f"only {c['matured_7']} players with an observed money window"
        return "Monitor", f"Too little to judge — {why}.", DO["Monitor"], False
    if c["matured_30"] < VOL_FLOOR:
        d = "clearly losing" if money < 0 else "strong" if money >= SCALE_HI else "around break-even"
        return "Watch-money", f"Money observed (RM{money:.2f} per RM, {d}) but redeposit not matured — directional, firm at 30 days.", DO["Watch-money"], True
    incr = (up is not None and up > DEADBAND)
    below = (up is not None and up < -DEADBAND)
    if money < 0 and not incr:
        return "Stop", f"Loses money (RM{money:.2f} back per RM) and doesn't retain above the {mech} norm.", DO["Stop"], False
    if money < 0 and incr:
        return "Reduce", f"Retains above the {mech} norm (+{up:.0f}pp) but loses money (RM{money:.2f} per RM) — too generous.", DO["Reduce"], False
    if money < GIVE_FLOOR:
        cpr = c.get("cost_per_retained")
        tag = f" — RM{cpr:,}/retained is steep" if (cpr and cpr > OVER_REWARD_CPR) else ""
        return "Optimise", f"Only RM{money:.2f} back per RM — clears break-even but thin{tag}. Right-size it.", DO["Optimise-size"], False
    if not incr:
        if below:
            return "Optimise", f"Profitable (RM{money:.2f} per RM) but redeposit is BELOW the {mech} norm ({up:.0f}pp) — the offer isn't retaining; rework it.", DO["Optimise-rework"], False
        return "Optimise", f"Profitable (RM{money:.2f} per RM) but redeposit is about the {mech} norm — largely paying players who'd return anyway; tighten targeting.", DO["Optimise-target"], False
    if money < SCALE_HI:
        return "Maintain", f"Profitable (RM{money:.2f} per RM) and retaining above the {mech} norm (+{up:.0f}pp).", DO["Maintain"], False
    return "Scale", f"Strong return (RM{money:.2f} per RM) and retains above the {mech} norm (+{up:.0f}pp).", DO["Scale"], False

for c in codes:
    d, why, do, prov = decide(c)
    # single-member concentration guard: a Scale carried by one whale is demoted
    share, ex1 = c.get("ngr_top1_share"), c.get("ngr_lift_per_rm_ex_top1")
    if d == "Scale" and share and share > CONC_HARD:
        # too concentrated to confidently grow budget, even if the ex-whale number holds
        d, do = "Maintain", DO["Maintain"]
        why = f"Profitable but held back from Scale — {int(share*100)}% of the NGR gain is a SINGLE player, too concentrated to grow budget on."
    elif d == "Scale" and share and share > CONC_SHARE and ex1 is not None and ex1 < SCALE_HI:
        if ex1 < GIVE_FLOOR:
            d, do = "Optimise", DO["Optimise-size"]
            why = f"Looks strong (RM{c['ngr_lift_per_rm']:.2f} per RM) but {int(share*100)}% of the gain is ONE player; without them it's RM{ex1:.2f} per RM. Treat as thin — right-size."
        else:
            d, do = "Maintain", DO["Maintain"]
            why = f"Profitable but held back from Scale — {int(share*100)}% of the NGR gain is ONE player; without them it's RM{ex1:.2f} per RM (not Scale-strong)."
    c["decision"], c["reason"], c["do"], c["provisional"] = d, why, do, prov
    flags = []
    if c.get("implied_tier") and c.get("target_purity") is not None and c["target_purity"] < 50:
        flags.append(f"off-target: named '{c['implied_tier']}' but {c['target_purity']:.0f}% reached that tier")
    if c.get("cost_per_retained") and c["cost_per_retained"] > OVER_REWARD_CPR and (c["ngr_lift_per_rm"] or 0) < GIVE_FLOOR:
        flags.append(f"over-generous: RM{c['cost_per_retained']:,}/retained")
    if share and share > CONC_SHARE:
        flags.append(f"one-player-heavy: {int(share*100)}% of NGR from a single member")
    c["flags"] = flags

# ---- money-to-move (Stop + Reduce; Watch-money surfaced separately, not yet actioned) ----
sp = defaultdict(float)
for c in codes: sp[c["decision"]] += c["spend"]
money_to_move = round(sp.get("Stop", 0) + sp.get("Reduce", 0))
f["thresholds"] = {
    "vol_floor": VOL_FLOOR, "give_floor": GIVE_FLOOR, "scale_hi": SCALE_HI, "deadband_pp": DEADBAND,
    "conc_share": CONC_SHARE, "break_even": 0,
    "incr_rule": f"redeposit-uplift > +{DEADBAND}pp above the tier x mechanic norm",
    "note": ("Draft, from the code distribution. Money = NGR Lift per RM (net of bonus, break-even 0). "
             "Verdicts directional (own-population comparator); a matched control is the proof step. "
             "Win-back held; single-whale Scales demoted; money gate at 7d, incremental split at 30d."),
}
f["money_to_move"] = {
    "stop_reduce": money_to_move, "optimise": round(sp.get("Optimise", 0)), "scale": round(sp.get("Scale", 0)),
    "watch_money": round(sp.get("Watch-money", 0)),
    "line": (f"RM{money_to_move:,} sits in Stop/Reduce promos — redeploy it into the Scale winners "
             f"(RM{round(sp.get('Scale',0)):,} today). RM{round(sp.get('Optimise',0)):,} in Optimise promos is "
             f"partly reclaimable by right-sizing; RM{round(sp.get('Watch-money',0)):,} is directional (redeposit still maturing)."),
}
json.dump(f, open(RET / "ret-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---- report ----
ORDER = ["Scale", "Maintain", "Optimise", "Reduce", "Stop", "Watch-money", "Monitor", "Hold"]
hist = defaultdict(lambda: [0, 0.0])
for c in codes: hist[c["decision"]][0] += 1; hist[c["decision"]][1] += c["spend"]
tot = sum(c["spend"] for c in codes)
print(f"thresholds: vol={VOL_FLOOR} | give=RM{GIVE_FLOOR} | scale=RM{SCALE_HI} | deadband=±{DEADBAND}pp | break-even 0 (NGR net) | conc>{int(CONC_SHARE*100)}%")
print(f"\n  {'DECISION':12s} {'CODES':>5} {'SPEND(RM)':>11} {'%':>5}")
for d in ORDER:
    n, s = hist[d]
    if n: print(f"  {d:12s} {n:>5} {round(s):>11,} {s/tot*100:>4.0f}%")
print(f"\n  MONEY TO MOVE: RM{money_to_move:,} (Stop+Reduce) | Scale RM{round(sp.get('Scale',0)):,} | Optimise RM{round(sp.get('Optimise',0)):,} | Watch-money RM{round(sp.get('Watch-money',0)):,}")
demoted = [c for c in codes if any('one-player-heavy' in fl for fl in c['flags'])]
print(f"  single-whale flagged: {len(demoted)} | win-back Held: {sum(1 for c in codes if c['decision']=='Hold')}")
print("\n  TOP 12 BY SPEND:")
print(f"  {'CODE':30s} {'MECH':10s} {'SPEND':>9} {'NGR/RM':>7} {'UP':>6} {'DECISION':11s}")
for c in sorted(codes, key=lambda x: -x["spend"])[:12]:
    print(f"  {c['code'][:30]:30s} {c['mechanic'][:10]:10s} {c['spend']:>9,} {str(c['ngr_lift_per_rm']):>7} "
          f"{(str(c['redeposit_uplift'])+'pp') if c['redeposit_uplift'] is not None else 'n/a':>6} {c['decision']:11s}")
print("Saved decisions into scratchpad/ret/ret-metrics-MY.json")
