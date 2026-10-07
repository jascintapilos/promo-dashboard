"""STORE-BACKED producer for bin/vip_report/cashback_incrementality.py — cashback incrementality (MY).

Byte-compatible twin of bin/vip_report/cashback_incrementality.py: SAME Python panel logic, SAME output
JSON (scratchpad/vip/cashback-incrementality-MY.json). ONLY the two store-friendly warehouse queries are
swapped for DuckDB-over-Parquet-stores so the parallel build engine can run them locally and fast:

  * Q2 (daily activity: GGR/NGR/DepositAmount per member-day) — ClickHouse Daily_GMT8_Snapshot_A UNION _BC
    -> store_b.parquet. store_b is the RAW A-UNION-BC rows for cur IN (MYR,SGD) with (dep>0 OR ngr!=0 OR
    ggr!=0) already applied (the exact same OR-filter as the live inner SELECT), NOT pre-grouped — so
    re-summing per (member, sd) over store_b reproduces the live `sum(...) GROUP BY MEMBER_ID,SnapshotDate`
    EXACTLY, including cross-brand members that the live UNION ALL + GROUP BY folds across partitions.
    Same string-date range bounds (START .. snap_hi(35)).
  * Q3 (rescue claim dates) — ClickHouse GetBonus_ABC -> store_claims.parquet. store_claims already has the
    SITE_edit=WS1 + BonusAmount>0 + active-status filter baked in; cd is toString(toDate(BonusTime_gmt8)),
    which makes `cd>=START AND cd<END1` identical to the live `BonusTime_gmt8 IN [START 00:00:00, END1
    00:00:00)` at the date boundaries, and `GROUP BY member, cd` identical to the live group.

  * Q1 (rescue-eligible member -> tier via the dedup_PlayerMembershipLog_A ASOF join) STAYS ON THE
    WAREHOUSE verbatim — the membership log lives in no store.

Everything downstream (weekly panel, base-rate/intensive/within-member/placebo, the break-even inputs,
the prints, the saved JSON) is IDENTICAL to the original. Per-query + whole-stage perf_counter timings are
printed (and written to scratchpad/vip/cashback-incrementality-timings-store.json) to measure how much of
the live 15s is the warehouse membership Q1 vs the now-local Q2/Q3; they do not touch the output JSON.

Out: scratchpad/vip/cashback-incrementality-MY.json
Usage: python bin/preagg/produce_cashback_incrementality.py
"""
import sys, os, json, re
from pathlib import Path
from datetime import date, timedelta
from collections import defaultdict
from time import perf_counter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import duckdb
from csir_config import get_client, START, END_EXCL, END_INCL, AS_OF_DATE, snap_hi

