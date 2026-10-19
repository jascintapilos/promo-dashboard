#!/usr/bin/env python3
"""Segment MIGRATION — the real ripple: how the depositing base MOVED between
(value band x recency state) cells over a 90-day horizon, plus reactivation recovery.

This is the warehouse-backed successor to the Segment map's "Who's here & at-risk"
snapshot. The snapshot shows standing stock (where members sit today); this shows
FLOW (where each member sat 90 days ago vs now), so the churn cascade, value drift
and reactivation become measured rates instead of a directional read off one photo.

===============================================================================
SPEC — read before building/trusting the output
===============================================================================

WHAT IT ANSWERS (all "observed flow, not causal — a holdout is the proof"):
  1. Recency churn cascade   Active -> Cooling -> Lapsed -> Dormant, as per-step rates
  2. Value-band drift         Whale <-> High <-> Mid <-> Low, up vs down
  3. Reactivation recovery    of those Lapsed/Dormant 90d ago, who re-deposited, how
                              fast, and how much NGR came back
  4. Net-flow leaderboard     per cell: members/NGR in vs out (derived from #1+#2)
  All four are DERIVED downstream from ONE emitted grain: `transitions` (the
  from-cell -> to-cell cross-tab). The pull emits raw grains only; assemble_* +
  the template marginalise them into the 4x4 recency matrix, the 4x4 band matrix,
  the net-flow leaderboard and the (collapsed) 16x16.

TWO ANCHORS:
  t_now  = END_INCL              (the snapshot "now" — same as the segment map)
  t_then = t_now - HORIZON days  (HORIZON = 90 → "90 days ago")

VALUE-BAND BASIS — the definitional fix (why NOT YTD):
  YTD cumulative deposit is not comparable across two dates — a member's YTD total
  only grows through the year, so a YTD band at t_then vs t_now would show fake
  upward drift. So we band on a FIXED trailing-window deposit at EACH anchor, same
  window length + same cut points at both, which IS comparable.

  WINDOW = the YTD span itself ( (END_INCL - START) + 1 = 237d for the default window ).
  Sizing the window to the YTD span is deliberate: at t_now the trailing window
  (t_now-WIN, t_now] collapses to exactly [START, END_INCL] — the SAME window the
  segment map bands on, with the SAME band/state formulas (Whale≥100k/High≥20k/Mid≥2k;
  Active≤30/Cooling≤60/Lapsed≤90/Dormant). So each cohort member lands in the SAME
  t_now cell as in the map. The t_now marginal therefore reproduces the map only over
  the OVERLAP (members in both the t_then cohort AND the YTD map) — it is NOT equal to
  the full map: the map additionally counts members whose first deposit is after t_then
  (post-t_then acquisitions/returns, in the map but not the cohort), and the cohort
  additionally counts fully-drained members (dep_then>0, dep_now=0 → band 'Low',
  last_now sentinel → 'Dormant') that the map — needing a now-window deposit — excludes.
  So a two-sided per-cell delta vs the map is EXPECTED; _selfcheck reports it as a drift
  diagnostic, not an equality gate (see below).

RECENCY STATE BASIS (symmetric at both anchors):
  state@A = bucket( dateDiff('day', last_dep_in_window@A, A) ), where
  last_dep_in_window@A = latest SnapshotDate with DepositAmount>0 in (A-WIN, A].
  A cohort member (deposited in the then-window) always has a valid last_then; a
  member with zero deposits in the now-window has no last_now -> Dormant (the fully
  drained case). Because WIN is the YTD span, last_now runs over [START, END_INCL],
  identical to the segment map, so the state FORMULA matches the map (member counts
  match only on the overlap cohort, per the WINDOW note above).

COHORT: depositors as of t_then (trailing-window deposit_then > 0) — "who was here
  90 days ago", whose flow we track. Members with NO then-window deposit are excluded
  (never-here or acquisition, out of scope, same as the segment map's HAVING dep>0).
  New members whose FIRST deposit is after t_then are acquisition — also out of scope.

ONE SCAN WINDOW covers everything: (t_then - WIN, t_now] serves both anchors. Two SQL
  aggregations (transitions, reactivation) each re-scan that shared window — run over that
  same member-level CTE — the transition cross-tab and the reactivation cohort.

OUTPUT  scratchpad/segment-migration-{MK}.json =
  {
    "meta": {market, currency, symbol, t_now, t_then, horizon_days, window_days,
             band_cuts:[100000,20000,2000], state_cuts:[30,60,90],
             basis, caveat},
    "transitions": [ {fb,fs,tb,ts, members, ngr_then, ngr_now}, ... ]   # <=256 rows, sparse
    "reactivation": { "pool_by_band": {Whale,High,Mid,Low},             # Lapsed+Dormant @ t_then
                      "rows": [ {band, bucket, members, recovered_ngr}, ... ] }  # bucket ∈ ≤7/8-30/31-60/>60
  }
  fb/fs = from band/state (@t_then); tb/ts = to band/state (@t_now).
  ngr_then/ngr_now = trailing-window NGR at each anchor (the value that moved).
  recovered_ngr = observed NGR over (t_then, t_now] for returners — GROSS observed,
  NOT net-of-baseline lift (baseline reactivation is largely organic; a holdout is
  the only lift proof). Return bucket = days from t_then to first redeposit.

DOWNSTREAM (not built yet — the pull is step 1):
  extract_explorer_data.py : load(f"segment-migration-{mk}.json") -> OUT[mk]["migration"]
  assemble_explorer_payload.py : pass through; optionally pre-derive the 4x4 cuts
  explorer-template.html : new cards in the "Who's here & at-risk" sub-view —
      recency 4x4 (marginalise transitions over bands), band 4x4 (over states),
      net-flow leaderboard (per cell in vs out), a net-leak KPI strip, and the
      16x16 as collapsed detail. All keep the standing "observed flow, not causal".

CAVEATS / GUARDRAILS:
  * observed flow, NOT causal — never attribute a move to a promo (who_claimed is
    reach, not cause; proof needs a randomised holdout). Do not join a code here.
  * reactivation NGR is the self-return baseline, not promo lift.
  * banding is the fixed-trailing-window basis (comparable across dates); it equals
    the segment map at t_now by construction but is a DIFFERENT quantity from the
    90-day PRE-CLAIM deposit band used by the Deposit-bands / config view. Label it.
  * warehouse endpoint is inherited from csir_config (WORKSPACE.Daily_GMT8_Snapshot_*);
    if segment_map_pull.py runs, this runs. The direct endpoint was unverified as of
    csir_config's migration note — confirm SHOW DATABASES / table grants first.
  * warehouse holds history to ~2018 (well before START), so the (t_then-WIN) lower
    bound (~2025-10 for HORIZON=90) has data. GMT+8 snapshots (Daily_GMT8), as segment map.
  * runtime: two full-scan aggregations per market over ~11 months of snapshots —
    use send_receive_timeout=600 as the segment map does.

Run:  python bin/segment_migration_pull.py        # both markets, HORIZON=90
      SEGMENT_HORIZON=60 python bin/segment_migration_pull.py   # 60-day horizon
===============================================================================
"""
import os
import sys
import json
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, START, END_INCL  # noqa: E402

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))

