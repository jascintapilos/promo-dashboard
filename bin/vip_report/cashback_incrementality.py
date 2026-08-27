"""Cashback incrementality — base-rate benchmark + break-even hurdle (MY).

The dispositive test the CEO panel prioritised: do losing VIPs who got NO cashback redeposit at the
same ~97% rate as cashback recipients? If yes, the cashback is largely dead-weight (they'd stay anyway).

Build a weekly member-panel for rescue-eligible-tier members (Bronze+), flag LOSING weeks (house GGR
over the week > floor), split TREATED (got a Weekly-Rescue cashback that week) vs UNTREATED, and compare
forward-30d redeposit + forward-30d NGR, by tier. Then the per-tier break-even hurdle.
Member-level -> scratchpad only. Directional (observational, near-universal claim) — the holdout is the proof.
Usage: python bin/vip_report/cashback_incrementality.py
"""
import sys, json, re
from pathlib import Path
from datetime import date, timedelta
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
START, END1 = "2026-01-01", "2026-08-26"
LOSS_FLOOR = 1000.0          # a "losing week" = house won > RM1,000 off the member that week
LOGSITE = "WS1_MYS_MYR"
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
VIP_TIERS = ("Bronze", "Silver", "Gold", "Platinum", "Diamond")

def norm_tier(t):
    t = (t or "Unknown").strip()
    return re.sub(r"\s*\(Trial\)$", "", t) if t not in ("", "Unknown", "Agent Credit", "Scammers") else t

rescue = [r["code"] for r in json.load(open(VIP / "vip-codes-MY.json", encoding="utf-8")) if r["lane"] == "B-cashback"]
rinlist = ",".join("'" + c.replace("'", "''") + "'" for c in rescue)
c = get_client(send_receive_timeout=400)
SET = {"max_execution_time": 390, "max_memory_usage": 55000000000, "max_result_rows": 5000000}

# ---- Q1: rescue-eligible members = tier-at-end in a VIP tier ----
q1 = f"""
WITH act AS (
  SELECT DISTINCT MEMBER_ID FROM (
    SELECT MEMBER_ID FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='MYR' AND (DepositAmount>0 OR GGR!=0) AND SnapshotDate>='{START}' AND SnapshotDate<'{END1}'
    UNION ALL SELECT MEMBER_ID FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='MYR' AND (DepositAmount>0 OR GGR!=0) AND SnapshotDate>='{START}' AND SnapshotDate<'{END1}')),
mem AS (SELECT MEMBER_ID, toDateTime('2026-08-25 23:59:59') AS asof FROM act)
SELECT mem.MEMBER_ID AS MEMBER_ID, ifNull(t.tier,'Unknown') AS tier
FROM mem
ASOF LEFT JOIN (SELECT MEMBER_ID, (TIME + INTERVAL 8 HOUR) AS tdt, NewMembershipName AS tier
                FROM WORKSPACE.dedup_PlayerMembershipLog_A WHERE SITE='{LOGSITE}' AND NewMembershipName!='') t
  ON mem.MEMBER_ID=t.MEMBER_ID AND mem.asof >= t.tdt
"""
print("Q1: rescue-eligible member -> tier...")
tier_of = {}
for mid, tier in c.query(q1, settings=SET).result_rows:
    nt = norm_tier(tier)
    if nt in VIP_TIERS: tier_of[str(mid)] = nt
print(f"  VIP-tier members: {len(tier_of):,}")
inlist = ",".join("'" + m.replace("'", "''") + "'" for m in tier_of)

