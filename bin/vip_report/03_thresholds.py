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

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
VOL, GIVE, HI, DEAD, CONC, CONC_HARD, OVER = 15, 0.5, 2.0, 1.0, 0.30, 0.50, 500

f = json.load(open(VIP / "vip-metrics-MY.json", encoding="utf-8"))
codes = f["codes"]

# Lane-B is gated on the DISPOSITIVE per-tier break-even verdict (incremental forward NGR, cross-section AND
# within-member) — NOT gross forward NGR (which is non-incremental: whales pay it back anyway). Load if present.
BE_VERDICT = {}
_be = VIP / "cashback-breakeven-MY.json"
if _be.exists():
    BE_VERDICT = {t: d.get("verdict", "") for t, d in json.load(open(_be, encoding="utf-8")).get("break_even", {}).items()}

DO = {
    "Scale": "Grow it — profitable AND retaining above its tier/type norm.",
    "Maintain": "Keep as-is — profitable and retaining.",
    "Optimise": "Tighten targeting or right-size — profitable but thin, or not incremental.",
    "Reduce": "Trim — loses money incrementally; on whales, shrink the offer, don't kill it (loyalty risk).",
    "Stop": "Stop / replace — loses money and doesn't retain better than normal.",
    "Watch-money": "Directional now, firm at 30 days — money seen, redeposit still maturing.",
    "Monitor": "Watch — too new or too few players to judge.",
    "Keep": "Keep — pays for itself and builds the habit / retains after a loss.",
    "Review": "Review — pays back on the numbers but generous and unproven; needs a matched control before scaling.",
    "Trim": "Trim — doesn't cover its cost / doesn't build the habit.",
    "Entitlement": "Relationship gift — reported, not graded on ROI; fix eligibility if it leaks to dead accounts.",
}

def flags_common(c):
    fl = []
    if c.get("ggr_coverage") is not None and c["ggr_coverage"] < 1 and c["lane"] == "A-performance":
        fl.append(f"low margin: house GGR only {c['ggr_coverage']}x the bonus")
    if c.get("dead_money_share") is not None and c["dead_money_share"] > 20:
        fl.append(f"free-credit dead-money {c['dead_money_share']}% (~0 play)")
    if c.get("size_band") == "RM400+" and (c.get("ngr_lift_per_rm") or 0) < 0 and c.get("tier_top") in ("Diamond", "Platinum"):
        fl.append("big-ticket whale-loyalty spend (negative incremental)")
    return fl

def decide_A(c):
    money, up = c["ngr_lift_per_rm"], c.get("redeposit_uplift")
    mech = c["mechanic"] or "type"
    if (c["matured_7"] or 0) < VOL or money is None:
        return "Monitor", f"Too little to judge ({c['matured_7'] or 0} players with an observed window).", DO["Monitor"]
    if c["matured_30"] < VOL:
        d = "clearly losing" if money < 0 else "strong" if money >= HI else "around break-even"
        return "Watch-money", f"Money observed (RM{money:.2f}/RM, {d}) but redeposit not matured — firm at 30 days.", DO["Watch-money"]
    incr = (up is not None and up > DEAD)
    if money < 0 and not incr: d, why = "Stop", f"Loses money (RM{money:.2f}/RM) and doesn't retain above the {mech} norm."
    elif money < 0 and incr: d, why = "Reduce", f"Retains above norm (+{up:.0f}pp) but loses money (RM{money:.2f}/RM) — trim."
    elif money < GIVE: d, why = "Optimise", f"Only RM{money:.2f}/RM — clears break-even but thin. Right-size."
    elif not incr: d, why = "Optimise", f"Profitable (RM{money:.2f}/RM) but redeposit at/below the {mech} norm — tighten targeting."
    elif money < HI: d, why = "Maintain", f"Profitable (RM{money:.2f}/RM), retaining above norm (+{up:.0f}pp)."
    else: d, why = "Scale", f"Strong (RM{money:.2f}/RM), retains above norm (+{up:.0f}pp)."
    # single-whale demote
    s, e = c.get("ngr_top1_share"), c.get("ngr_lift_per_rm_ex_top1")
    if d == "Scale" and s and s > CONC and e is not None and e < HI:
        d, why = ("Optimise", f"Looks strong but {int(s*100)}% of NGR is one player (ex-them RM{e:.2f}/RM). Thin.") if e < GIVE else ("Maintain", f"Held from Scale — {int(s*100)}% of NGR is one player.")
    # loyalty softening: a big-ticket VIP reward that loses money is shrunk (Reduce), not killed (Stop) —
    # cutting a VIP's standing reward outright risks the relationship; right-size and validate with a control.
    if d == "Stop" and c.get("size_band") in ("RM400+", "RM150-400"):
        d, why = "Reduce", f"Loses money incrementally (RM{money:.2f}/RM) — but it's a big-ticket VIP reward ({c.get('tier_top')}-heavy); shrink the offer / raise wagering, don't kill it outright."
    return d, why, DO[d]