HORIZON = int(os.getenv("SEGMENT_HORIZON", "90"))          # days between the two anchors
_start = date.fromisoformat(START)
_t_now = date.fromisoformat(END_INCL)
_t_then = _t_now - timedelta(days=HORIZON)
WIN = (_t_now - _start).days + 1                            # trailing window = YTD span → t_now reproduces the map
T_NOW, T_THEN = _t_now.isoformat(), _t_then.isoformat()
BASIS = (f"fixed trailing-{WIN}d deposit window at each anchor (same span/cuts as the YTD segment map, "
         f"so the t_now marginal matches the map on the overlap cohort); comparable across the two dates")
BAND_NOTE = ("band cuts are RAW currency-unit magnitudes (100k/20k/2k), identical across markets and NOT "
             "money()-rescaled — mirroring the segment map is required for the t_now match, so SG 'Whale' "
             "(S$100k) is a higher real-money bar than MY 'Whale' (RM100k); bands are internal-to-market, "
             "not real-money-comparable across MY/SG")
CAVEAT = "observed flow, not causal — a holdout is the proof; reactivation NGR is the self-return baseline, not lift"

# multiIf fragments shared by both anchors — band on trailing-window deposit, state on recency-in-window.
def _band(dep):   # value band on a trailing-window deposit column
    return (f"multiIf({dep}>=100000,'Whale',{dep}>=20000,'High',{dep}>=2000,'Mid','Low')")
