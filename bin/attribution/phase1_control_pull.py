"""Phase 1 attribution strengthening — untreated matched-control cohort pull (MY).

The forward pulls covered only CLAIMERS. The matched-control difference-in-differences needs the
same pre/forward NGR trajectory for UNTREATED members, anchored to a comparable calendar so seasonality
is controlled. This pulls, per (sampled member, monthly anchor), the NGR in three windows around the
anchor — pre-pre (−180..−90, for the pre-trend placebo), pre (−90..0), forward (0..90) — plus prior-90
deposits (a matching covariate) and end-period tier. Matching + DiD happen in Python (phase1_matched_did.py).

Out: scratchpad/attribution/control-cohort-MY.json
Usage: python bin/attribution/phase1_control_pull.py [sample_mod]   (default 10 = ~10%)
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, START, END_INCL, snap_lo, snap_hi

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
OUT = SCR / "attribution"
OUT.mkdir(exist_ok=True)
LOGSITE = "WS1_MYS_MYR"
END = END_INCL   # from csir_config date seam (START also imported)
SNAP_LO, SNAP_HI = snap_lo(184), snap_hi(86)   # attribution pre-trend + forward window (generous over-fetch)
# monthly anchors (15th of each month) spanning the window — derived from the date seam, not hardcoded Jan–Aug
from datetime import date as _dt
_as, _ae = _dt.fromisoformat(START), _dt.fromisoformat(END)
ANCHORS, _ay, _am = [], _as.year, _as.month
while (_ay, _am) <= (_ae.year, _ae.month):
    ANCHORS.append(f"{_ay:04d}-{_am:02d}-15"); _am += 1
    if _am > 12: _am, _ay = 1, _ay + 1
SAMPLE_MOD = int(sys.argv[1]) if len(sys.argv) > 1 else 10

anchor_arr = "[" + ",".join("'" + a + "'" for a in ANCHORS) + "]"
q = f"""
WITH
pool AS (
    SELECT DISTINCT SITE, MEMBER_ID FROM (
        SELECT SITE, MEMBER_ID FROM WORKSPACE.Daily_GMT8_Snapshot_A
        WHERE Currency='MYR' AND SnapshotDate BETWEEN '{SNAP_LO}' AND '{SNAP_HI}' AND (DepositAmount>0 OR NGR!=0)
        UNION ALL
        SELECT SITE, MEMBER_ID FROM WORKSPACE.Daily_GMT8_Snapshot_BC
        WHERE Currency='MYR' AND SnapshotDate BETWEEN '{SNAP_LO}' AND '{SNAP_HI}' AND (DepositAmount>0 OR NGR!=0)
    ) WHERE cityHash64(MEMBER_ID) % {SAMPLE_MOD} = 0
),
snap AS (
    SELECT SITE AS ss, MEMBER_ID AS sm, SnapshotDate AS sd, DepositAmount AS dep, NGR AS ngr
    FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='MYR' AND SnapshotDate BETWEEN '{SNAP_LO}' AND '{SNAP_HI}' AND (DepositAmount>0 OR NGR!=0)
    UNION ALL
    SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, NGR
    FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='MYR' AND SnapshotDate BETWEEN '{SNAP_LO}' AND '{SNAP_HI}' AND (DepositAmount>0 OR NGR!=0)
),
tier AS (
    SELECT MEMBER_ID, argMax(NewMembershipName, TIME) AS tier
    FROM WORKSPACE.dedup_PlayerMembershipLog_A
    WHERE SITE='{LOGSITE}' AND NewMembershipName!='' AND (TIME + INTERVAL 8 HOUR) < '{END} 00:00:00'
    GROUP BY MEMBER_ID
),
pa AS (SELECT SITE, MEMBER_ID, toDate(arrayJoin({anchor_arr})) AS anchor FROM pool)
SELECT
    pa.MEMBER_ID AS MEMBER_ID, pa.anchor AS anchor, ifNull(t.tier,'Unknown') AS tier,
    sumIf(ifNull(s.ngr,0), w.off >= -180 AND w.off < -90) AS pre_pre_90,
    sumIf(ifNull(s.ngr,0), w.off >= -90  AND w.off < 0)   AS pre_90,
    sumIf(ifNull(s.ngr,0), w.off >= 0    AND w.off < 90)  AS fwd_90,
    sumIf(ifNull(s.dep,0), w.off >= -90  AND w.off < 0)   AS pre_dep_90
FROM pa
CROSS JOIN (SELECT toInt32(number) - 180 AS off FROM numbers(270)) w
LEFT JOIN snap s ON pa.SITE = s.ss AND pa.MEMBER_ID = s.sm AND addDays(pa.anchor, w.off) = s.sd
LEFT JOIN tier t ON pa.MEMBER_ID = t.MEMBER_ID
GROUP BY pa.MEMBER_ID, pa.anchor, tier
"""

c = get_client(send_receive_timeout=600)
SET = {"readonly": 1, "max_execution_time": 590, "max_memory_usage": 60000000000,
       "max_result_rows": 8000000, "result_overflow_mode": "break", "join_algorithm": "auto"}
res = c.query(q, settings=SET)
out = []
for row in res.result_rows:
    d = dict(zip(res.column_names, row))
    # keep only anchor-rows with any signal (a member fully dormant at an anchor is not a useful control)
    if float(d["pre_90"]) == 0 and float(d["fwd_90"]) == 0 and float(d["pre_dep_90"]) == 0 and float(d["pre_pre_90"]) == 0:
        continue
    out.append({"member": str(d["MEMBER_ID"]), "anchor": str(d["anchor"]), "tier": d["tier"],
                "pre_pre_90": round(float(d["pre_pre_90"])), "pre_90": round(float(d["pre_90"])),
                "fwd_90": round(float(d["fwd_90"])), "pre_dep_90": round(float(d["pre_dep_90"]))})
json.dump(out, open(OUT / "control-cohort-MY.json", "w", encoding="utf-8"), default=str)
mem = len({r["member"] for r in out})
print(f"control cohort: {len(out):,} member-anchor rows | {mem:,} distinct members (sample 1/{SAMPLE_MOD}) | {len(ANCHORS)} anchors")
print("Saved scratchpad/attribution/control-cohort-MY.json")