# ---- Q2: daily activity for those members ----
q2 = f"""
SELECT MEMBER_ID, SnapshotDate AS sd, sum(GGR) AS ggr, sum(NGR) AS ngr, sum(DepositAmount) AS dep
FROM (
  SELECT MEMBER_ID, SnapshotDate, GGR, NGR, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A
  WHERE Currency='MYR' AND SnapshotDate>='{START}' AND SnapshotDate<'2026-09-30' AND MEMBER_ID IN ({inlist}) AND (DepositAmount>0 OR GGR!=0 OR NGR!=0)
  UNION ALL
  SELECT MEMBER_ID, SnapshotDate, GGR, NGR, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC
  WHERE Currency='MYR' AND SnapshotDate>='{START}' AND SnapshotDate<'2026-09-30' AND MEMBER_ID IN ({inlist}) AND (DepositAmount>0 OR GGR!=0 OR NGR!=0)
) GROUP BY MEMBER_ID, SnapshotDate
"""
print("Q2: daily activity...")
daily = defaultdict(dict)   # member -> {date: (ggr, ngr, dep)}
for mid, sd, ggr, ngr, dep in c.query(q2, settings=SET).result_rows:
    daily[str(mid)][str(sd)] = (float(ggr), float(ngr), float(dep))
print(f"  members with activity: {len(daily):,}")

# ---- Q3: rescue claim dates ----
q3 = f"""SELECT MEMBER_ID, toDate(BonusTime_gmt8) AS d FROM WORKSPACE.GetBonus_ABC
  WHERE SITE_edit='WS1' AND Currency='MYR' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
    AND BonusTime_gmt8>='{START} 00:00:00' AND BonusTime_gmt8<'{END1} 00:00:00' AND BonusCode IN ({rinlist})
  GROUP BY MEMBER_ID, toDate(BonusTime_gmt8)"""
print("Q3: rescue claim dates...")
rescue_days = defaultdict(set)
for mid, d in c.query(q3, settings=SET).result_rows:
    rescue_days[str(mid)].add(str(d))
prog_start = min((d for days in rescue_days.values() for d in days), default=None)
print(f"  rescue claimers: {len(rescue_days):,} | program first claim: {prog_start}")

# ---- weekly panel: losing weeks, treated/untreated, forward 30d redeposit + NGR ----
def mondays():
    d = date.fromisoformat(START)
    d -= timedelta(days=d.weekday())
    end = date.fromisoformat("2026-08-25")
    while d <= end:
        yield d; d += timedelta(days=7)
WEEKS = list(mondays())
MATURE = date.fromisoformat("2026-08-26") - timedelta(days=37)   # week_end+30 observed

MATURE60 = date.fromisoformat("2026-08-26") - timedelta(days=67)   # week_end+60 observed
TIERS = ["Diamond", "Platinum", "Gold", "Silver", "Bronze"]

# ---- per (member, losing-week) records: loss, prior-deposit, forward amounts ----
records = []
for mid, days in daily.items():
    tier = tier_of.get(mid)
    if not tier: continue
    rdays = rescue_days.get(mid, set())
    for wk in WEEKS:
        we = wk + timedelta(days=6)
        if we > MATURE: continue
        wk_ggr = sum(days.get((wk + timedelta(days=i)).isoformat(), (0, 0, 0))[0] for i in range(7))
        if wk_ggr <= LOSS_FLOOR: continue
        treated = any((wk + timedelta(days=i)).isoformat() in rdays for i in range(10))
        fg = lambda i: days.get((we + timedelta(days=i)).isoformat(), (0, 0, 0))
        fwd_redep = any(fg(i)[2] > 0 for i in range(1, 31))
        prior_dep = sum(days.get((wk - timedelta(days=j)).isoformat(), (0, 0, 0))[2] for j in range(1, 29))
        records.append({"mid": mid, "tier": tier, "treated": treated, "loss": wk_ggr, "prior_dep": prior_dep,
                        "redep": 1 if fwd_redep else 0,
                        "fdep30": sum(fg(i)[2] for i in range(1, 31)), "fngr30": sum(fg(i)[1] for i in range(1, 31)),
                        "fggr30": sum(fg(i)[0] for i in range(1, 31)),
                        "fngr60": (sum(fg(i)[1] for i in range(1, 61)) if we <= MATURE60 else None),
                        "wk": wk.isoformat()})
print(f"  losing-week records: {len(records):,} (treated {sum(r['treated'] for r in records):,})")

# ---- (A) base-rate: forward-30d redeposit, treated vs untreated ----
agg = defaultdict(lambda: defaultdict(lambda: {"n": 0, "redep": 0, "fngr30": 0.0}))
for r in records:
    d = agg[r["tier"]]["treated" if r["treated"] else "untreated"]
    d["n"] += 1; d["redep"] += r["redep"]; d["fngr30"] += r["fngr30"]

