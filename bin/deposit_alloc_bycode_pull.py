#!/usr/bin/env python3
"""Overlap-FREE per-code deposits (equal-split across ALL codes) — windows 7/30/90, both markets.

Each distinct member-deposit-day within W days after a claim is split EQUALLY among ALL in-scope codes
the member claimed in that window, so no deposit is counted twice. Per-code shares sum EXACTLY to the
distinct total at every window (RM207.6m at 30d). Per-group = sum of per-code within the group (done in assemble).

Out: scratchpad/deposit-alloc-bycode-{MK}.json = { sym, byWindow: {"7":{code:alloc}, "30":..., "90":...}, distinct:{"7":..} }
"""
import sys, json
from pathlib import Path

ROOT = Path(r"C:/Users/vdiuser/Downloads/promo-automation")
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL

SCR = Path(__import__("os").environ.get("PROMO_SCRATCH", r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad"))
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"
MK_CFG = {"MY": ("MYR", "RM"), "SG": ("SGD", "S$")}
WINDOWS = (7, 30, 90)


def load(p):
    fp = SCR / p
    return json.load(open(fp, encoding="utf-8")) if fp.exists() else None


c = get_client(send_receive_timeout=900)

for MK, (CUR, SYM) in MK_CFG.items():
    va = load(f"verify-action-{MK}.json")
    codes = sorted({co["code"].strip() for co in va["codes"]})
    if not codes:
        print(f"[{MK}] skip — no action codes in this window (thin/recent)"); continue  # empty IN (...) is a ClickHouse error
    inlist = ",".join("'" + x.replace("'", "''") + "'" for x in codes)
    out = {"sym": SYM, "byWindow": {}, "distinct": {}}
    for W in WINDOWS:
        rows = c.query(f"""
          WITH claims AS (
            SELECT trimBoth(BonusCode) code, MEMBER_ID member, toDate(BonusTime_gmt8) cd
            FROM WORKSPACE.GetBonus_ABC
            WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0
              AND trimBoth(BonusCode) IN ({inlist}) AND BonusStatus IN {STATUSES}
              AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'
          ),
          deps AS (
            SELECT MEMBER_ID member, SnapshotDate sd, sum(DepositAmount) dep FROM (
              SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0
              UNION ALL
              SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0
            ) WHERE MEMBER_ID IN (SELECT member FROM claims) GROUP BY MEMBER_ID, SnapshotDate
          ),
          distinct_deps AS (
            SELECT cl.member member, d.sd sd, any(d.dep) dep
            FROM claims cl INNER JOIN deps d ON cl.member=d.member
            WHERE d.sd > cl.cd AND d.sd <= cl.cd + {W} GROUP BY member, sd
          ),
          pairs AS (   -- distinct (member, deposit-day, code): every code the member claimed within W before the deposit
            SELECT dd.member member, dd.sd sd, cl.code code
            FROM distinct_deps dd INNER JOIN claims cl
              ON dd.member=cl.member AND dd.sd > cl.cd AND dd.sd <= cl.cd + {W}
            GROUP BY member, sd, code
          ),
          cnt AS (SELECT member, sd, count() n FROM pairs GROUP BY member, sd)
          SELECT p.code code, round(sum(dd.dep / c2.n)) alloc
          FROM pairs p
          INNER JOIN distinct_deps dd ON p.member=dd.member AND p.sd=dd.sd
          INNER JOIN cnt c2 ON p.member=c2.member AND p.sd=c2.sd
          GROUP BY code
        """).result_rows
        byc = {code.strip(): float(a or 0) for code, a in rows}
        out["byWindow"][str(W)] = {k: round(v) for k, v in byc.items()}
        out["distinct"][str(W)] = round(sum(byc.values()))
        print(f"[{MK}] W={W:>2}d — {len(byc)} codes · per-code equal-split sum = {SYM}{sum(byc.values()):,.0f}")
    json.dump(out, open(SCR / f"deposit-alloc-bycode-{MK}.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"[{MK}] wrote deposit-alloc-bycode-{MK}.json")
print("DONE.")
