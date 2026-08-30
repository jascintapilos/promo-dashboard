"""Task 4 (rev. after adversarial QC) — draft decision thresholds + per-code verdicts (retention, MY).

Reads scratchpad/ret/ret-metrics-MY.json, assigns each code a verdict + plain reason + "Do:" action,
computes money-to-move, writes back.

Decision logic (gates first, then the NGR-Lift-per-RM x redeposit-uplift matrix). NGR is NET of the
bonus -> break-even = 0.
  GATE is_winback                                          -> Hold        (judged on the VIP tab)
  GATE matured_7 < VOL_FLOOR                               -> Monitor     (money window not observed / too few)
  GATE matured_30 < VOL_FLOOR (but matured_7 ok)           -> Watch-money (money observed, redeposit not matured -> provisional)
  MATRIX money = NGR Lift back for every RM1, incr = uplift > +DEADBAND (materially above the tier x mechanic norm):
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
import sys as _s; _s.path.insert(0, str(Path(__file__).resolve().parents[2]))
from csir_config import SYMBOL, SUF, MARKET, money

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
RET = SCR / "ret"

VOL_FLOOR = 15 if MARKET == 'MY' else 8
SCALE_VOL_FLOOR = 2 * VOL_FLOOR   # a budget-INCREASE call (Scale) needs a robust base, not a bare-floor sample
GIVE_FLOOR = 0.5
SCALE_HI = 2.0
DEADBAND = 1.0        # pp: |uplift| < DEADBAND = at-norm (not incremental, not below)
OVER_REWARD_CPR = round(money(500))   # cost-per-retained is real money -> rescale for the market
CONC_SHARE = 0.30     # top-1 member NGR share above which a Scale is one-whale-sensitive (demote if ex-whale weak)
CONC_HARD = 0.50      # top-1 share above which a Scale is ALWAYS demoted (too concentrated to grow budget on)

f = json.load(open(RET / f"ret-metrics-{SUF}.json", encoding="utf-8"))
codes = f["codes"]

DO = {
    "Scale": "Grow it — more budget / wider eligibility. It brings players back AND makes money.",
    "Maintain": "Keep as-is — profitable and keeps players. Re-check next cycle.",
    "Optimise-target": "Tighten who gets it — profitable, but it's reaching players who'd deposit again anyway.",
    "Optimise-rework": "Rework the offer — it makes money but keeps FEWER players than its type usually does; it isn't the reason they came back.",
    "Optimise-size": "Right-size the offer — it barely pays for itself for what it gives. Cut bonus % or raise min-deposit.",
    "Reduce": "Trim the giveaway — it keeps players playing but the offer is too generous to profit.",
    "Stop": "Stop or replace — loses money and doesn't keep players any better than its type's.",
    "Monitor": "Watch — we can't see the money yet, or there are too few players to judge.",
    "Watch-money": "A read now, not proof — firm call at 30 days — the money is in but we're still waiting to see who deposits again.",
    "Hold": "Judged on the VIP tab — winning back players who'd stopped sits there (starting from almost nothing makes any gain look huge).",
}

def decide(c):
    money, up = c["ngr_lift_per_rm"], c["redeposit_uplift"]
    mech = {"reload":"deposit bonus","free-credit":"free-credit","free-spins":"free-spins","mini-game":"mini-game"}.get(c["mechanic"], c["mechanic"] or "type")
    if c["is_winback"]:
        return "Hold", "A promo to win back players who'd stopped — held for the VIP tab (starting from almost nothing makes any gain look huge).", DO["Hold"], False
    if (c["matured_7"] or 0) < VOL_FLOOR or money is None:
        why = "we can't see the first 7 days of money yet (too new)" if not c["matured_7"] else f"only {c['matured_7']} players we've watched long enough to see the money"
        return "Monitor", f"Too little to judge — {why}.", DO["Monitor"], False
    if c["matured_30"] < VOL_FLOOR:
        d = "clearly losing" if money < 0 else "strong" if money >= SCALE_HI else "around paying for itself"
        return "Watch-money", f"Money seen so far ({SYMBOL}{money:.2f} back for every RM1, {d}) but the repeat deposits haven't had time yet — a read, not proof; firm at 30 days.", DO["Watch-money"], True
    incr = (up is not None and up > DEADBAND)
    below = (up is not None and up < -DEADBAND)
    if money < 0 and not incr:
        return "Stop", f"Loses money ({SYMBOL}{money:.2f} back for every RM1) and doesn't keep players any better than the {mech}.", DO["Stop"], False
    if money < 0 and incr:
        return "Reduce", f"Keeps more players than the {mech} average (+{up:.0f}pp) but loses money ({SYMBOL}{money:.2f} back for every RM1) — too generous.", DO["Reduce"], False
    if money < GIVE_FLOOR:
        cpr = c.get("cost_per_retained")
        tag = f" — {SYMBOL}{cpr:,} per kept player is steep" if (cpr and cpr > OVER_REWARD_CPR) else ""
        return "Optimise", f"Only {SYMBOL}{money:.2f} back for every RM1 — it barely pays for itself and margins are thin{tag}. Right-size it.", DO["Optimise-size"], False
    if not incr:
        if below:
            return "Optimise", f"Profitable ({SYMBOL}{money:.2f} back for every RM1) but they deposited again LESS than the {mech} average ({up:.0f}pp) — the offer isn't keeping players; rework it.", DO["Optimise-rework"], False
        return "Optimise", f"Profitable ({SYMBOL}{money:.2f} back for every RM1) but they deposited again about the {mech} average — mostly paying players who'd come back anyway; tighten who gets it.", DO["Optimise-target"], False
    if money < SCALE_HI:
        return "Maintain", f"Profitable ({SYMBOL}{money:.2f} back for every RM1) and keeping more players than the {mech} average (+{up:.0f}pp).", DO["Maintain"], False
    return "Scale", f"Strong return ({SYMBOL}{money:.2f} back for every RM1) and keeps more players than the {mech} average (+{up:.0f}pp).", DO["Scale"], False

for c in codes:
    d, why, do, prov = decide(c)
    # volume guard: a budget-increase (Scale) needs a robust base, not a bare-floor sample
    m30 = c.get("matured_30") or 0
    if d == "Scale" and m30 < SCALE_VOL_FLOOR:
        d, do = "Maintain", DO["Maintain"]
        why = f"Strong return ({SYMBOL}{c['ngr_lift_per_rm']:.2f} back for every RM1) but held back from Scale — only {m30} players watched to 30 days, too thin to grow the budget on yet (need {SCALE_VOL_FLOOR})."
    # single-member concentration guard: a Scale carried by one whale is demoted
    share, ex1 = c.get("ngr_top1_share"), c.get("ngr_lift_per_rm_ex_top1")
    if d == "Scale" and share and share > CONC_HARD:
        # too concentrated to confidently grow budget, even if the ex-whale number holds
        d, do = "Maintain", DO["Maintain"]
        why = f"Profitable but held back from Scale — {int(share*100)}% of the profit came from ONE player — too dependent on a single person to grow the budget on."
    elif d == "Scale" and share and share > CONC_SHARE and ex1 is not None and ex1 < SCALE_HI:
        if ex1 < GIVE_FLOOR:
            d, do = "Optimise", DO["Optimise-size"]
            why = f"Looks strong ({SYMBOL}{c['ngr_lift_per_rm']:.2f} per RM) but {int(share*100)}% of the profit comes from ONE player; without them it's {SYMBOL}{ex1:.2f} back for every RM1. Treat as thin — right-size."
        else:
            d, do = "Maintain", DO["Maintain"]
            why = f"Profitable but held back from Scale — {int(share*100)}% of the profit comes from ONE player; without them it's {SYMBOL}{ex1:.2f} back for every RM1 (not Scale-strong)."
    c["decision"], c["reason"], c["do"], c["provisional"] = d, why, do, prov
    flags = []
    if c.get("implied_tier") and c.get("target_purity") is not None and c["target_purity"] < 50:
        flags.append(f"wrong players: labelled '{c['implied_tier']}' but {c['target_purity']:.0f}% actually reached that group")
    if c.get("cost_per_retained") and c["cost_per_retained"] > OVER_REWARD_CPR and (c["ngr_lift_per_rm"] or 0) < GIVE_FLOOR:
        flags.append(f"over-generous: {SYMBOL}{c['cost_per_retained']:,} per kept player")
    if share and share > CONC_SHARE:
        flags.append(f"one-player-heavy: {int(share*100)}% of net revenue from a single player")
    c["flags"] = flags

# ---- money-to-move (Stop + Reduce; Watch-money surfaced separately, not yet actioned) ----
sp = defaultdict(float)
for c in codes: sp[c["decision"]] += c["spend"]
money_to_move = round(sp.get("Stop", 0) + sp.get("Reduce", 0))
f["thresholds"] = {
    "vol_floor": VOL_FLOOR, "scale_vol_floor": SCALE_VOL_FLOOR, "give_floor": GIVE_FLOOR, "scale_hi": SCALE_HI, "deadband_pp": DEADBAND,
    "conc_share": CONC_SHARE, "break_even": 0,
    "incr_rule": f"repeat-deposit rate is more than +{DEADBAND}pp above what that type of player normally does",
    "note": ("Draft, from how the codes spread out. Money = net revenue back for every RM1 (after the bonus is paid; zero means it paid for itself). "
             "Verdicts are a read, not proof (compared against the promo's own players); a matched control group is the proof step. "
             "Win-back promos are held; Scales driven by one big player are downgraded; money is checked at 7 days, extra-profit split at 30 days."),
}
f["money_to_move"] = {
    "stop_reduce": money_to_move, "optimise": round(sp.get("Optimise", 0)), "scale": round(sp.get("Scale", 0)),
    "watch_money": round(sp.get("Watch-money", 0)),
    "line": (f"{SYMBOL}{money_to_move:,} sits in Stop/Reduce promos — move it into the Scale winners "
             f"({SYMBOL}{round(sp.get('Scale',0)):,} today). {SYMBOL}{round(sp.get('Optimise',0)):,} in Optimise promos is "
             f"partly recoverable by right-sizing; {SYMBOL}{round(sp.get('Watch-money',0)):,} is a read, not proof yet (still waiting to see who deposits again)."),
}
json.dump(f, open(RET / f"ret-metrics-{SUF}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---- report ----
ORDER = ["Scale", "Maintain", "Optimise", "Reduce", "Stop", "Watch-money", "Monitor", "Hold"]
hist = defaultdict(lambda: [0, 0.0])
for c in codes: hist[c["decision"]][0] += 1; hist[c["decision"]][1] += c["spend"]
tot = sum(c["spend"] for c in codes)
print(f"thresholds: vol={VOL_FLOOR} | give={SYMBOL}{GIVE_FLOOR} | scale={SYMBOL}{SCALE_HI} | deadband=±{DEADBAND}pp | break-even 0 (NGR net) | conc>{int(CONC_SHARE*100)}%")
print(f"\n  {'DECISION':12s} {'CODES':>5} {'SPEND(RM)':>11} {'%':>5}")
for d in ORDER:
    n, s = hist[d]
    if n: print(f"  {d:12s} {n:>5} {round(s):>11,} {s/tot*100:>4.0f}%")
print(f"\n  MONEY TO MOVE: {SYMBOL}{money_to_move:,} (Stop+Reduce) | Scale {SYMBOL}{round(sp.get('Scale',0)):,} | Optimise {SYMBOL}{round(sp.get('Optimise',0)):,} | Watch-money {SYMBOL}{round(sp.get('Watch-money',0)):,}")
demoted = [c for c in codes if any('one-player-heavy' in fl for fl in c['flags'])]
print(f"  single-whale flagged: {len(demoted)} | win-back Held: {sum(1 for c in codes if c['decision']=='Hold')}")
print("\n  TOP 12 BY SPEND:")
print(f"  {'CODE':30s} {'MECH':10s} {'SPEND':>9} {'NGR/RM':>7} {'UP':>6} {'DECISION':11s}")
for c in sorted(codes, key=lambda x: -x["spend"])[:12]:
    print(f"  {c['code'][:30]:30s} {c['mechanic'][:10]:10s} {c['spend']:>9,} {str(c['ngr_lift_per_rm']):>7} "
          f"{(str(c['redeposit_uplift'])+'pp') if c['redeposit_uplift'] is not None else 'n/a':>6} {c['decision']:11s}")
print("Saved decisions into scratchpad/ret/ret-metrics-MY.json")
