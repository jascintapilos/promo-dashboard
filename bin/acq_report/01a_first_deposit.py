"""Task 3 — per-member first-EVER deposit (date + amount) for acquisition claimers (MY).

Scoped to members who claimed one of the TL acquisition codes. Uses the FULL snapshot history
(no date floor) so "first-ever" is real — a deposit before the claim means the player was NOT new.
Member-level -> scratchpad only (never git).

Out: scratchpad/acq/first-deposit-MY.json = { member_id: [first_dep_date_iso, first_dep_amt] }
Usage: python bin/acq_report/01a_first_deposit.py
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client, CURRENCY, SITE_EDIT, SUF, SYMBOL

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ACQ = SCR / "acq"
START, END1 = "2026-01-01", "2026-08-26"

codes = [r["code"] for r in json.load(open(ACQ / f"acq-codes-{SUF}.json", encoding="utf-8"))]
inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)

c = get_client(send_receive_timeout=300)
q = f"""
WITH claimers AS (
    SELECT DISTINCT MEMBER_ID FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0
      AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
      AND BonusCode IN ({inlist})
)
SELECT MEMBER_ID, min(SnapshotDate) AS fdate, argMin(DepositAmount, SnapshotDate) AS famt
FROM (
    SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='{CURRENCY}' AND DepositAmount>0 AND MEMBER_ID IN (SELECT MEMBER_ID FROM claimers)
    UNION ALL
    SELECT MEMBER_ID, SnapshotDate, DepositAmount FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='{CURRENCY}' AND DepositAmount>0 AND MEMBER_ID IN (SELECT MEMBER_ID FROM claimers)
)
GROUP BY MEMBER_ID
"""
res = c.query(q, settings={"max_execution_time": 290, "max_memory_usage": 40000000000})
m = {str(r[0]): [str(r[1]), float(r[2])] for r in res.result_rows}
json.dump(m, open(ACQ / f"first-deposit-{SUF}.json", "w", encoding="utf-8"), default=str)

# also record the total claimer count (purity denominator)
tot = c.query(f"""SELECT uniqExact(MEMBER_ID) FROM WORKSPACE.GetBonus_ABC
  WHERE SITE_edit='{SITE_EDIT}' AND Currency='{CURRENCY}' AND BonusAmount>0
    AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
    AND BonusCode IN ({inlist})""").result_rows[0][0]
before = sum(1 for v in m.values() if v[0] < START)
inwin = sum(1 for v in m.values() if START <= v[0] < END1)
after = sum(1 for v in m.values() if v[0] >= END1)
print(f"acquisition claimers (distinct): {tot:,}")
print(f"  claimers with any first-ever deposit on record: {len(m):,}")
print(f"    first deposit BEFORE window (existing players): {before:,}")
print(f"    first deposit IN window (candidate new depositors): {inwin:,}")
print(f"    first deposit AFTER window: {after:,}")
print(f"  claimers with NO deposit ever: {tot-len(m):,}")
import statistics as st
amts = sorted(v[1] for v in m.values() if START <= v[0] < END1)
if amts:
    print(f"  in-window first-deposit amount: median {SYMBOL}{st.median(amts):,.0f} | p25 RM{amts[len(amts)//4]:,.0f} | p75 RM{amts[3*len(amts)//4]:,.0f}")
print("Saved scratchpad/acq/first-deposit-MY.json")
