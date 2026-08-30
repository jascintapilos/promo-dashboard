"""Task 6 — per-lane VIP decisions (MY).

Each lane is graded on its own job (never one metric across all):
  Lane A (Performance) — the Retention matrix: NGR Lift per RM x redeposit-uplift (break-even 0,
     give-floor, scale-hi, single-whale demote, Watch-money). Big-ticket (RM400+) top-tier negatives
     are softened Stop->Reduce (whale-loyalty: trim, don't kill). Quality flags: GGR-cov<1, FC dead-money.
  Lane B (Cashback) — Keep/Maintain/Review/Trim from retention-after-loss + forward net-margin +
     cashback-rate. Recovers cost + rich cashback (Diamond 29%) -> Review (prove incrementality).
  Lane D (Engagement) — Keep/Trim: does it pay for itself (GGR>spend) + build a habit vs habitual freebie.
  Lane C (Entitlement) — Entitlement (not graded) + Leakage flag on dormant-account gifts.
Program-wide verdicts (tier over/under-funded, subsidy cut-line) live in the program block already.
Writes decision + reason + do + flags per code + a money_to_move summary. NGR net of bonus -> break-even 0.
Usage: python bin/vip_report/03_thresholds.py
"""
import json
from collections import defaultdict
from pathlib import Path
import sys as _s; _s.path.insert(0, str(Path(__file__).resolve().parents[2]))
from csir_config import SYMBOL, SUF, MARKET, money

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
VOL, GIVE, HI, DEAD, CONC, CONC_HARD, OVER = 15, 0.5, 2.0, 1.0, 0.30, 0.50, 500

f = json.load(open(VIP / f"vip-metrics-{SUF}.json", encoding="utf-8"))
codes = f["codes"]

# Lane-B is gated on the DISPOSITIVE per-tier break-even verdict (incremental forward NGR, cross-section AND
# within-member) — NOT gross forward NGR (which is non-incremental: whales pay it back anyway). Load if present.
BE_VERDICT = {}
_be = VIP / f"cashback-breakeven-{SUF}.json"
if _be.exists():
    BE_VERDICT = {t: d.get("verdict", "") for t, d in json.load(open(_be, encoding="utf-8")).get("break_even", {}).items()}

DO = {
    "Scale": "Grow it — profitable AND keeping players better than usual for its tier/type.",
    "Maintain": "Keep as-is — profitable and keeping players.",
    "Optimise": "Tighten targeting or right-size — profitable but thin, or not extra profit.",
    "Reduce": "Trim — loses money once you subtract what they'd have done anyway; on big players, shrink the offer, don't kill it (loyalty risk).",
    "Stop": "Stop / replace — loses money and doesn't keep players better than normal.",
    "Watch-money": "A read now, not proof — firm at 30 days; money seen, but we're still waiting to see if players deposit again.",
    "Monitor": "Watch — too new or too few players to judge.",
    "Keep": "Keep — pays for itself and builds the habit / keeps them playing after a loss.",
    "Review": "Review — pays back on the numbers but generous and unproven; needs a proper side-by-side test before scaling.",
    "Trim": "Trim — doesn't cover its cost / doesn't build the habit.",
    "Entitlement": "Relationship gift — reported, not scored on profit; fix who qualifies if it leaks to dead accounts.",
}

def flags_common(c):
    fl = []
    if c.get("ggr_coverage") is not None and c["ggr_coverage"] < 1 and c["lane"] == "A-performance":
        fl.append(f"low margin: the house's winnings only cover {c['ggr_coverage']}x the bonus cost")
    if c.get("dead_money_share") is not None and c["dead_money_share"] > 20:
        fl.append(f"free-credit players who barely played: {c['dead_money_share']}% (~0 play)")
    if c.get("size_rank",0) == 3 and (c.get("ngr_lift_per_rm") or 0) < 0 and c.get("tier_top") in ("Diamond", "Platinum"):
        fl.append("big-ticket loyalty spend for big players (loses extra money)")
    return fl