def _state(last, anchor):  # recency state; sentinel 1970 (no deposit in window) -> Dormant
    dd = f"dateDiff('day',{last},toDate('{anchor}'))"
    return (f"if({last}=toDate('1970-01-01'),'Dormant',"
            f"multiIf({dd}<=30,'Active',{dd}<=60,'Cooling',{dd}<=90,'Lapsed','Dormant'))")

# Member-level CTE: one row per member over the single scan (t_then-WIN, t_now], with the
# trailing-window deposit/NGR and last-deposit at BOTH anchors, plus first redeposit after t_then.
def _member_cte(cur):
    win_lo = (_t_then - timedelta(days=WIN)).isoformat()   # scan lower bound = then-window lower bound (exact fit, half-open)
    src = (f"SELECT MEMBER_ID, SnapshotDate sd, DepositAmount dep, NGR ngr "
           f"FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE SITE_edit='WS1' AND Currency='{cur}' AND SnapshotDate>'{win_lo}' AND SnapshotDate<='{T_NOW}' "
           f"UNION ALL "
           f"SELECT MEMBER_ID, SnapshotDate, DepositAmount, NGR "
           f"FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE SITE_edit='WS1' AND Currency='{cur}' AND SnapshotDate>'{win_lo}' AND SnapshotDate<='{T_NOW}'")
    return f"""
    SELECT MEMBER_ID,
      sumIf(dep, sd>toDate('{T_THEN}')-{WIN} AND sd<=toDate('{T_THEN}')) AS dep_then,
      sumIf(dep, sd>toDate('{T_NOW}')-{WIN}  AND sd<=toDate('{T_NOW}'))  AS dep_now,
      sumIf(ngr, sd>toDate('{T_THEN}')-{WIN} AND sd<=toDate('{T_THEN}')) AS ngr_then,
      sumIf(ngr, sd>toDate('{T_NOW}')-{WIN}  AND sd<=toDate('{T_NOW}'))  AS ngr_now,
      maxIf(sd, dep>0 AND sd>toDate('{T_THEN}')-{WIN} AND sd<=toDate('{T_THEN}')) AS last_then,
      maxIf(sd, dep>0 AND sd>toDate('{T_NOW}')-{WIN}  AND sd<=toDate('{T_NOW}'))  AS last_now,
      minIf(sd, dep>0 AND sd>toDate('{T_THEN}') AND sd<=toDate('{T_NOW}')) AS first_redep,
      sumIf(ngr, sd>toDate('{T_THEN}') AND sd<=toDate('{T_NOW}')) AS ngr_since_then
    FROM ( {src} )
    GROUP BY MEMBER_ID
    HAVING dep_then>0
    """

def _transitions_sql(cur):
    return f"""
    SELECT fb, fs, tb, ts, count() AS members, round(sum(ngr_then)) AS ngr_then, round(sum(ngr_now)) AS ngr_now
    FROM (
      SELECT MEMBER_ID,
        {_band('dep_then')} AS fb, {_state('last_then', T_THEN)} AS fs,
        {_band('dep_now')}  AS tb, {_state('last_now',  T_NOW)}  AS ts,
        ngr_then, ngr_now
      FROM ( {_member_cte(cur)} )
    )
    GROUP BY fb, fs, tb, ts
    """

