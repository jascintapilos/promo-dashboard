#!/usr/bin/env python3
"""Segment map — the targetable player base as a VALUE x STATE grid (the easy segmentation view).

VALUE axis = YTD-deposit band (the value axis that beats tier + NGR on stability — see the
segmentation analysis). STATE axis = recency (days since last deposit). Each cell = # members;
carries YTD NGR so you see where the value sits and which valuable segments are slipping.
Depositors only (never-deposited = acquisition, out of scope here).

Out: scratchpad/segment-map-{MK}.json = {"grid":[[vband,state,members,ngr],...]}
Run: python bin/segment_map_pull.py
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, START, END_EXCL, END_INCL

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))

c = get_client(send_receive_timeout=600)

for MK, CUR in (("MY", "MYR"), ("SG", "SGD")):
    q = f"""
    WITH m AS (
      SELECT MEMBER_ID, sum(dep) AS ytd_dep, sum(ngr) AS ytd_ngr, max(if(dep>0, sd, toDate('2000-01-01'))) AS last_dep
      FROM (
        SELECT MEMBER_ID, SnapshotDate sd, DepositAmount dep, NGR ngr FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE SITE_edit='WS1' AND Currency='{CUR}' AND SnapshotDate>='{START}' AND SnapshotDate<'{END_EXCL}'
        UNION ALL
        SELECT MEMBER_ID, SnapshotDate, DepositAmount, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE SITE_edit='WS1' AND Currency='{CUR}' AND SnapshotDate>='{START}' AND SnapshotDate<'{END_EXCL}'
      ) GROUP BY MEMBER_ID HAVING ytd_dep > 0
    )
    SELECT
      multiIf(ytd_dep>=100000,'Whale', ytd_dep>=20000,'High', ytd_dep>=2000,'Mid','Low') AS vband,
      multiIf(dateDiff('day',last_dep,toDate('{END_INCL}'))<=30,'Active',
              dateDiff('day',last_dep,toDate('{END_INCL}'))<=60,'Cooling',
              dateDiff('day',last_dep,toDate('{END_INCL}'))<=90,'Lapsed','Dormant') AS state,
      count() AS members, round(sum(ytd_ngr)) AS ngr, round(medianExact(ytd_dep)) AS med_dep
    FROM m GROUP BY vband, state
    """
    rows = c.query(q).result_rows
    grid = [[vb, st, int(mem), float(ngr or 0), float(md or 0)] for vb, st, mem, ngr, md in rows]
    path = SCR / f"segment-map-{MK}.json"
    json.dump({"grid": grid}, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    tot_m = sum(r[2] for r in grid)
    print(f"[{MK}] wrote {path.name} — {len(grid)} cells, {tot_m:,} depositing members")