def decide_A(c):
    money, up = c["ngr_lift_per_rm"], c.get("redeposit_uplift")
    mech = {"reload":"deposit bonus","free-credit":"free-credit","free-spins":"free-spins","mini-game":"mini-game"}.get(c["mechanic"], c["mechanic"] or "type")
    if (c["matured_7"] or 0) < VOL or money is None:
        return "Monitor", f"Too little to judge ({c['matured_7'] or 0} players we've watched long enough to judge).", DO["Monitor"]
    if c["matured_30"] < VOL:
        d = "clearly losing" if money < 0 else "strong" if money >= HI else "around paying for itself"
        return "Watch-money", f"Money seen so far ({SYMBOL}{money:.2f} back for every RM1, {d}) but we're still waiting to see if players deposit again — firm at 30 days.", DO["Watch-money"]
    incr = (up is not None and up > DEAD)
    if money < 0 and not incr: d, why = "Stop", f"Loses money ({SYMBOL}{money:.2f} back for every RM1) and doesn't keep players better than usual for the {mech}."
    elif money < 0 and incr: d, why = "Reduce", f"Keeps more players than usual (+{up:.0f}pp) but loses money ({SYMBOL}{money:.2f} back for every RM1) — trim."
    elif money < GIVE: d, why = "Optimise", f"Only {SYMBOL}{money:.2f} back for every RM1 — it pays for itself but only just. Right-size."
    elif not incr: d, why = "Optimise", f"Profitable ({SYMBOL}{money:.2f} back for every RM1) but players deposit again no more than usual for the {mech} — tighten targeting."
    elif money < HI: d, why = "Maintain", f"Profitable ({SYMBOL}{money:.2f} back for every RM1), keeping more players than usual (+{up:.0f}pp)."
    else: d, why = "Scale", f"Strong ({SYMBOL}{money:.2f} back for every RM1), keeps more players than usual (+{up:.0f}pp)."
    # single-whale demote
    s, e = c.get("ngr_top1_share"), c.get("ngr_lift_per_rm_ex_top1")
    if d == "Scale" and s and s > CONC and e is not None and e < HI:
        d, why = ("Optimise", f"Looks strong but {int(s*100)}% of the net revenue is one player (without them, {SYMBOL}{e:.2f} back for every RM1). Thin.") if e < GIVE else ("Maintain", f"Held from Scale — {int(s*100)}% of the net revenue is one player.")
    # loyalty softening: a big-ticket VIP reward that loses money is shrunk (Reduce), not killed (Stop) —
    # cutting a VIP's standing reward outright risks the relationship; right-size and validate with a control.
    if d == "Stop" and c.get("size_rank",0) >= 2:
        d, why = "Reduce", f"Loses extra money ({SYMBOL}{money:.2f} back for every RM1) — but it's a big-ticket VIP reward ({c.get('tier_top')}-heavy); shrink the offer / raise wagering, don't kill it outright."
    return d, why, DO[d]

def decide_B(c):
    ret = c.get("retention_after_loss")
    tier, f30 = c.get("tier_top"), c.get("fwd_ngr_30", 0)
    if (c["matured_30"] or 0) < VOL:
        return "Monitor", "Too few money-back claims old enough to judge.", DO["Monitor"]
    # Dispositive test = the per-tier break-even verdict (incremental, cross-section AND within-member).
    v = BE_VERDICT.get(tier)
    if v:
        if v.startswith("FAILS"):
            return "Trim", f"Fails the paying-for-itself test both ways for {tier} — the money-back doesn't earn anything extra back (wasted spend); kept {ret}% but they'd have stayed anyway.", DO["Trim"]
        if v.startswith("CLEARS"):
            return "Keep", f"Passes the paying-for-itself test both ways for {tier} — the money-back earns back more than it costs (kept {ret}%).", DO["Keep"]
        return "Review", f"The paying-for-itself test is unclear for {tier} (the result flips depending on how you measure it) — a generous bet on the biggest players; hold and prove it with a proper side-by-side test before cutting (kept {ret}%).", DO["Review"]
    # untiered / off-catalogue tier with no per-tier break-even -> directional gross-recovery fallback
    if not c.get("recovers_cost"):
        return "Trim", f"The money-back isn't earned back over the next 30 days ({SYMBOL}{f30:,}).", DO["Trim"]
    return "Keep", f"Earns its cost back over the next 30 days ({SYMBOL}{f30:,}, kept {ret}%); same amount for everyone, no tier-by-tier paying-for-itself test.", DO["Keep"]

def decide_D(c):
    if (c.get("matured_7") or 0) < VOL: return "Monitor", "Too few claims seen yet.", DO["Monitor"]
    if not c.get("pays_for_itself"):
        return "Trim", f"Doesn't cover its cost (the house's winnings are only {c.get('ggr_coverage')}x the cost) — the daily check-in isn't buying any play.", DO["Trim"]
    hab = c.get("habitual_share") or 0
    if hab > 30:
        return "Trim", f"{hab}% just grab the free money out of habit — no real engagement.", DO["Trim"]
    return "Keep", f"Pays for itself (the house's winnings cover the cost {c.get('ggr_coverage')}x over), out-of-habit grabbers only {hab}% — builds the habit.", DO["Keep"]