def _reactivation_sql(cur):
    # cohort = Lapsed/Dormant @ t_then; returner = deposited in (t_then, t_now]; bucket = days t_then->first_redep
    return f"""
    SELECT fb AS band,
      multiIf(first_redep=toDate('1970-01-01'),'none',
              dateDiff('day',toDate('{T_THEN}'),first_redep)<=7,'<=7',
              dateDiff('day',toDate('{T_THEN}'),first_redep)<=30,'8-30',
              dateDiff('day',toDate('{T_THEN}'),first_redep)<=60,'31-60','>60') AS bucket,
      count() AS members, round(sum(ngr_since_then)) AS recovered_ngr
    FROM (
      SELECT MEMBER_ID, {_band('dep_then')} AS fb, {_state('last_then', T_THEN)} AS fs, first_redep, ngr_since_then
      FROM ( {_member_cte(cur)} )
    )
    WHERE fs IN ('Lapsed','Dormant')
    GROUP BY band, bucket
    """

def _selfcheck(transitions, mk):
    """Informational DRIFT report, NOT an equality gate. The t_now marginal reproduces the map only on
    the overlap cohort, so a two-sided per-cell delta is EXPECTED — this reports its size/direction, it
    cannot by itself confirm correctness (a genuine mis-shuffle would also read as a delta)."""
    smap = SCR / f"segment-map-{mk}.json"
    if not smap.exists():
        return "segment map not present — drift report skipped"
    grid = {(r[0], r[1]): int(r[2]) for r in json.load(open(smap, encoding="utf-8"))["grid"]}
    got = {}
    for t in transitions:
        got[(t["tb"], t["ts"])] = got.get((t["tb"], t["ts"]), 0) + t["members"]
    keys = set(grid) | set(got)                                  # union, so migration-only cells are seen too
    over = sum(max(0, v - grid.get(k, 0)) for k, v in got.items())   # marginal>map: fully-drained → (Low,Dormant)
    under = sum(max(0, grid.get(k, 0) - got.get(k, 0)) for k in keys)  # map>marginal: post-t_then acquisitions/returns
    ncell = sum(1 for k in keys if got.get(k, 0) != grid.get(k, 0))
    return (f"drift vs map on {ncell} cells (EXPECTED): +{over:,} marginal-only (drained→Low/Dormant), "
            f"-{under:,} map-only (post-t_then new/returned) — informational, not a pass/fail")

def main():
    c = get_client(send_receive_timeout=600)
    for MK, CUR in (("MY", "MYR"), ("SG", "SGD")):
        sym = "RM" if MK == "MY" else "S$"
        tx = [{"fb": r[0], "fs": r[1], "tb": r[2], "ts": r[3],
               "members": int(r[4]), "ngr_then": float(r[5] or 0), "ngr_now": float(r[6] or 0)}
              for r in c.query(_transitions_sql(CUR)).result_rows]
        rx = [{"band": r[0], "bucket": r[1], "members": int(r[2]), "recovered_ngr": float(r[3] or 0)}
              for r in c.query(_reactivation_sql(CUR)).result_rows]
        pool = {}   # pool = every Lapsed/Dormant member @ t_then, ALL buckets incl. 'none' (non-returners) → the reactivation-rate denominator
        for row in rx:
            pool[row["band"]] = pool.get(row["band"], 0) + row["members"]
        out = {
            "meta": {"market": MK, "currency": CUR, "symbol": sym, "t_now": T_NOW, "t_then": T_THEN,
                     "horizon_days": HORIZON, "window_days": WIN, "band_cuts": [100000, 20000, 2000],
                     "state_cuts": [30, 60, 90], "basis": BASIS, "band_note": BAND_NOTE, "caveat": CAVEAT},
            "transitions": tx,
            "reactivation": {"pool_by_band": pool, "rows": [r for r in rx if r["bucket"] != "none"]},
        }
        path = SCR / f"segment-migration-{MK}.json"
        json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)
        moved = sum(t["members"] for t in tx if (t["fb"], t["fs"]) != (t["tb"], t["ts"]))
        print(f"[{MK}] wrote {path.name} — {len(tx)} transition cells, cohort {sum(t['members'] for t in tx):,}, "
              f"{moved:,} moved cell · reactivation rows {len(out['reactivation']['rows'])} · {_selfcheck(tx, MK)}")

if __name__ == "__main__":
    main()
