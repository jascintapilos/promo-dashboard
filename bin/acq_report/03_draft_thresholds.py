"""Task 6 — DRAFT decision thresholds + a scale/maintain/optimise/reduce/stop call per code.

Cutoffs are derived from the actual data distribution and are labelled DRAFT — they are exactly
what YG/WY sign off. Rules (design section 7):
  - LOW VOLUME  : claimers < FLOOR            -> gated, not judged
  - STOP        : buys ~no depositors (ftd==0), or very dear AND doesn't stick
  - SCALE       : cheap per FTD AND sticky
  - REDUCE      : dear per FTD AND not sticky (on material spend)
  - OPTIMISE    : dear per FTD OR few keep playing (not the worst) -> test a smaller/better-targeted bonus
  - MAINTAIN    : the acceptable middle
Writes decision + reason + thresholds back into acq-metrics-MY.json.
Usage: python bin/acq_report/03_draft_thresholds.py
"""
import json, statistics as st
from pathlib import Path

ACQ = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/acq")
FLOOR = 20            # min redeemed claimers to make a call
RELOAD_PURITY = 40   # below this % new, a "welcome" code is mostly existing players -> judge under Retention

f = json.load(open(ACQ / "acq-metrics-MY.json", encoding="utf-8"))
codes = f["codes"]

def pct(xs, p):
    xs = sorted(xs);
    if not xs: return None
    k = (len(xs) - 1) * p; lo = int(k)
    return xs[lo] if lo + 1 >= len(xs) else xs[lo] + (xs[lo+1]-xs[lo])*(k-lo)

def is_referral(c): return "REFER" in c["code"].upper()
def is_reload(c): return (not is_referral(c)) and c.get("purity") is not None and c["purity"] < RELOAD_PURITY

# thresholds set on PURE acquisition codes only (exclude referral + low-purity reload tools);
# cost_per_ftd is already new-player-attributed in 02.
judged = [c for c in codes if c["claimers"] >= FLOOR and c["ftd"] > 0 and c["cost_per_ftd"] is not None
          and not is_referral(c) and not is_reload(c)]
costs = [c["cost_per_ftd"] for c in judged]
sticks = [c["stick_30"] for c in judged if c["stick_30"] is not None]
c_p25, c_p50, c_p75 = pct(costs, .25), pct(costs, .50), pct(costs, .75)
s_med = pct(sticks, .50)
thr = {"floor_claimers": FLOOR, "cost_per_ftd_p25": round(c_p25), "cost_per_ftd_p50": round(c_p50),
       "cost_per_ftd_p75": round(c_p75), "stick_median": round(s_med, 1), "reload_purity": RELOAD_PURITY,
       "status": "DRAFT"}

def decide(c):
    if is_referral(c):
        return "Referral", "referral reward — its payoff is the referred friend's deposit, tracked separately (needs a link between referrer and friend)"
    if is_reload(c):
        ngr = c.get("ngr_w7") or 0
        ngrtxt = f"+RM{ngr:,}" if ngr >= 0 else f"−RM{abs(ngr):,}"
        return "Reload", f"only {c['purity']:.0f}% new players — this is a deposit bonus for existing players ({ngrtxt} week-1 net revenue). Judge its value on the Retention tab, not as bringing in new players."
    if c["claimers"] < FLOOR:
        return "Low volume", f"only {c['claimers']} people claimed it — too few to judge (need at least {FLOOR})"
    if c["ftd"] == 0:
        return "Stop", "gets nobody to make a first deposit"
    cost, stick = c["cost_per_ftd"], (c["stick_30"] if c["stick_30"] is not None else s_med)
    cheap, dear = cost <= c_p25, cost >= c_p75
    good_stick = stick >= s_med
    if cheap and good_stick:
        return "Scale", f"cheap to bring in new players (RM{cost} per new depositor, among the cheapest) and they keep playing ({stick}% stayed)"
    if dear and not good_stick:
        return "Reduce", f"expensive (RM{cost} per new depositor, among the priciest) and few keep playing ({stick}%)"
    if dear or not good_stick:
        why = f"expensive (RM{cost} per new depositor)" if dear else f"few keep playing ({stick}%)"
        return "Optimise", f"{why} — test a smaller amount or aim it at the right players"
    return "Maintain", f"acceptable (RM{cost} per new depositor, {stick}% stayed)"

hist = {}
for c in codes:
    d, why = decide(c)
    c["decision"], c["reason"] = d, why
    hist[d] = hist.get(d, 0) + 1
f["thresholds"] = thr
json.dump(f, open(ACQ / "acq-metrics-MY.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

order = ["Scale", "Maintain", "Optimise", "Reduce", "Stop", "Reload", "Referral", "Low volume"]
print("DRAFT thresholds:", json.dumps(thr))
print("decision histogram:", {k: hist.get(k, 0) for k in order})
spend_by = {}
for c in codes: spend_by[c["decision"]] = spend_by.get(c["decision"], 0) + c["spend"]
print("spend by decision:", {k: f"RM{spend_by.get(k,0):,}" for k in order})
print()
print(f"  {'DECISION':10s} {'CODE':32s} {'CLM':>5} {'FTD':>4} {'RM/FTD':>7} {'STICK':>6}  REASON")
for d in order:
    for c in sorted([x for x in codes if x["decision"] == d], key=lambda x: -x["spend"]):
        cf = ('RM'+str(c['cost_per_ftd'])) if c['cost_per_ftd'] else 'n/a'
        sk = (str(c['stick_30'])+'%') if c['stick_30'] is not None else 'n/a'
        print(f"  {d:10s} {c['code'][:32]:32s} {c['claimers']:>5} {c['ftd']:>4} {cf:>7} {sk:>6}  {c['reason'][:46]}")
print("Saved acq-metrics-MY.json with DRAFT decisions")