# ---- (B) intensive margin: matched (tier x loss-decile x prior-deposit-decile) ----
def deciles(vals):
    s = sorted(vals); n = len(s)
    return [s[min(n - 1, int(k / 10 * n))] for k in range(1, 10)]
def dec(v, cuts):
    for i, cc in enumerate(cuts):
        if v <= cc: return i
    return len(cuts)
loss_cuts = deciles([r["loss"] for r in records]); dep_cuts = deciles([r["prior_dep"] for r in records])
cells = defaultdict(lambda: {"t": [], "u": []})
for r in records:
    cells[(r["tier"], dec(r["loss"], loss_cuts), dec(r["prior_dep"], dep_cuts))]["t" if r["treated"] else "u"].append(r)
def cmean(rows, k): return sum(x[k] for x in rows) / len(rows) if rows else 0.0
intensive = {}
for tier in TIERS:
    a = {"tn": 0, "ngr30": 0.0, "dep30": 0.0, "ngr60": 0.0, "t_ngr30": 0.0, "u_ngr30": 0.0, "t_dep30": 0.0, "u_dep30": 0.0}
    for cell, grp in cells.items():
        if cell[0] != tier or not grp["t"] or not grp["u"]: continue
        t, u, tn = grp["t"], grp["u"], len(grp["t"])
        a["tn"] += tn
        a["ngr30"] += (cmean(t, "fngr30") - cmean(u, "fngr30")) * tn
        a["dep30"] += (cmean(t, "fdep30") - cmean(u, "fdep30")) * tn
        a["t_ngr30"] += cmean(t, "fngr30") * tn; a["u_ngr30"] += cmean(u, "fngr30") * tn
        a["t_dep30"] += cmean(t, "fdep30") * tn; a["u_dep30"] += cmean(u, "fdep30") * tn
        t60 = [x["fngr60"] for x in t if x["fngr60"] is not None]; u60 = [x["fngr60"] for x in u if x["fngr60"] is not None]
        if t60 and u60: a["ngr60"] += (sum(t60) / len(t60) - sum(u60) / len(u60)) * tn
    tn = a["tn"] or 1; total_t = sum(1 for r in records if r["treated"] and r["tier"] == tier)
    intensive[tier] = {"matched_treated_n": a["tn"], "on_support_pct": round(a["tn"] / total_t * 100) if total_t else None,
                       "inc_dep30": round(a["dep30"] / tn), "inc_ngr30": round(a["ngr30"] / tn), "inc_ngr60": round(a["ngr60"] / tn),
                       "treated_dep30": round(a["t_dep30"] / tn), "untreated_dep30": round(a["u_dep30"] / tn),
                       "treated_ngr30": round(a["t_ngr30"] / tn), "untreated_ngr30": round(a["u_ngr30"] / tn)}

# ---- (C) within-member: same member's cashback loss-weeks vs own no-cashback loss-weeks ----
by_mem = defaultdict(lambda: {"t": [], "u": []})
for r in records:
    by_mem[r["mid"]]["t" if r["treated"] else "u"].append(r)
wm = defaultdict(lambda: {"n": 0, "d_ngr": 0.0, "d_dep": 0.0})
for mid, g in by_mem.items():
    if not g["t"] or not g["u"]: continue
    tier = g["t"][0]["tier"]; w = wm[tier]
    w["n"] += 1
    w["d_ngr"] += cmean(g["t"], "fngr30") - cmean(g["u"], "fngr30")
    w["d_dep"] += cmean(g["t"], "fdep30") - cmean(g["u"], "fdep30")
within_member = {tier: {"members": wm[tier]["n"],
                        "within_inc_ngr30": round(wm[tier]["d_ngr"] / wm[tier]["n"]) if wm[tier]["n"] else None,
                        "within_inc_dep30": round(wm[tier]["d_dep"] / wm[tier]["n"]) if wm[tier]["n"] else None} for tier in TIERS}

