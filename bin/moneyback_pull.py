#!/usr/bin/env python3
"""Money-in vs money-back pull — gross deposits returned by a code's claimers.

For every managed code (acq+ret+vip, from verify-action-{MK}.json), sum the deposits those
members made in the 7 / 30 / 60 / 90 days AFTER they claimed the code, plus the 30-day
distinct-depositor count. This is the raw "we spent RM X, RM Y came back" number YG asked for
(10 Sep) and the money-back side the pillar tabs and the summary tab both read.

Definition (no double-count): a deposit-day counts once per code if it falls within N days of
ANY claim of that code by that member; the window it lands in is set by the NEAREST preceding
claim (min day-gap). Gross deposits, not incremental — the incremental/uplift version already
lives in r_redeposit_uplift. Maturity of the 60/90d window is gated downstream by the existing
roi-horizon per-window logic (a window shows "—" on the tab when it isn't mature yet).

Out: scratchpad/moneyback-{MK}.json = { code: {d7,d30,d60,d90, dep30} }   (RM; dep30 = count)
Run: python bin/moneyback_pull.py            (both markets in one pass)
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, SITE_EDIT, START, END_EXCL

# match the report's basis (else claims/attribution inflate ~2x — same filter as verify_action_codes.py)
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

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
    WITH claims AS (
      SELECT trimBoth(BonusCode) AS code, MEMBER_ID, toDate(BonusTime_gmt8) AS cd
      FROM WORKSPACE.GetBonus_ABC
      WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CUR}' AND BonusAmount>0
        AND trimBoth(BonusCode) IN ({inlist}) AND BonusStatus IN {STATUSES}
        AND toDate(BonusTime_gmt8) >= '{START}' AND toDate(BonusTime_gmt8) < '{END_EXCL}'
    ),
    deps AS (
      SELECT MEMBER_ID, SnapshotDate AS sd, DepositAmount AS dep FROM (
        SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A  WHERE Currency='{CUR}' AND DepositAmount>0
        UNION ALL
        SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC WHERE Currency='{CUR}' AND DepositAmount>0
      ) WHERE MEMBER_ID IN (SELECT MEMBER_ID FROM claims)
    ),
    pairs AS (
      -- one row per (code, member, deposit-day): the deposit, and its nearest-preceding-claim gap
      SELECT cl.code AS code, cl.MEMBER_ID AS member, d.sd AS sd,
             any(d.dep) AS dep, min(dateDiff('day', cl.cd, d.sd)) AS dd
      FROM claims cl
      INNER JOIN deps d ON cl.MEMBER_ID = d.MEMBER_ID
      WHERE d.sd > cl.cd AND d.sd <= cl.cd + 90
      GROUP BY code, member, sd
    )
    SELECT code,
      round(sumIf(dep, dd <= 7))  AS d7,
      round(sumIf(dep, dd <= 30)) AS d30,
      round(sumIf(dep, dd <= 60)) AS d60,
      round(sumIf(dep, dd <= 90)) AS d90,
      uniqExactIf(member, dd <= 7)  AS dep7,
      uniqExactIf(member, dd <= 30) AS dep30,
      uniqExactIf(member, dd <= 90) AS dep90
    FROM pairs
    GROUP BY code
    """
    rows = c.query(q).result_rows
    out = {}
    for code, d7, d30, d60, d90, dep7, dep30, dep90 in rows:
        out[code] = {"d7": float(d7 or 0), "d30": float(d30 or 0),
                     "d60": float(d60 or 0), "d90": float(d90 or 0),
                     "dep7": int(dep7 or 0), "dep30": int(dep30 or 0), "dep90": int(dep90 or 0)}
    path = SCR / f"moneyback-{MK}.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    tot = sum(v["d30"] for v in out.values())
    print(f"[{MK}] wrote {path.name} — {len(out):,}/{len(codes):,} codes with a redeposit, "
          f"30d gross back = {CUR} {tot:,.0f}")