def decide_B(c):
    ret = c.get("retention_after_loss")
    tier, f30 = c.get("tier_top"), c.get("fwd_ngr_30", 0)
    if (c["matured_30"] or 0) < VOL:
        return "Monitor", "Too few matured cashback claims to judge.", DO["Monitor"]
    # Dispositive test = the per-tier break-even verdict (incremental, cross-section AND within-member).
    v = BE_VERDICT.get(tier)
    if v:
        if v.startswith("FAILS"):
            return "Trim", f"Break-even FAILS both methods for {tier} — the cashback recovery is non-incremental (dead-weight); kept {ret}% but they'd have stayed anyway.", DO["Trim"]
        if v.startswith("CLEARS"):
            return "Keep", f"Break-even CLEARS both methods for {tier} — cashback pays back incrementally (kept {ret}%).", DO["Keep"]
        return "Review", f"Break-even INCONCLUSIVE for {tier} (sign flips cross-section vs within-member) — a generous whale bet on the highest-value players; hold and prove with a rate-crossover holdout before cutting (kept {ret}%).", DO["Review"]
    # untiered / off-catalogue tier with no per-tier break-even -> directional gross-recovery fallback
    if not c.get("recovers_cost"):
        return "Trim", f"Cashback doesn't recover forward (fwd-30d RM{f30:,}).", DO["Trim"]
    return "Keep", f"Recovers cost (fwd-30d RM{f30:,}, kept {ret}%); flat-value rescue, no per-tier break-even test.", DO["Keep"]

def decide_D(c):
    if (c.get("matured_7") or 0) < VOL: return "Monitor", "Too few observed claims.", DO["Monitor"]
    if not c.get("pays_for_itself"):
        return "Trim", f"Doesn't cover its cost (GGR-cov {c.get('ggr_coverage')}x) — the check-in isn't buying play.", DO["Trim"]
    hab = c.get("habitual_share") or 0
    if hab > 30:
        return "Trim", f"{hab}% habitual free-money collectors — engagement theatre.", DO["Trim"]
    return "Keep", f"Pays for itself (GGR-cov {c.get('ggr_coverage')}x), habitual only {hab}% — builds the habit.", DO["Keep"]

def decide_C(c):
    leak = c.get("leakage_share") or 0
    why = f"Relationship gift (downstream NGR RM{c.get('downstream_ngr',0):,})."
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
    "line": ("The big moves: (1) cut the RM{sub:,} net-negative subsidy (27% of VIPs the house loses on); "
             "(2) TRIM RM{trim:,} of Gold/Silver cashback that fails its break-even (dead-weight — they'd stay anyway) "
             "and REVIEW RM{rev:,} of Diamond cashback (break-even inconclusive — hold and run a holdout, don't cut blind); "
             "(3) reallocate the tier envelope UP (Bronze over-funded, Platinum/Diamond starved).").format(
                 sub=prog.get("subsidy_rm", 0), trim=cb_trim, rev=cb_review),
}
json.dump(f, open(VIP / "vip-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---- report ----
print("PER-LANE DECISIONS:")
for L in ("A-performance", "B-cashback", "D-engagement", "C-entitlement"):
    hist = lane_dec[L]
    line = " · ".join(f"{d} {int(v[0])} (RM{int(v[1]):,})" for d, v in sorted(hist.items(), key=lambda x: -x[1][1]))
    print(f"  {L}: {line}")
print(f"\n  MONEY-TO-MOVE: net-negative subsidy RM{f['money_to_move']['net_negative_subsidy']:,} | Lane-A stop/reduce RM{f['money_to_move']['laneA_stop_reduce']:,} | cashback-review RM{f['money_to_move']['cashback_review']:,} | Lane-A scale RM{f['money_to_move']['laneA_scale']:,}")
print("\n  Lane A top verdicts by spend:")
for c in sorted([c for c in codes if c["lane"] == "A-performance"], key=lambda x: -x["spend"])[:8]:
    print(f"    {c['code'][:34]:34s} RM{c['spend']:>9,} {c['size_band']:9s} NGR/RM {str(c['ngr_lift_per_rm']):>6} -> {c['decision']}")
print("  Lane B (cashback) verdicts:")
for c in sorted([c for c in codes if c["lane"] == "B-cashback"], key=lambda x: -x["spend"]):
    print(f"    {c['code'][:40]:40s} RM{c['spend']:>9,} cashback {c.get('cashback_rate_pct')}% kept {c.get('retention_after_loss')}% -> {c['decision']}")
print("Saved decisions into vip-metrics-MY.json")