# ---- (D) date-shifted placebo: reassign "treated" to a sham window 21d earlier; a real effect must shrink ----
def treated_shift(mid, wk, back):
    rd = rescue_days.get(mid, set())
    return any((wk - timedelta(days=back) + timedelta(days=i)).isoformat() in rd for i in range(10))
placebo_cells = defaultdict(lambda: {"t": [], "u": []})
for r in records:
    ph = treated_shift(r["mid"], date.fromisoformat(r["wk"]), 21)
    placebo_cells[(r["tier"], dec(r["loss"], loss_cuts), dec(r["prior_dep"], dep_cuts))]["t" if ph else "u"].append(r)
placebo = {}
for tier in TIERS:
    num = den = 0.0
    for cell, grp in placebo_cells.items():
        if cell[0] != tier or not grp["t"] or not grp["u"]: continue
        tn = len(grp["t"]); num += (cmean(grp["t"], "fngr30") - cmean(grp["u"], "fngr30")) * tn; den += tn
    placebo[tier] = {"placebo_inc_ngr30": round(num / den) if den else None}

# ---- report + save ----
out = {"loss_floor": LOSS_FLOOR, "program_first_claim": prog_start, "records": len(records),
       "base_rate": {}, "intensive_margin": {}, "within_member": within_member, "placebo": placebo}
print(f"\n=== (A) BASE-RATE: forward-30d redeposit after a losing week (loss>RM{int(LOSS_FLOOR):,}) ===")
for tier in TIERS:
    t, u = agg[tier]["treated"], agg[tier]["untreated"]
    tr = t["redep"] / t["n"] * 100 if t["n"] else None; ur = u["redep"] / u["n"] * 100 if u["n"] else None
    lift = round(tr - ur, 1) if (tr is not None and ur is not None) else None
    print(f"  {tier:9s} | treated n={t['n']:>5} redep {round(tr,1) if tr is not None else 'n/a'}% | untreated n={u['n']:>5} redep {round(ur,1) if ur is not None else 'n/a'}% | lift {('+'+str(lift)+'pp') if lift is not None else 'n/a'}")
    out["base_rate"][tier] = {"treated_n": t["n"], "treated_redep": round(tr, 1) if tr is not None else None,
                              "untreated_n": u["n"], "untreated_redep": round(ur, 1) if ur is not None else None, "lift_pp": lift}
print(f"\n=== (B) INTENSIVE MARGIN: do cashback players DEPOSIT/PLAY more? (matched treated vs untreated) ===")
print(f"  {'TIER':9s} | matched-t | fwd-30d DEPOSIT t vs u (incr) | fwd-30d NGR t vs u (incr)")
for tier in TIERS:
    m = intensive[tier]
    print(f"  {tier:9s} | {m['matched_treated_n']:>7} ({m['on_support_pct']}%) | RM{m['treated_dep30']:,} vs RM{m['untreated_dep30']:,} (incr RM{m['inc_dep30']:,}) | RM{m['treated_ngr30']:,} vs RM{m['untreated_ngr30']:,} (incr RM{m['inc_ngr30']:,})")
    out["intensive_margin"][tier] = m
print(f"\n=== (C) WITHIN-MEMBER: same player's cashback vs own no-cashback losing-weeks (controls stickiness) ===")
for tier in TIERS:
    w = within_member[tier]
    print(f"  {tier:9s} | members with both {w['members']:>4} | within-member incr NGR RM{w['within_inc_ngr30']} | incr deposit RM{w['within_inc_dep30']}")
print(f"=== (D) PLACEBO (treated shifted 21d earlier — a real effect must shrink vs the true intensive NGR) ===")
for tier in TIERS:
    print(f"  {tier:9s} | true intensive incr NGR RM{intensive[tier]['inc_ngr30']:,} | placebo incr NGR RM{placebo[tier]['placebo_inc_ngr30']}")
json.dump(out, open(VIP / "cashback-incrementality-MY.json", "w", encoding="utf-8"), default=str)
print("\n(Incremental deposit/NGR near 0 => cashback recipients don't play more than matched losers who got none => dead-weight, even on the intensive margin. Directional; the holdout is the proof.)")
print("Saved scratchpad/vip/cashback-incrementality-MY.json")
