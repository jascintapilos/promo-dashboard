"""Task 4 — per (code, member) acquisition outcomes (MY).

For each acquisition claim (redeemed/approved status, in window), scoped to the TL acquisition codes:
  - claim_date (earliest per code+member), claims, bonus_cost (the redeemed/approved basis)
  - w7_dep  = deposits in the 7-day window [claim, claim+6]   (deposit-lift numerator; new-player baseline ~0)
  - w7_ngr  = NGR in the same 7-day window                    (context only)
  - dep_days_30 = distinct deposit-days in [claim, claim+29]  (for 30-day stick; right-censored past 2026-07-27)
then merged in Python with the first-deposit map for:
  - ftd_in_7d  = member's first-EVER deposit falls in [claim, claim+6]
  - is_new     = no deposit before the claim (freebie-hunters + genuine new; existing depositors excluded)
Window deposit is attributed whole to the acquisition code (welcome bonuses are typically the sole bonus at
signup); time-decay + concurrency-split are deferred to the full-attribution wiring — headline metrics
(cost-per-FTD, conversion, purity, stick) do not depend on it.

Out: scratchpad/acq/claim-outcomes-MY.json
Usage: python bin/acq_report/01b_pull_outcomes.py
"""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from csir_config import get_client

SCR = Path(r"C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad")
ACQ = SCR / "acq"
START, END1 = "2026-01-01", "2026-08-26"
SNAP_END = "2026-08-27"          # snapshot scan bound (data max = 2026-08-26)
MATURE_30 = "2026-07-28"         # claim_date <= this -> full 30-day window (claim+29 <= 2026-08-26)

codes = [r["code"] for r in json.load(open(ACQ / "acq-codes-MY.json", encoding="utf-8"))]
inlist = ",".join("'" + c.replace("'", "''") + "'" for c in codes)
STATUSES = "('Approved','Redeemed','Complete','Active','Completed','Low Balance 1','Low Balance 2')"

q = f"""
WITH acq_claims AS (
    SELECT SITE, MEMBER_ID, BonusCode, toDate(BonusTime_gmt8) AS bonus_date, BonusAmount
    FROM WORKSPACE.GetBonus_ABC
    WHERE SITE_edit='WS1' AND Currency='MYR' AND BonusAmount>0
      AND BonusStatus IN {STATUSES}
      AND BonusTime_gmt8 >= '{START} 00:00:00' AND BonusTime_gmt8 < '{END1} 00:00:00'
      AND BonusCode IN ({inlist})
),
per_cm AS (
    SELECT SITE, MEMBER_ID, BonusCode,
           min(bonus_date) AS claim_date, count() AS claims, sum(BonusAmount) AS bonus_cost
    FROM acq_claims GROUP BY SITE, MEMBER_ID, BonusCode
),
snap AS (
    SELECT SITE AS ss, MEMBER_ID AS sm, SnapshotDate AS sd, DepositAmount AS dep, NGR AS ngr
    FROM WORKSPACE.Daily_GMT8_Snapshot_A
    WHERE Currency='MYR' AND SnapshotDate >= '{START}' AND SnapshotDate < '{SNAP_END}' AND (DepositAmount>0 OR NGR!=0)
    UNION ALL
    SELECT SITE, MEMBER_ID, SnapshotDate, DepositAmount, NGR
    FROM WORKSPACE.Daily_GMT8_Snapshot_BC
    WHERE Currency='MYR' AND SnapshotDate >= '{START}' AND SnapshotDate < '{SNAP_END}' AND (DepositAmount>0 OR NGR!=0)
)
SELECT p.MEMBER_ID AS MEMBER_ID, p.BonusCode AS BonusCode, p.claim_date AS claim_date,
       p.claims AS claims, p.bonus_cost AS bonus_cost,
       sumIf(ifNull(s.dep,0), n.number < 7)  AS w7_dep,
       sumIf(ifNull(s.ngr,0), n.number < 7)  AS w7_ngr,
       sum(if(ifNull(s.dep,0) > 0 AND n.number < 7, 1, 0))  AS dep_days_7,
       sum(if(ifNull(s.dep,0) > 0, 1, 0))                   AS dep_days_30
FROM per_cm p
CROSS JOIN (SELECT number FROM numbers(30)) n
LEFT JOIN snap s ON p.SITE=s.ss AND p.MEMBER_ID=s.sm AND addDays(p.claim_date, toInt32(n.number)) = s.sd
GROUP BY p.MEMBER_ID, p.BonusCode, p.claim_date, p.claims, p.bonus_cost
"""

c = get_client(send_receive_timeout=400)
res = c.query(q, settings={"max_execution_time": 390, "max_memory_usage": 60000000000,
                           "max_result_rows": 500000, "result_overflow_mode": "break"})
rows = [dict(zip(res.column_names, r)) for r in res.result_rows]

fd = json.load(open(ACQ / "first-deposit-MY.json", encoding="utf-8"))   # member -> [first_dep_date, amt]
out = []
for r in rows:
    mid = str(r["MEMBER_ID"]); cd = str(r["claim_date"])
    f = fd.get(mid)
    first_dep = f[0] if f else None
    had_prior = bool(first_dep and first_dep < cd)                       # deposited before the claim
    from datetime import date, timedelta
    cd_d = date.fromisoformat(cd); win_end = (cd_d + timedelta(days=6)).isoformat()
    ftd_in_7d = bool(first_dep and cd <= first_dep <= win_end)
    out.append({
        "member": mid, "code": r["BonusCode"], "claim_date": cd,
        "claims": int(r["claims"]), "bonus_cost": float(r["bonus_cost"]),
        "w7_dep": float(r["w7_dep"]), "w7_ngr": float(r["w7_ngr"]),
        "dep_days_7": int(r["dep_days_7"]), "dep_days_30": int(r["dep_days_30"]),
        "first_dep": first_dep, "had_prior_deposit": had_prior,
        "is_new": not had_prior, "ftd_in_7d": ftd_in_7d,
        "mature_30": cd <= MATURE_30,
        "first_dep_amt": (f[1] if f else 0.0),
    })
json.dump(out, open(ACQ / "claim-outcomes-MY.json", "w", encoding="utf-8"), default=str)

n_ftd = sum(1 for r in out if r["ftd_in_7d"])
n_new = sum(1 for r in out if r["is_new"])
n_prior = sum(1 for r in out if r["had_prior_deposit"])
tot_cost = sum(r["bonus_cost"] for r in out)
tot_w7 = sum(r["w7_dep"] for r in out)
print(f"per-(code,member) rows: {len(out):,}")
print(f"  redeemed/approved bonus_cost total: RM{tot_cost:,.0f}   (vs all-status RM996,049)")
print(f"  FTD-in-7d (members x code): {n_ftd:,} | is_new: {n_new:,} | had_prior_deposit(existing): {n_prior:,}")
print(f"  7-day window deposit total: RM{tot_w7:,.0f}")
print(f"  claims with mature 30-day window (<= {MATURE_30}): {sum(1 for r in out if r['mature_30']):,} / {len(out):,}")
print("Saved scratchpad/acq/claim-outcomes-MY.json")