VIP = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip")
STORE = os.environ.get("PROMO_PREAGG",
    r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/preagg")
STOREB = os.path.join(STORE, "store_b.parquet").replace("\\", "/")
CLAIMS = os.path.join(STORE, "store_claims.parquet").replace("\\", "/")
END1 = END_EXCL   # from csir_config date seam (START also imported)
LOSS_FLOOR = 1000.0          # a "losing week" = house won > RM1,000 off the member that week
LOGSITE = "WS1_MYS_MYR"
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
VIP_TIERS = ("Bronze", "Silver", "Gold", "Platinum", "Diamond")
_timings = {}
_t_stage = perf_counter()

def norm_tier(t):
    t = (t or "Unknown").strip()
    return re.sub(r"\s*\(Trial\)$", "", t) if t not in ("", "Unknown", "Agent Credit", "Scammers") else t

rescue = [r["code"] for r in json.load(open(VIP / "vip-codes-MY.json", encoding="utf-8")) if r["lane"] == "B-cashback"]
rinlist = ",".join("'" + c.replace("'", "''") + "'" for c in rescue)
c = get_client(send_receive_timeout=400)
SET = {"max_execution_time": 390, "max_memory_usage": 55000000000, "max_result_rows": 5000000}

# ---- Q1: rescue-eligible members = tier-at-end in a VIP tier (ON THE WAREHOUSE — membership log in no store) ----
q1 = f"""
WITH act AS (
  SELECT DISTINCT MEMBER_ID FROM (
    SELECT MEMBER_ID FROM WORKSPACE.Daily_GMT8_Snapshot_A WHERE Currency='MYR' AND (DepositAmount>0 OR GGR!=0) AND SnapshotDate>='{START}' AND SnapshotDate<'{END1}'
    UNION ALL SELECT MEMBER_ID FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='MYR' AND (DepositAmount>0 OR GGR!=0) AND SnapshotDate>='{START}' AND SnapshotDate<'{END1}')),
mem AS (SELECT MEMBER_ID, toDateTime('{END_INCL} 23:59:59') AS asof FROM act)
SELECT mem.MEMBER_ID AS MEMBER_ID, ifNull(t.tier,'Unknown') AS tier
FROM mem
ASOF LEFT JOIN (SELECT MEMBER_ID, (TIME + INTERVAL 8 HOUR) AS tdt, NewMembershipName AS tier
                FROM WORKSPACE.dedup_PlayerMembershipLog_A WHERE SITE='{LOGSITE}' AND NewMembershipName!='') t
  ON mem.MEMBER_ID=t.MEMBER_ID AND mem.asof >= t.tdt
"""
print("Q1: rescue-eligible member -> tier... [WAREHOUSE]")
_t = perf_counter()
_rows_q1 = c.query(q1, settings=SET).result_rows
_timings["q1_warehouse"] = round(perf_counter() - _t, 3)
tier_of = {}
for mid, tier in _rows_q1:
    nt = norm_tier(tier)
    if nt in VIP_TIERS: tier_of[str(mid)] = nt
print(f"  VIP-tier members: {len(tier_of):,}  (Q1 {_timings['q1_warehouse']}s)")
inlist = ",".join("'" + m.replace("'", "''") + "'" for m in tier_of)

# ---- Q2: daily activity for those members (STORE: re-sum store_b per member-day) ----
q2 = f"""
SELECT member, sd, sum(ggr) AS ggr, sum(ngr) AS ngr, sum(dep) AS dep
FROM read_parquet('{STOREB}')
WHERE cur='MYR' AND sd>='{START}' AND sd<'{snap_hi(35)}' AND member IN ({inlist})
GROUP BY member, sd
"""
print("Q2: daily activity... [STORE store_b]")
_t = perf_counter()
_rows_q2 = duckdb.sql(q2).fetchall()
_timings["q2_store"] = round(perf_counter() - _t, 3)
daily = defaultdict(dict)   # member -> {date: (ggr, ngr, dep)}
for mid, sd, ggr, ngr, dep in _rows_q2:
    daily[str(mid)][str(sd)] = (float(ggr), float(ngr), float(dep))
print(f"  members with activity: {len(daily):,}  (Q2 {_timings['q2_store']}s)")

# ---- Q3: rescue claim dates (STORE: store_claims, cd already toDate string) ----
q3 = f"""
SELECT member, cd
FROM read_parquet('{CLAIMS}')
WHERE cur='MYR' AND cd>='{START}' AND cd<'{END1}' AND code IN ({rinlist})
GROUP BY member, cd
"""
print("Q3: rescue claim dates... [STORE store_claims]")
_t = perf_counter()
_rows_q3 = duckdb.sql(q3).fetchall()
_timings["q3_store"] = round(perf_counter() - _t, 3)
rescue_days = defaultdict(set)
for mid, d in _rows_q3:
    rescue_days[str(mid)].add(str(d))
prog_start = min((d for days in rescue_days.values() for d in days), default=None)
print(f"  rescue claimers: {len(rescue_days):,} | program first claim: {prog_start}  (Q3 {_timings['q3_store']}s)")

# ---- weekly panel: losing weeks, treated/untreated, forward 30d redeposit + NGR ----
def mondays():
    d = date.fromisoformat(START)
    d -= timedelta(days=d.weekday())
    end = date.fromisoformat(END_INCL)
    while d <= end:
        yield d; d += timedelta(days=7)
WEEKS = list(mondays())
MATURE = AS_OF_DATE - timedelta(days=37)   # week_end+30 observed

MATURE60 = AS_OF_DATE - timedelta(days=67)   # week_end+60 observed
TIERS = ["Diamond", "Platinum", "Gold", "Silver", "Bronze"]

# ---- per (member, losing-week) records: loss, prior-deposit, forward amounts ----
# STORE-BACKED FAST PATH.  The original ~12s Python loop below (kept verbatim in bin/vip_report/
# cashback_incrementality.py) scanned ~195 date keys per (member, week) through `daily`:
#
#     for mid, days in daily.items():
#         for wk in WEEKS:
#             we = wk + 6d
#             if we > MATURE: continue
#             wk_ggr = sum(days.get(wk+i)[0] for i in range(7))            # loss window  [wk, wk+6]
#             if wk_ggr <= LOSS_FLOOR: continue
#             treated   = any(rescue claim in [wk, wk+9])
#             redep     = any(dep>0 over [we+1, we+30] == [wk+7, wk+36])
#             prior_dep = sum(dep over [wk-28, wk-1], folded wk-1..wk-28)
#             fdep30/fngr30/fggr30 = sum over [wk+7, wk+36]
#             fngr60    = sum(ngr over [wk+7, wk+66]) if we <= MATURE60 else None
#
# It is replaced by a DuckDB window aggregation over daily_rel (the SAME per-(member,sd) sums `daily`
# holds).  DuckDB does the heavy range-join; the per-window amounts are summed with CPython's own
# compensated (Neumaier) algorithm — the one `sum()` uses on floats since 3.12 — replicated bit-for-bit
# in SQL as an ordered list_reduce struct fold, in the SAME fold order the Python generator yields
# (ascending sd for the loss/forward windows, descending for prior_dep).  Every record field therefore
# equals the Python loop's to the bit, so loss/prior-deposit deciles, matched cells, within-member and
# placebo all tie EXACTLY.  Records are assembled in the SAME order as the Python loop (daily insertion
# order x WEEKS) and `treated` is derived from rescue_days exactly as before.
_t = perf_counter()
def _neu(col, order, lo, hi):
    """SQL expr: Neumaier compensated sum (== CPython sum()) over present `col` values, folded in `order`."""
    lst = f"list({col} ORDER BY {order}) FILTER (WHERE doff BETWEEN {lo} AND {hi})"
    return (f"list_reduce(list_transform({lst}, v -> {{'s': v, 'c': 0.0::DOUBLE}}), "
            f"(acc,x) -> {{'s': acc.s + x.s, 'c': acc.c + (CASE WHEN abs(acc.s) >= abs(x.s) "
            f"THEN (acc.s - (acc.s + x.s)) + x.s ELSE (x.s - (acc.s + x.s)) + acc.s END)}})")
_MAT = MATURE.isoformat(); _MAT60 = MATURE60.isoformat()
dcon = duckdb.connect()
# daily_rel = the EXACT same per-(member,sd) aggregation `daily` holds (store_b re-summed, sd as DATE).
dcon.execute(f"CREATE TABLE daily_rel AS SELECT member, CAST(sd AS DATE) AS sdd, ggr, ngr, dep FROM ({q2})")
dcon.execute("CREATE TABLE weeks(wk DATE)")
dcon.executemany("INSERT INTO weeks VALUES (?)", [(w.isoformat(),) for w in WEEKS])
# Pass 1 (fast plain-sum): candidate (member,wk) = matured week (we<=MATURE) whose plain GGR loss clears
# FLOOR minus a 10.0 slack — a guaranteed superset of the exact-Neumaier filter (plain vs Neumaier differ
# only by ~1e-7); the exact > FLOOR cut is re-applied with the Neumaier loss in pass 2.  Member set =
# members present in daily_rel, which is exactly the set the Python loop iterates (daily.items()).
dcon.execute(f"""CREATE TEMP TABLE cand AS
  WITH j AS (
    SELECT d.member AS member, w.wk AS wk, d.ggr AS ggr, date_diff('day', w.wk, d.sdd) AS doff
    FROM weeks w
    JOIN daily_rel d ON d.sdd BETWEEN (w.wk - INTERVAL 28 DAY) AND (w.wk + INTERVAL 66 DAY)
    WHERE (w.wk + INTERVAL 6 DAY) <= DATE '{_MAT}'
  )
  SELECT member, wk FROM j GROUP BY member, wk
  HAVING sum(ggr) FILTER (WHERE doff BETWEEN 0 AND 6) > {LOSS_FLOOR} - 10.0""")
# Pass 2 (Neumaier-in-SQL over the small candidate join only): exact per-window scalar sums + exact
# loss>FLOOR filter.  Returns scalars (not lists) so the fetch is cheap.
_built = {}
for (member, wk, loss, prior_dep, fdep30, fngr30, fggr30, redep, fngr60) in dcon.execute(f"""
  WITH j AS (
    SELECT c.member AS member, c.wk AS wk, d.sdd AS sdd, d.ggr AS ggr, d.ngr AS ngr, d.dep AS dep,
           date_diff('day', c.wk, d.sdd) AS doff
    FROM cand c
    JOIN daily_rel d ON d.member = c.member
         AND d.sdd BETWEEN (c.wk - INTERVAL 28 DAY) AND (c.wk + INTERVAL 66 DAY)
  ),
  s AS (
    SELECT member, wk,
      {_neu('ggr','sdd',0,6)}         AS loss_s,
      {_neu('dep','sdd DESC',-28,-1)} AS prior_s,
      {_neu('dep','sdd',7,36)}        AS fdep_s,
      {_neu('ngr','sdd',7,36)}        AS fngr_s,
      {_neu('ggr','sdd',7,36)}        AS fggr_s,
      coalesce(bool_or(dep > 0) FILTER (WHERE doff BETWEEN 7 AND 36), false) AS redep_b,
      {_neu('ngr','sdd',7,66)}        AS fngr60_s
    FROM j GROUP BY member, wk
  )
  SELECT member, wk,
    coalesce(loss_s.s + loss_s.c, 0.0)   AS loss,
    coalesce(prior_s.s + prior_s.c, 0.0) AS prior_dep,
    coalesce(fdep_s.s + fdep_s.c, 0.0)   AS fdep30,
    coalesce(fngr_s.s + fngr_s.c, 0.0)   AS fngr30,
    coalesce(fggr_s.s + fggr_s.c, 0.0)   AS fggr30,
    CASE WHEN redep_b THEN 1 ELSE 0 END  AS redep,
    CASE WHEN (wk + INTERVAL 6 DAY) <= DATE '{_MAT60}' THEN coalesce(fngr60_s.s + fngr60_s.c, 0.0) ELSE NULL END AS fngr60
  FROM s WHERE coalesce(loss_s.s + loss_s.c, 0.0) > {LOSS_FLOOR}""").fetchall():
    _built[(member, wk.isoformat())] = (loss, prior_dep, int(redep), fdep30, fngr30, fggr30, fngr60)
records = []
for mid, days in daily.items():
    tier = tier_of.get(mid)
    if not tier: continue
    rdays = rescue_days.get(mid, set())
    for wk in WEEKS:
        rec = _built.get((mid, wk.isoformat()))
        if rec is None: continue
        treated = any((wk + timedelta(days=i)).isoformat() in rdays for i in range(10))
        loss, prior_dep, redep, fdep30, fngr30, fggr30, fngr60 = rec
        records.append({"mid": mid, "tier": tier, "treated": treated, "loss": loss, "prior_dep": prior_dep,
                        "redep": redep, "fdep30": fdep30, "fngr30": fngr30, "fggr30": fggr30,
                        "fngr60": fngr60, "wk": wk.isoformat()})
_timings["record_build"] = round(perf_counter() - _t, 3)
print(f"  losing-week records: {len(records):,} (treated {sum(r['treated'] for r in records):,})  (build {_timings['record_build']}s)")

# ---- (A) base-rate: forward-30d redeposit, treated vs untreated ----
agg = defaultdict(lambda: defaultdict(lambda: {"n": 0, "redep": 0, "fngr30": 0.0}))
for r in records:
    d = agg[r["tier"]]["treated" if r["treated"] else "untreated"]
    d["n"] += 1; d["redep"] += r["redep"]; d["fngr30"] += r["fngr30"]

# ---- (B) intensive margin: matched (tier x loss-decile x prior-deposit-decile) ----
def deciles(vals):
    s = sorted(vals); n = len(s)
    if n == 0: return [0] * 9   # thin/recent window: no matured losing-week records -> flat cuts; every downstream aggregation is already None/0-guarded
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

# ---- perf timings (store path): Q1 warehouse vs now-local Q2/Q3; does NOT touch the output JSON ----
_timings["stage_total"] = round(perf_counter() - _t_stage, 3)
_timings["q_fetch_total"] = round(_timings["q1_warehouse"] + _timings["q2_store"] + _timings["q3_store"], 3)
json.dump(_timings, open(VIP / "cashback-incrementality-timings-store.json", "w", encoding="utf-8"))
print(f"\n[timings-store] Q1(warehouse)={_timings['q1_warehouse']}s  Q2(store)={_timings['q2_store']}s  "
      f"Q3(store)={_timings['q3_store']}s  fetch_total={_timings['q_fetch_total']}s  stage_total={_timings['stage_total']}s")