def decide_C(c):
    leak = c.get("leakage_share") or 0
    why = f"Relationship gift (net revenue they brought in afterwards, {SYMBOL}{c.get('downstream_ngr',0):,})."
    if leak > 15: why += f" LEAKAGE: {leak}% went to dormant/dead accounts — tighten eligibility."
    return "Entitlement", why, DO["Entitlement"]

DECIDERS = {"A-performance": decide_A, "B-cashback": decide_B, "D-engagement": decide_D, "C-entitlement": decide_C}
for c in codes:
    d, why, do = DECIDERS[c["lane"]](c)
    c["decision"], c["reason"], c["do"], c["flags"] = d, why, do, flags_common(c)

# ---- money-to-move (per lane, with whale caution) ----
lane_dec = defaultdict(lambda: defaultdict(lambda: [0, 0.0]))
for c in codes:
    v = lane_dec[c["lane"]][c["decision"]]; v[0] += 1; v[1] += c["spend"]
prog = f.get("program", {})
cb_review = round(sum(c["spend"] for c in codes if c["lane"] == "B-cashback" and c["decision"] == "Review"))
cb_trim = round(sum(c["spend"] for c in codes if c["lane"] == "B-cashback" and c["decision"] == "Trim"))
f["money_to_move"] = {
    "net_negative_subsidy": prog.get("subsidy_rm"),
    "laneA_stop_reduce": round(sum(c["spend"] for c in codes if c["lane"] == "A-performance" and c["decision"] in ("Stop", "Reduce"))),
    "laneA_scale": round(sum(c["spend"] for c in codes if c["lane"] == "A-performance" and c["decision"] == "Scale")),
    "cashback_review": cb_review,
    "cashback_trim": cb_trim,
    "engagement_trim": round(sum(c["spend"] for c in codes if c["lane"] == "D-engagement" and c["decision"] == "Trim")),
    "line": ("The big moves: (1) cut the {SYMBOL}{sub:,} subsidy the house loses money on (27% of VIPs); "
             "(2) TRIM {SYMBOL}{trim:,} of Gold/Silver money-back that doesn't pay for itself (wasted — they'd stay anyway) "
             "and REVIEW {SYMBOL}{rev:,} of Diamond money-back (paying-for-itself test unclear — hold and run a side-by-side test, don't cut blind); "
             "(3) move budget UP the tiers (Bronze gets too much, Platinum/Diamond too little).").format(
                 SYMBOL=SYMBOL, sub=prog.get("subsidy_rm", 0), trim=cb_trim, rev=cb_review),
}
json.dump(f, open(VIP / f"vip-metrics-{SUF}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---- report ----
print("PER-LANE DECISIONS:")
for L in ("A-performance", "B-cashback", "D-engagement", "C-entitlement"):
    hist = lane_dec[L]
    line = " · ".join(f"{d} {int(v[0])} ({SYMBOL}{int(v[1]):,})" for d, v in sorted(hist.items(), key=lambda x: -x[1][1]))
    print(f"  {L}: {line}")
print(f"\n  MONEY-TO-MOVE: net-negative subsidy {SYMBOL}{f['money_to_move']['net_negative_subsidy']:,} | Lane-A stop/reduce {SYMBOL}{f['money_to_move']['laneA_stop_reduce']:,} | cashback-review {SYMBOL}{f['money_to_move']['cashback_review']:,} | Lane-A scale {SYMBOL}{f['money_to_move']['laneA_scale']:,}")
print("\n  Lane A top verdicts by spend:")
for c in sorted([c for c in codes if c["lane"] == "A-performance"], key=lambda x: -x["spend"])[:8]:
    print(f"    {c['code'][:34]:34s} {SYMBOL}{c['spend']:>9,} {c['size_band']:9s} NGR/RM {str(c['ngr_lift_per_rm']):>6} -> {c['decision']}")
print("  Lane B (cashback) verdicts:")
for c in sorted([c for c in codes if c["lane"] == "B-cashback"], key=lambda x: -x["spend"]):
    print(f"    {c['code'][:40]:40s} {SYMBOL}{c['spend']:>9,} cashback {c.get('cashback_rate_pct')}% kept {c.get('retention_after_loss')}% -> {c['decision']}")
print("Saved decisions into vip-metrics-MY.json")
