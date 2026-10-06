#!/usr/bin/env python3
"""Who was targeted — per-code profile of the CLAIMERS (the actual audience a code reached).

For each managed code, characterise the people who claimed it by their VALUE and TIER:
- med_dep = median of each claimer's DEPOSIT in the 90 days BEFORE their first claim of the code
           (their recent-deposit / engagement level AT TARGETING time — the value axis that beat
           tier and NGR on stability; see the segment-targeting analysis).
- med_ngr = median YTD NGR of the claimers (value context; NGR is luck-noisy, secondary).
- dom_tier = the 1-2 most common membership tiers among claimers (to expose tier-vs-value gaps).
- band mix = claimer counts by 90d-deposit band (low/mid/high/whale).

NB this is who CLAIMED (from the warehouse), NOT the CRM send-list (that lives in Smartico/FastTrack).
Out: scratchpad/who_targeted-{MK}.json = { code: {n, med_dep, med_ngr, dom_tier, lo, mi, hi, wh} }
Run: python bin/who_targeted_pull.py
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL

STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
MEMSITE = {"MY": "WS1_MYS_MYR", "SG": "WS1_SGP_SGD"}
SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


c = get_client(send_receive_timeout=900)

for MK, CUR in (("MY", "MYR"), ("SG", "SGD")):
    va = load(f"verify-action-{MK}.json")
    if not va:
        print(f"[{MK}] skip — verify-action missing")
        continue
    codes = sorted({co["code"].strip() for co in va["codes"]})
    if not codes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)")
        continue   # empty IN (...) is a ClickHouse error; skip like the missing-verify-action case
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)

    q = f"""
    WITH fc AS (
      SELECT trimBoth(BonusCode) AS code, MEMBER_ID, min(toDate(BonusTime_gmt8)) AS fcd
      FROM WORKSPACE.GetBonus_ABC
      WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0 AND BonusStatus IN {STATUSES}
        AND trimBoth(BonusCode) IN ({inlist}) AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'
      GROUP BY code, MEMBER_ID
    ),
    dep_src AS (
      SELECT MEMBER_ID, SnapshotDate AS sd, DepositAmount AS dep FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0 AND SnapshotDate >= '2025-10-01' AND SnapshotDate < '{END_EXCL}' AND MEMBER_ID IN (SELECT MEMBER_ID FROM fc)
      UNION ALL
      SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0 AND SnapshotDate >= '2025-10-01' AND SnapshotDate < '{END_EXCL}' AND MEMBER_ID IN (SELECT MEMBER_ID FROM fc)
    ),
    predep AS (
      SELECT f.code AS code, f.MEMBER_ID AS member, sum(d.dep) AS dep90
      FROM fc f
      LEFT JOIN dep_src d ON f.MEMBER_ID = d.MEMBER_ID AND d.sd < f.fcd AND d.sd >= f.fcd - 90
      GROUP BY code, member
    ),
    ytd AS (
      SELECT MEMBER_ID, sum(ngr) AS yn FROM (
        SELECT MEMBER_ID, NGR AS ngr FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND SnapshotDate >= '{START}' AND SnapshotDate < '{END_EXCL}' AND MEMBER_ID IN (SELECT MEMBER_ID FROM fc)
        UNION ALL
        SELECT MEMBER_ID, NGR FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND SnapshotDate >= '{START}' AND SnapshotDate < '{END_EXCL}' AND MEMBER_ID IN (SELECT MEMBER_ID FROM fc)
      ) GROUP BY MEMBER_ID
    ),
    tier AS (
      SELECT MEMBER_ID,
        multiIf(Membership LIKE '%Diamond%','Diamond', Membership LIKE '%Platinum%','Platinum', Membership LIKE '%Gold%','Gold',
                Membership LIKE '%Silver%','Silver', Membership LIKE '%Bronze%','Bronze','Classic/None') AS t
      FROM WORKSPACE.Members_Overview_ABC WHERE SITE='{MEMSITE[MK]}'
    )
    SELECT p.code AS code, count() AS n,
      round(median(p.dep90)) AS med_dep, round(median(ifNull(y.yn, 0))) AS med_ngr,
      arrayStringConcat(topK(2)(ti.t), ', ') AS dom_tier,
      countIf(p.dep90 < 500) AS lo, countIf(p.dep90 >= 500 AND p.dep90 < 5000) AS mi,
      countIf(p.dep90 >= 5000 AND p.dep90 < 50000) AS hi, countIf(p.dep90 >= 50000) AS wh
    FROM predep p
    LEFT JOIN ytd y ON p.member = y.MEMBER_ID
    LEFT JOIN tier ti ON p.member = ti.MEMBER_ID
    GROUP BY p.code
    """
    rows = c.query(q).result_rows
    out = {}
    for code, n, md, mn, dt, lo, mi, hi, wh in rows:
        out[code] = {"n": int(n), "med_dep": float(md or 0), "med_ngr": float(mn or 0),
                     "dom_tier": dt or "", "lo": int(lo), "mi": int(mi), "hi": int(hi), "wh": int(wh)}
    path = SCR / f"who_targeted-{MK}.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"[{MK}] wrote {path.name} — {len(out):,} codes profiled")
